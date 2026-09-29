/** Invented full-export regression; never opens application data or connectors.
 * node --cpu-prof --cpu-prof-dir=/tmp --import tsx scripts/research-export-perf.ts [--small] [--baseline]
 * Run this unchanged against a frozen baseline checkout and the optimized checkout.
 * --baseline records timings without enforcing the 180-second performance budget.
 * EXPORT_PERF_REPORT points to an optional report file; outputs remain in a new /tmp directory.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { Db, Queryable } from '../lib/db';

const args = new Set(process.argv.slice(2));
for (const arg of args) if (!['--small', '--baseline'].includes(arg)) throw Error('Unknown fixture option');
if ((process.env.DATA_PROFILE && process.env.DATA_PROFILE !== 'demo') || process.env.DATABASE_URL || process.env.PGLITE_DIR || process.env.ENRICH_DIR) {
  throw Error('Fixture refuses application database and enrichment configuration');
}
process.env.DATA_PROFILE = 'demo';
const dir = await mkdtemp(join(tmpdir(), 'plcos-invented-export-'));
process.env.ENRICH_DIR = dir;
const { withDb } = await import('../lib/db');
const { openPglite } = await import('../lib/db/pglite');
const { migrate } = await import('../lib/db/migrate');
const { exportResearchSet } = await import('../lib/enrich/candidates');
const small = args.has('--small');
const groups = small ? 19 : 1900, entities = small ? 1180 : 118000;
const pairs = small ? 630 : 63000, candidates = small ? 20 : 2000;
const rawCount = small ? 2200 : 220000, touches = small ? 120 : 12000;
const id = (n: number) => `f2222222-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const sqlId = (n: string) => `('f2222222-0000-4000-8000-'||lpad(to_hex(${n}),12,'0'))::uuid`;
const db = await openPglite(join(dir,'database'));
async function fixture() {
  await migrate(db);
  await db.exec(`insert into identity.entity(entity_id,entity_type,display_name,created_at)
    select ${sqlId('n')},case when n<=${groups*9} then 'person' else 'org' end::identity.entity_type,
      case when n<=${groups*9} then 'Invented Person '||((n-1)/9) else 'Invented Company '||n end,'2026-09-01' from generate_series(1,${entities}) n;
    insert into identity.source_record(source,source_id,entity_id,resolved_by,resolved_at)
      select case when n<=${groups*9} and n%9<>1 then 'prospect' else 'affinity' end,case when n<=${groups*9} then 'person:' else 'organization:' end||n,${sqlId('n')},'rule:invented-fixture','2026-09-01' from generate_series(1,${entities}) n;
    insert into identity.possible_match(left_entity,right_entity,confidence,signals,created_at)
      select ${sqlId('g*9+a')},${sqlId('g*9+b')},0.5,'{"rule":"creation-name-only"}','2026-09-01'
      from generate_series(0,${groups-1}) g cross join generate_series(1,9) a cross join generate_series(1,9) b
      where a<b order by a,b,g limit ${pairs};
    insert into platform.app_user(id,handle,name,initials,role,email,created_at)
      values('${id(entities+1)}','invented-team','Invented Team','IT','operator','team@example.test','2026-09-01');
    insert into platform.vehicle(id,slug,name,kind,exemption,created_at)
      values('${id(entities+2)}','invented-fund','Invented Fund','fund','506(c)','2026-09-01');
    insert into strategy.pursuit(pursuit_id,entity_id,vehicle_id,owner_id,status,source,opened_at)
      select ${sqlId('entities+n')},${sqlId('n')},'${id(entities+2)}','${id(entities+1)}','selected','prospects','2026-09-01'
      from generate_series(1,${candidates}) n cross join (select ${entities+10} entities) x;
    insert into identity.affiliation(person_entity,org_entity,role,is_primary,source,kind,as_of)
      select ${sqlId('n')},${sqlId(`${groups*9}+n`)},'Invented Partner',true,'invented-fixture','staff','2026-09-01' from generate_series(1,${candidates}) n;
    insert into sources.raw_record(source,kind,source_id,payload_hash,payload,fetched_at)
      select 'affinity','list_entry',n::text,'invented-'||n,
      jsonb_build_object('id',n,'type',case when n<=${groups*9} then 'person' else 'organization' end,
        'entity',jsonb_build_object('id',1+((n-1)%${entities}),'fields','[]'::jsonb,'title','Invented Partner','company','Invented firm '||n)),
      '2026-09-01' from generate_series(1,${rawCount}) n;
    insert into sources.raw_record(source,kind,source_id,payload_hash,payload,fetched_at)
      select 'affinity','email',n::text,'invented-email-'||n,jsonb_build_object('id',n,'type','email',
        'subject','Invented meeting discussion','body','Invented message','date','2026-09-01',
        'personIds',jsonb_build_array(1+((n-1)%${candidates}))),'2026-09-01' from generate_series(1,${touches}) n;
    insert into meetings.meeting(meeting_id,entity_id,vehicle_id,owner_id,kind,held_on,channel,direction,source,source_ref,about,about_vehicles,attendees,created_at)
      select ${sqlId(`${entities+candidates+100}+n`)},${sqlId(`1+((n-1)%${candidates})`)},'${id(entities+2)}','${id(entities+1)}','follow_up',
      '2026-09-01'::date+(n%20),case when n%3=0 then 'meeting' else 'email' end::meetings.channel,
      case when n%2=0 then 'ours' else 'theirs' end,'affinity','interaction:email:'||n||':fixture','raise',array['invented-fund'],array['Invented Team'],'2026-09-01'
      from generate_series(1,${touches}) n;
    update identity.entity set merged_into=${sqlId('n*9')} from generate_series(1,${groups}) n where entity_id=${sqlId(`${entities}-n+1`)};
    insert into network.edge(from_entity,to_entity,kind,tier,valid_from,evidence)
      select ${sqlId('n*9')},${sqlId(`${groups*9}+n`)},'colleague','C','2026-09-01',
      '[{"source":"Invented fixture","note":"Invented employment affiliation"}]' from generate_series(1,${groups}) n;
    insert into research.note(note_id,entity_id,kind,body,data,created_at)
      select ${sqlId(`${entities+candidates+touches+200}+n`)},${sqlId('n*9')},'connection_candidates','Invented fixture',
      jsonb_build_object('paths',jsonb_build_array(jsonb_build_object('lp',${sqlId('n*9-1')}::text,'other',jsonb_build_object('key','person:'||(n*9-2))))),'2026-09-01'
      from generate_series(1,${groups}) n;
    analyze;`);
}
// Rows have no meaningful SQL order in several subexports. Preserve their entire content,
// including all privacy fields, and compare as sets; timestamps owned by the export are omitted.
function normalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalize).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k])=>k!=='asOf')
    .sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,normalize(x)]));
  return v;
}
const queries: Array<{ ms: number; sql: string }> = [];
function measured(tx: Queryable): Queryable {
  return { ...tx, query: async <T>(sql: string, params?: unknown[]) => {
    const start=performance.now();
    try { return await tx.query<T>(sql,params); }
    finally { const ms=performance.now()-start; queries.push({ms,sql:sql.replace(/\s+/g,' ').slice(0,240)});
      if(ms>1000) console.log(JSON.stringify({queryMs:Math.round(ms),sql:sql.replace(/\s+/g,' ').slice(0,140)})); }
  }, one: tx.one.bind(tx), exec: tx.exec.bind(tx) };
}
const traced: Db = { ...measured(db),kind:db.kind,close:()=>db.close(),transaction:fn=>db.transaction(tx=>fn(measured(tx))) };
try {
  const start=performance.now(); await fixture();
  console.log(JSON.stringify({fixtureMs:Math.round(performance.now()-start),groups,entities,pairs,candidates,rawCount,touches,dir}));
  queries.length=0;
  const exportStart=performance.now();
  const result=await withDb(traced,()=>exportResearchSet());
  const exportMs=Math.round(performance.now()-exportStart);
  assert.equal(result.identityReviewError,null);assert.equal(result.lpUnitReviewError,null);assert.equal(result.candidates,candidates);
  const files: Record<string,{rows:number;sha256:string}>={};
  for(const name of ['research-set.jsonl','candidates.jsonl','triage.jsonl','identity-review.jsonl','lp-unit-review.jsonl','entity-keys.json','team.json','vehicles.json']) {
    const rows=(await readFile(join(dir,name),'utf8')).split('\n').filter(Boolean);
    const data=name.endsWith('.jsonl')?rows.map(line=>JSON.parse(line)):JSON.parse(rows.join('\n'));
    files[name]={rows:name.endsWith('.jsonl')?rows.length:Array.isArray(data)?data.length:Object.keys(data).length,
      sha256:createHash('sha256').update(JSON.stringify(normalize(data))).digest('hex')};
  }
  assert.equal(files['identity-review.jsonl']!.rows,groups);
  assert.ok(files['triage.jsonl']!.rows>=candidates);assert.ok(files['lp-unit-review.jsonl']!.rows>0);
  const report={baseline:args.has('--baseline'),backend:db.kind,exportMs,fixture:{groups,entities,pairs,candidates,rawCount,touches},files,
    queryCount:queries.length,queryMs:Math.round(queries.reduce((s,q)=>s+q.ms,0)),slowest:queries.sort((a,b)=>b.ms-a.ms).slice(0,12),dir};
  await writeFile(join(dir,'report.json'),JSON.stringify(report,null,2));
  if(process.env.EXPORT_PERF_REPORT) await writeFile(process.env.EXPORT_PERF_REPORT,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
  if(!args.has('--baseline')) assert.ok(exportMs<180000,'full invented export must finish within three minutes');
} finally { await db.close(); }
