/** Invented end-to-end findings fixture. Run with node --import tsx scripts/findings-perf.ts.
 * --out=/tmp/report.json; --compare=/tmp/baseline.json enforces semantic parity.
 * DATABASE_URL must be the named local test endpoint; a fresh private scratch DB is used.
 * No configured application database or existing data directory is opened.
 */
import { mkdtemp, mkdir, writeFile, readFile, lstat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import type { Db, Queryable } from '../lib/db';

const id = (n: number) => `f5555555-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const at = '2026-09-27T00:00:00.000Z';
// Letters keep names distinct even in legacy name matching that strips digits.
const name = (n: number) => `Invented Person ${Array.from({length: 5}, (_, i) => String.fromCharCode(65 + Math.floor(n / 26 ** i) % 26)).join('')}`;
const args = new Map(process.argv.slice(2).map(a => { const i=a.indexOf('='); return i<0?[a,'true']:[a.slice(0,i), a.slice(i+1)]; }));
const size = Number(args.get('--findings') ?? 2500);
const pathsCount = size === 2500 ? 12000 : size * 5;
const entities = size === 2500 ? 35000 : Math.max(100,size * 14);
const lpCount = size === 2500 ? 3500 : Math.ceil(size * 1.4);
async function safeReport(path: string) {
  const p=resolve(path);
  if (p.split(sep).some(s => s==='real' || s==='plcos-data')) throw new Error('Real-data paths refused');
  for(let part=p;;part=dirname(part)) {
    const info=await lstat(part).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return null;throw e;});
    if(info?.isSymbolicLink() && part!=='/tmp' && part!=='/var') throw new Error('Symbolic-link artifact paths refused');
    if(part===dirname(part))break;
  }
  const actual=await realpath(dirname(p));
  if(actual.split(sep).some(s=>s==='real'||s==='plcos-data'))throw new Error('Resolved real-data path refused');
  return p;
}

async function main() {
  if (process.env.DATA_PROFILE && process.env.DATA_PROFILE !== 'demo') throw new Error('Invented fixture requires demo profile');
  if (process.env.PGLITE_DIR || process.env.ENRICH_DIR) throw new Error('Fixture refuses existing PGLITE_DIR or ENRICH_DIR');
  if (!Number.isInteger(size) || size < 1 || size > 2500) throw new Error('--findings must be 1..2500');
  const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
  if (url && (url.protocol !== 'postgres:' || url.hostname !== '127.0.0.1' || url.port !== '5434'
    || url.pathname !== '/plcos_test_findings_perf' || url.search || url.hash)) throw new Error('Only the approved local findings test URL is accepted');
  const root = await mkdtemp(join(tmpdir(),'plcos-findings-perf-'));
  await writeFile(join(root,'.findings-perf-invented'),'findings-perf-v1\n');
  process.env.DATA_PROFILE = 'demo';
  process.env.ENRICH_DIR = join(root,'enrich');
  process.env.PGLITE_DIR = join(root,'db');
  const { config } = await import('../config/deployment');
  Object.defineProperty(config.data, 'root', { value: root });
  const [{ openPglite }, { openPostgres }, { migrate }, { withDb }] = await Promise.all([
    import('../lib/db/pglite'), import('../lib/db/postgres'), import('../lib/db/migrate'), import('../lib/db'),
  ]);
  const dbName = `plcos_test_findings_${randomUUID().replaceAll('-','')}`;
  let admin: Db | undefined;
  if (url) {
    const adminUrl = new URL(url); adminUrl.pathname = '/postgres';
    admin = await openPostgres(adminUrl.href);
    await admin.exec(`create database "${dbName}"`);
    url.pathname = '/' + dbName;
  }
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const db = url ? await openPostgres(url.href,{statementTimeoutMs:0,max:2}) : await openPglite(join(root,'db'));
  const out=await safeReport(args.get('--out') ?? join(root,'report.json'));
  try {
    await migrate(db);
    await mkdir(join(root,'enrich','raw'),{recursive:true});
    await db.query(`insert into platform.app_user(id,handle,name,initials,role,email) values ($1,'fixture','Invented Operator','IO','admin','fixture@example.invalid')`,[id(900001)]);
    await db.query(`insert into platform.vehicle(id,slug,name,kind,exemption) values ($1,'neurotech','Invented Neurotech','fund','506(c)')`,[id(900002)]);
    await db.query(`insert into identity.entity(entity_id,entity_type,display_name,created_at)
      select ('f5555555-0000-4000-8000-'||lpad(to_hex(n),12,'0'))::uuid,
      case when n > $1 and n <= $2 then 'org' else 'person' end::identity.entity_type,
      'Invented Person '||chr(65+n%26)||chr(65+(n/26)%26)||chr(65+(n/676)%26)||chr(65+(n/17576)%26)||chr(65+(n/456976)%26),$3
      from generate_series(1,$4::int) n`,[size,lpCount,at,entities]);
    await db.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by) values ('app_user','fixture',$1,'fixture')`,[id(entities)]);
    await db.query(`insert into strategy.pursuit(pursuit_id,entity_id,vehicle_id,owner_id,opened_at)
      select ('f5555555-0000-4000-8000-'||lpad(to_hex(100000+n),12,'0'))::uuid,
      ('f5555555-0000-4000-8000-'||lpad(to_hex(n),12,'0'))::uuid,$1,$2,$3 from generate_series(1,$4::int) n`,[id(900002),id(900001),at,lpCount]);
    const sourceCount = size === 2500 ? 25000 : Math.min(entities-1,size*10);
    const affiliationCount = size === 2500 ? 10000 : size*4;
    const staticEdges = size === 2500 ? 15000 : size*6;
    await db.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by)
      select 'warehouse','fixture:'||n,('f5555555-0000-4000-8000-'||lpad(to_hex(n),12,'0'))::uuid,'fixture' from generate_series(1,$1::int) n`,[sourceCount]);
    await db.query(`insert into identity.affiliation(person_entity,org_entity,kind,role,source,as_of)
      select ('f5555555-0000-4000-8000-'||lpad(to_hex($1+n),12,'0'))::uuid,
      ('f5555555-0000-4000-8000-'||lpad(to_hex($2+1+(n%($1-$2))),12,'0'))::uuid,
      'staff','Invented professional','fixture','2026-09-27' from generate_series(1,$3::int) n`,[lpCount,size,affiliationCount]);
    await db.query(`insert into network.edge(edge_id,from_entity,to_entity,kind,tier,tie_band,evidence,valid_from)
      select ('f5555555-0000-4000-8000-'||lpad(to_hex(200000+n),12,'0'))::uuid,
      ('f5555555-0000-4000-8000-'||lpad(to_hex($1+n),12,'0'))::uuid,
      ('f5555555-0000-4000-8000-'||lpad(to_hex($1+n+1),12,'0'))::uuid,
      'coinvestor','C','weak','[{"source":"invented fixture","as_of":"2026-09-27"}]'::jsonb,'2026-09-27'
      from generate_series(1,$2::int) n`,[lpCount,staticEdges]);
    for (let n=1;n<=size;n++) {
      const finding={key:id(n),name:name(n),researched:{at,by:'Invented fixture',workflow:'W1',version:'1.0'},
        identity:{match:'confirmed',basis:'Invented fixture identity'},
        profile:{summary:'Invented investor makes SPV co-investments.',investorType:'angel',interests:['neurotechnology']},
        facts: ['interest','investment','spv_appetite','spv_deals'].map((field,j)=>({field,value:j===2?'does':j===3?'2':`Invented fact ${j}`,
          source:{url:`https://example.invalid/fixture/${n}/${j}`,title:'Invented source',kind:'primary',published:'2026-09-27'},
          quote:'Invented investor participates in SPV co-investments.',confidence:'high'}))};
      await writeFile(join(root,'enrich','raw',id(n)+'.json'),JSON.stringify(finding));
    }
    const paths=[];
    for(let p=0;p<pathsCount;p++) {
      const lp=p%size+1, slot=Math.floor(p/size);
      const other=slot===0?entities:lpCount+p+1;
      paths.push({lp:id(lp),other:slot===0?{type:'team',name:'Invented Operator',handle:'fixture'}:
        {type:'lp',name:name(other),key:id(other),entityType:'person'},kind:'coinvestor',tier:slot%2?'C':'B',
        basis:'Invented documented association.',source:`https://example.invalid/tie/${p}`});
    }
    await writeFile(join(root,'enrich','connections.jsonl'),paths.map(p=>JSON.stringify(p)).join('\n'));
    const {runImportOperation}=await import('../lib/import-jobs/operations');
    const timings: Record<string,number>={}; let phase='start', phaseAt=performance.now();
    const queryMetrics = new Map<string,{ phase:string; sql:string; calls:number; ms:number }>();
    const transactions: Array<{phase:string;ms:number}> = [];
    const tracked = (tx: Queryable): Queryable => ({
      query: async <T>(sql:string,params?:unknown[]) => {
        const key=phase+'|'+sql, entry=queryMetrics.get(key)??{phase,sql:sql.replace(/\s+/g,' ').trim().slice(0,200),calls:0,ms:0};
        if (args.has('--trace') && !queryMetrics.has(key)) console.log(JSON.stringify({queryStart:entry.sql,phase}));
        queryMetrics.set(key,entry); const before=performance.now();
        try { return await tx.query<T>(sql,params); } finally {const ms=performance.now()-before;entry.calls++;entry.ms+=ms;if(args.has('--trace') && ms>1000) console.log(JSON.stringify({slowQuery:entry.sql,phase,ms:Math.round(ms)}));}
      },
      one: async <T>(sql:string,params?:unknown[]) => {const rows=await tracked(tx).query<T>(sql,params);assert.ok(rows.length<=1);return rows[0]??null;},
      exec: (sql:string)=>tx.exec(sql),
    });
    const measured: Db={...tracked(db),kind:db.kind,close:()=>db.close(),transaction:async<T>(fn:(tx:Queryable)=>Promise<T>)=>{
      const label=phase,before=performance.now();
      try{return await db.transaction(tx=>fn(tracked(tx)));}finally{transactions.push({phase:label,ms:Math.round(performance.now()-before)});}
    }};
    const start=phaseAt;
    heartbeat=setInterval(()=>console.log(JSON.stringify({heartbeat:true,phase,elapsedMs:Math.round(performance.now()-start),phaseMs:Math.round(performance.now()-phaseAt),queries:[...queryMetrics.values()].filter(q=>q.phase===phase).map(q=>({sql:q.sql,calls:q.calls,ms:Math.round(q.ms)})).sort((a,b)=>b.ms-a.ms).slice(0,3)})),30000);
    heartbeat.unref();
    const progress=async(next:string)=> { const now=performance.now(); if(phase!=='start') timings[phase]=Math.round(now-phaseAt); phase=next; phaseAt=now; console.log(JSON.stringify({phase:next,elapsedMs:Math.round(now-start),timings})); };
    const counts=await withDb(measured,()=>runImportOperation(measured,{id:id(900003),kind:'findings',actor:id(900001),input:{},status:'running',phase:'',done:0,total:5,result:null,error:null,created_at:new Date(at),started_at:new Date(at),heartbeat_at:null,finished_at:null},progress));
    timings[phase]=Math.round(performance.now()-phaseAt);
    const totalMs=Math.round(performance.now()-start);
    assert.equal(counts.mapped,size); assert.equal(counts.paths,pathsCount); assert.equal(counts.claims,size*4); assert.equal(counts.rejected,0);
    assert.ok(!('error' in (counts.lpUnits as object))); assert.ok(!('error' in (counts.spv as object)));
    const snapshot: Record<string,{rows:number;sha256:string}>={};
    const queries: Record<string,string>={
      claims:`select entity_id,field,value,source,as_of,confidence,last_verified_by from research.claim`,
      documents:`select doc_id,title,kind,origin,as_of,strength,supports,body from research.source_doc`,
      notes:`select entity_id,kind,body,tags,data,author_id from research.note`,
      entities:`select entity_id,entity_type,display_name,merged_into,retired_at from identity.entity`,
      pursuits:`select entity_id,vehicle_id,owner_id,headline,plan,closed_at,close_reason,lp_capacity,lp_review,status,status_source,status_reason from strategy.pursuit`,
      routes:`select target_id,vehicle_kind,best_score,search->'stats' stats from network.route_cache`,
      sourceRecords:`select source,source_id,entity_id,confidence,resolved_by from identity.source_record`,
      affiliations:`select person_entity,org_entity,kind,role,started_on,ended_on,is_primary,source,as_of,certainty,note from identity.affiliation`,
      lpRepoint:`select pursuit_id,person_entity,vehicle_id,decision,decided_by,org_entity,org_pursuit_id,created_org_pursuit,reason,evidence,rule,actor_id,reversed_at,reversed_by,reversal_reason from strategy.lp_repoint`,
      pursuitContacts:`select pursuit_id,person_entity,role,origin_pursuit_id,source,created_by from strategy.pursuit_contact`,
      edges:`select from_entity,to_entity,kind,tier,strength,tie_band,evidence,reviewed_by,reviewed_at,review_note,valid_from,valid_to from network.edge`,
      spv:`select e.entity_id,e.kind,e.stance,e.min_deals,e.label,e.quote,e.source,e.url,e.as_of,e.confidence,e.last_verified_by,c.field claim_field,c.value claim_value,c.source claim_source from strategy.spv_evidence e left join research.claim c on c.claim_id=e.claim_id`,
    };
    const generated = new Map((await db.query<{id:string;name:string}>(`select entity_id::text id,display_name name from identity.entity where entity_id::text not like 'f5555555-%'`)).map(r=>[r.id,`entity:${r.name}`]));
    for (const c of await db.query<{id:string;key:string}>(`select claim_id::text id,entity_id::text||':'||field||':'||value||':'||source key from research.claim`)) generated.set(c.id,`claim:${c.key}`);
    for(const [key,sql] of Object.entries(queries)) {
      const rows=await db.query<{value:string}>(`select to_jsonb(r)::text value from (${sql}) r`);
      const values=rows.map(r=>r.value.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, v=>generated.get(v)??v)).sort();
      snapshot[key]={rows:rows.length,sha256:createHash('sha256').update(values.join('\n')).digest('hex')};
    }
    assert.equal(snapshot.edges!.rows,staticEdges+pathsCount,'Every static and imported research edge remains');
    assert.equal(snapshot.routes!.rows,lpCount,'Awaited route warming covers every LP');
    const report={scratchRoot:root,fixture:'findings-perf-v1',backend:db.kind,scale:{findings:size,paths:pathsCount,entities,lpUnits:lpCount,sourceRecords:sourceCount+1,affiliations:affiliationCount,staticEdges},timings,totalMs,counts,snapshot,transactions,queries:[...queryMetrics.values()].sort((a,b)=>b.ms-a.ms).slice(0,30).map(q=>({...q,ms:Math.round(q.ms)}))};
    await writeFile(out,JSON.stringify(report,null,2));
    if(args.has('--compare')) {
      const before=JSON.parse(await readFile(await safeReport(args.get('--compare')!),'utf8'));
      assert.deepEqual(report.scale,before.scale); assert.deepEqual(counts,before.counts,'Import result parity'); assert.deepEqual(snapshot,before.snapshot,'Semantic output parity');
      console.log('Semantic output parity passed');
    }
    console.log(JSON.stringify({out,timings,totalMs,snapshot}));
  } finally {
    if(heartbeat)clearInterval(heartbeat);
    await db.close();
    if(admin) { await admin.exec(`drop database "${dbName}"`); await admin.close(); }
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
