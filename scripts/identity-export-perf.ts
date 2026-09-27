/** Invented-only performance regression. No application database or filesystem data is opened.
 * node --import tsx scripts/identity-export-perf.ts [--postgres] [--baseline] [--small]
 * PostgreSQL uses plcos_dev only to CREATE/DROP a new uniquely named scratch database.
 */
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import type { Db, Queryable } from '../lib/db';
import { openPglite } from '../lib/db/pglite';
import { openPostgres } from '../lib/db/postgres';
import { migrate } from '../lib/db/migrate';
import { exportIdentityReview } from '../lib/enrich/identity-review-export';
import { mergeImportDuplicatesInTransaction } from '../lib/enrich/import-dupes';
import { exportIdentityReview as baselineExport } from './fixtures/identity-export-perf/baseline-export';
import { mergeImportDuplicatesInTransaction as baselineMerge } from './fixtures/identity-export-perf/baseline-dupes';
import { identityRawContextSql, identityGraphContextSql } from '../lib/enrich/identity-context';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const args = new Set(process.argv.slice(2));
for (const arg of args) {
  if (!['--postgres', '--baseline', '--small', '--postgres-socket'].includes(arg)) throw Error('Unknown fixture option');
}
if ((process.env.DATA_PROFILE && process.env.DATA_PROFILE !== 'demo') || process.env.DATABASE_URL || process.env.PGLITE_DIR) {
  throw Error('Fixture refuses application database configuration');
}
const pg = args.has('--postgres') || args.has('--postgres-socket');
const small = args.has('--small'), baseline = args.has('--baseline');
const id = (n: number) => `f1111111-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const sqlId = (expr: string) => `('f1111111-0000-4000-8000-'||lpad(to_hex(${expr}),12,'0'))::uuid`;
const scale = small ? 10 : 1000, entities = small ? 300 : 30000;
const rawCount = small ? 2200 : 220000, edgeCount = small ? 400 : 40000, claimCount = small ? 70 : 7000;
let admin: Db | undefined, db: Db | undefined, name: string | undefined;
let createdDatabase = false;
const observations: Array<{ label: string; ms: number; queries: Array<{ ms: number; sql: string }> }> = [];
async function fixture(db:Db) {
  await migrate(db);
  await db.exec(`insert into identity.entity(entity_id,entity_type,display_name,created_at)
    select ${sqlId('n')},case when n<=${scale*3} then case when ((n-1)/3)<${scale*.8} then 'person' else 'org' end else 'org' end::identity.entity_type,
    case when n<=${scale*3} then 'Invented ambiguous '||((n-1)/3) else 'Invented unrelated '||n end,'2026-09-27' from generate_series(1,${entities}) n;
    update identity.entity set merged_into=${sqlId('n-2')} from generate_series(3,${scale*3},3) n where entity_id=${sqlId('n')};
    insert into identity.source_record(source,source_id,entity_id,resolved_by)
      select 'affinity',case when n<=${scale*2.4} then 'person:' else 'organization:' end||n,${sqlId('n')},'rule:sourced-invented' from generate_series(1,${entities}) n;
    insert into identity.source_record(source,source_id,entity_id,resolved_by)
      select 'prospect','invented-'||n,${sqlId('n')},'rule:sourced-invented' from generate_series(1,${scale*3}) n;
    insert into sources.raw_record(source,kind,source_id,payload_hash,payload)
      select 'affinity',case when n%4=0 then 'list_entry' when n<=${scale*2.4} then 'person' else 'organization' end,n::text,'invented-'||n,
      case when n%4=0 then jsonb_build_object('type',case when n<=${scale*2.4} then 'person' else 'organization' end,'entity',jsonb_build_object('id',n,'title','Invented director '||(n%3),'company','Invented company '||((n-1)/3)))
      else jsonb_build_object('title','Invented director '||(n%3),'company','Invented company '||((n-1)/3),'linkedin','https://example.test/people/invented-'||n) end
      from generate_series(1,${rawCount}) n;
    insert into network.edge(from_entity,to_entity,kind,tier,valid_from,evidence)
      select ${sqlId(`1+((n-1)%${entities})`)},${sqlId(`${scale*3}+1+(n%${entities-scale*3})`)},'colleague','C','2026-09-27',
      jsonb_build_array(jsonb_build_object('source','Invented fixture','note',case when n%2=0 then 'Invented employment affiliation' else 'Invented event evidence' end))
      from generate_series(1,${edgeCount}) n;
    insert into research.source_doc(doc_id,title,kind,origin,as_of,strength,supports,body)
      values('invented-perf','Invented performance fixture','fixture','invented','2026-09-27','weak','Invented only','Invented only');
    insert into research.claim(entity_id,field,value,source,as_of,confidence)
      select ${sqlId(`1+((n-1)%${scale*3})`)},'title','Invented title '||n,'invented-perf','2026-09-27','low' from generate_series(1,${claimCount}) n;
    insert into research.note(entity_id,kind,body,data)
      select ${sqlId('n')},'public_profile','Invented profile',jsonb_build_object('title','Invented profile director','personal_url','https://example.test/bio/'||n) from generate_series(1,${scale*3}) n;
    insert into research.note(entity_id,kind,body,data)
      select ${sqlId('n*3')},'connection_candidates','Invented connections',jsonb_build_object('paths',jsonb_build_array(
        jsonb_build_object('lp',${sqlId('n*3')}::text,'other',jsonb_build_object('key','person:'||(n*3-1))),
        jsonb_build_object('lp','person:'||(n*3-2),'other',jsonb_build_object('key',${sqlId('n*3-1')}::text))))
      from generate_series(1,${scale}) n;
    analyze;`);
}
// SQL never guaranteed ordering of affiliations; compare the complete content as sets.
function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalize(v)]));
  }
  return value;
}
async function measure<T>(label: string, work: (tx: Queryable) => Promise<T>) {
  const queries: Array<{ ms: number; sql: string }> = [];
  const start = performance.now();
  try {
    return await db!.transaction(tx => work({ ...tx, query: async <T>(sql: string, params?: unknown[]) => {
      const queryStart = performance.now();
      try { return await tx.query<T>(sql, params); }
      finally { queries.push({ ms: Math.round(performance.now() - queryStart), sql: sql.replace(/\s+/g, ' ').slice(0, 160) }); }
    } }));
  } finally {
    const result = { label, ms: Math.round(performance.now() - start), queries: queries.sort((a, b) => b.ms - a.ms).slice(0, 8) };
    observations.push(result);
    console.log(JSON.stringify(result));
  }
}
async function review(tx: Queryable, merge: typeof baselineMerge) {
  await tx.exec('savepoint fixture_review');
  try { return (await merge(tx, 'invented-fixture', [], [], { reviewOnly: true })).ambiguous.length; }
  finally { await tx.exec('rollback to savepoint fixture_review; release savepoint fixture_review'); }
}
try {
  if (pg) {
    const socket = args.has('--postgres-socket') ? '?host=/private/tmp' : '';
    admin = await openPostgres(`postgres://plcos@127.0.0.1:5434/plcos_dev${socket}`);
    name = `plcos_identity_perf_${process.pid}_${Date.now()}`;
    await admin.exec(`create database "${name}"`);
    createdDatabase = true;
    db = await openPostgres(`postgres://plcos@127.0.0.1:5434/${name}${socket}`, { statementTimeoutMs: 20000 });
  } else {
    // Distinct lock path: property tests independently use memory://.
    db = await openPglite(`memory://identity-perf-${process.pid}`);
  }
  const started=performance.now();await fixture(db);console.log(JSON.stringify({backend:db.kind,fixtureMs:Math.round(performance.now()-started),groups:scale,entities,rawCount,edgeCount,claimCount}));
  await db.exec("set statement_timeout='20s'");
  const indexSql=await readFile(new URL('../modules/sources/migrations/005_identity_review_lookups.sql',import.meta.url),'utf8');
  const dropIndexes=async()=>db!.exec('drop index sources.raw_record_identity_id_idx; drop index sources.raw_record_affinity_typed_id_idx; drop index sources.raw_record_affinity_list_subject_idx');
  const plans:Array<{label:string;plan:unknown}>=[];
  const ids=Array.from({length:scale*3},(_,i)=>id(i+1));
  const raw=`select s.entity_id::text id,r.payload from identity.source_record s join sources.raw_record r on r.source=s.source and (r.source_id=s.source_id or (s.source='affinity' and (r.kind||':'||r.source_id=s.source_id or (r.kind='list_entry' and (r.payload->>'type')||':'||(r.payload->'entity'->>'id')=s.source_id)))) where s.entity_id=any($1::uuid[])`;
  const graph=`select distinct p.id::text id,o.display_name org from unnest($1::uuid[]) p(id) join network.edge e on e.from_entity=p.id or e.to_entity=p.id join identity.entity o on o.entity_id=identity.canonical_entity_id(case when e.from_entity=p.id then e.to_entity else e.from_entity end) where o.entity_type='org' and (e.kind::text in ('same_firm','employment') or exists(select 1 from jsonb_array_elements(e.evidence) v where v->>'note' ~* 'affiliation|employment|employed by|works at'))`;
  // Plan the old SQL without the new indexes, then restore them for the new SQL.
  // These are our own scratch tables; no application database is altered.
  await dropIndexes();
  for (const [label,sql] of [['baseline raw',raw],['baseline graph',graph]]) {
    plans.push({label,plan:await db.query(`explain (format json) ${sql}`,[ids])});
  }
  let before:unknown;
  if (baseline) {
    try { await measure('baseline reviewOnly', tx => review(tx, baselineMerge)); }
    catch (error) { console.log(JSON.stringify({ label: 'baseline reviewOnly failed', error: error instanceof Error ? error.message : String(error) })); }
    try { before = await measure('baseline export', baselineExport); }
    catch (error) { console.log(JSON.stringify({ label: 'baseline export failed', error: error instanceof Error ? error.message : String(error) })); }
  }
  await db.exec(indexSql);
  await db.exec('analyze sources.raw_record');
  for (const [label,sql] of [['optimized raw',identityRawContextSql],['optimized graph',identityGraphContextSql]]) {
    plans.push({label,plan:await db.query(`explain (analyze,format json) ${sql}`,[ids])});
  }
  console.log(JSON.stringify({plans},(key,value)=>['Filter','Index Cond','Recheck Cond','Join Filter'].includes(key)&&typeof value==='string'?value.replace(/'\{[^}]+\}'/g,"'{fixture IDs}'"):value));
  await measure('optimized reviewOnly', tx => review(tx, mergeImportDuplicatesInTransaction));
  const output=await measure('optimized export cold',exportIdentityReview);
  const repeat=await measure('optimized export warm',exportIdentityReview);
  assert.equal(output.length,scale);assert.deepEqual(normalize(output),normalize(repeat));
  if(before){assert.deepEqual(normalize(output),normalize(before));console.log(JSON.stringify({parity:true}));}else if(baseline)throw Error('Baseline output parity was not verified');
  console.log(JSON.stringify({backend:db.kind,groups:output.length,sha256:createHash('sha256').update(JSON.stringify(normalize(output))).digest('hex'),observations}));
  if(!small) assert.ok(observations.filter(x=>x.label.startsWith('optimized export')).every(x=>x.ms<5000),'export must finish under five seconds');
} finally {
  await db?.close();
  if (admin && name && createdDatabase) await admin.exec(`drop database "${name}"`);
  await admin?.close();
}
