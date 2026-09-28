/** Invented network benchmark: node --cpu-prof --cpu-prof-dir=/tmp --import tsx scripts/network-perf.ts.
 * DATABASE_URL uses the existing isolated loopback plcos_test_* harness. --small is a quick smoke run.
 * --real-shape uses 5,418 open targets, high-degree hubs and a dense irrelevant connector cluster.
 * --real-shape --open-lps=120 separately measures an invented smaller open-pursuit workload.
 * Raw email payloads are generated for fidelity; buildNetwork consumes their translated meeting rows.
 */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Db } from '../lib/db';
import { networkHubFixture } from './network-speed-2-fixture';
const id=(n:number)=>`f7777777-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
const name=(n:number)=>`Invented Person ${Array.from({length:5},(_,i)=>String.fromCharCode(65+Math.floor(n/26**i)%26)).join('')}`;
const at='2026-09-01';

export async function generateNetworkFixture(db:Db,dir:string,small=false,realShape=false,openTargets?:number) {
  const scale=small?{people:100,meetings:160,emails:240,lps:10,findings:14,paths:70}:{people:43000,meetings:69000,emails:100000,lps:realShape?5418:2000,findings:2800,paths:realShape?37926:14000};
  const openLps=realShape&&!small?(openTargets??scale.lps):scale.lps;
  if(!Number.isInteger(openLps)||openLps<1||openLps>scale.lps)throw new Error('Invalid invented open pursuit count');
  let seed=1701;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
  await mkdir(join(dir,'raw'),{recursive:true});
  const team=Array.from({length:7},(_,i)=>({id:id(900000+i),handle:`invented-${i}`,name:name(scale.people+i+1),entity:id(scale.people+i+1)}));
  for(const t of team)await db.query(`insert into platform.app_user(id,handle,name,initials,role,email) values($1,$2,$3,'IP','admin',$4)`,[t.id,t.handle,t.name,`${t.handle}@example.invalid`]);
  await db.query(`insert into identity.entity(entity_id,entity_type,display_name)
    select x.id::uuid,'person',x.name from jsonb_to_recordset($1::jsonb) x(id text,name text)`,[JSON.stringify(Array.from({length:scale.people+7},(_,i)=>({id:id(i+1),name:name(i+1)})))]);
  await db.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by)
    select 'affinity',n::text,('f7777777-0000-4000-8000-'||lpad(to_hex(n),12,'0'))::uuid,'fixture' from generate_series(1,$1::int) n`,[scale.people]);
  for(const t of team)await db.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by) values('app_user',$1,$2,'fixture')`,[t.handle,t.entity]);
  await db.query(`insert into platform.vehicle(id,slug,name,kind,exemption) values($1,'neurotech','Invented Fund','fund','506(c)')`,[id(900010)]);
  await db.query(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id) select ('f7777777-0000-4000-8000-'||lpad(to_hex(n),12,'0'))::uuid,$1,$2 from generate_series(1,$3::int) n`,[id(900010),team[0]!.id,scale.lps]);
  if(realShape&&!small) {
    await db.query(`update strategy.pursuit set closed_at=now() where entity_id > $1::uuid`,[id(openLps)]);
    const fixture=networkHubFixture(),mapping=new Map<string,string>();
    fixture.targets.forEach((target,i)=>mapping.set(target,id(i+1)));
    fixture.sources.slice(0,7).forEach((source,i)=>mapping.set(source,team[i]!.entity));
    mapping.set('invented-pl-org',id(800000));
    for(let i=0;i<fixture.spokeCount;i++) {
      mapping.set(`invented-contact-${i}`,id(scale.lps+i+1));
      mapping.set(`invented-isolated-${i}`,id(scale.lps+fixture.spokeCount+i+1));
    }
    for(let i=0;i<3;i++)mapping.set(`invented-hub-${i}`,id(800001+i));
    mapping.set('invented-unreachable-hub',id(800004));
    await db.query(`insert into identity.entity(entity_id,entity_type,display_name)
      select x.id::uuid,'org',x.name from jsonb_to_recordset($1::jsonb) x(id text,name text)`,
      [JSON.stringify(Array.from({length:5},(_,i)=>({id:id(800000+i),name:`Invented Stress Organization ${i}`})))]);
    await db.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by) values('network_org','pl',$1,'fixture')`,[id(800000)]);
    const seen=new Set<string>(),ties:Array<{a:string;b:string}>=[];
    for(const [node,links] of fixture.graph.adjacency)for(const link of links)if(!seen.has(link.edgeId)) {
      seen.add(link.edgeId);ties.push({a:mapping.get(node)!,b:mapping.get(link.other)!});
    }
    for(let i=0;i<ties.length;i+=2000)await db.query(`insert into network.edge(from_entity,to_entity,kind,tier,tie_band,evidence,valid_from)
      select a::uuid,b::uuid,'board','C','weak',$2::jsonb,$3::date from jsonb_to_recordset($1::jsonb) x(a text,b text)`,
      [JSON.stringify(ties.slice(i,i+2000)),JSON.stringify([{source:'https://example.invalid/invented-hubs',as_of:at,confidence:'invented fixture',last_verified_by:'Invented benchmark',note:'Invented stress topology'}]),at]);
  }
  const payloads:string[]=[];
  for(let offset=0;offset<scale.meetings+scale.emails;offset+=2000){
    const rows=Array.from({length:Math.min(2000,scale.meetings+scale.emails-offset)},(_,i)=>{
      const n=offset+i,person=1+Math.floor(random()*scale.people),t=team[person%team.length]!,email=n>=scale.meetings;
      const on=`2026-08-${String(1+Math.floor(random()*28)).padStart(2,'0')}`;
      if(email)payloads.push(JSON.stringify({id:n,from:`person-${person}@example.invalid`,sentAt:on+'T12:00:00Z',subject:'Invented correspondence',direction:'theirs',toParticipantsPreview:[{email:`${t.handle}@example.invalid`,name:t.name}],ccParticipantsPreview:[]}));
      return {entity:id(person),owner:t.id,on,channel:email?'email':'meeting',direction:email?'theirs':'both',ref:`fixture-${n}`};
    });
    await db.query(`insert into meetings.meeting(entity_id,owner_id,held_on,channel,direction,source,source_ref,group_size)
      select entity::uuid,owner::uuid,on_date::date,channel::meetings.channel,direction,'affinity',ref,2
      from jsonb_to_recordset($1::jsonb) x(entity text,owner text,on_date text,channel text,direction text,ref text)`,[JSON.stringify(rows.map(({on,...r})=>({...r,on_date:on})))]);
  }
  await writeFile(join(dir,'invented-emails.jsonl'),payloads.join('\n'));
  for(let i=1;i<=scale.findings;i++)await writeFile(join(dir,'raw',id(i)+'.json'),JSON.stringify({key:id(i),name:name(i),researched:{at:at+'T00:00:00Z',by:'Invented fixture',workflow:'W1',version:'1.0'},identity:{match:'confirmed',basis:'Invented fixture identity'},profile:{summary:'Invented investor.',investorType:'angel',interests:['neurotechnology']},facts:[]}));
  // One team route and six cross-team connectors per LP exercise three-hop enumeration.
  const notes=Array.from({length:scale.lps},(_,i)=>({entity:id(i+1),data:{paths:Array.from({length:scale.paths/scale.lps},(_,j)=>({lp:id(i+1),other:j===0?{type:'team',name:team[i%7]!.name,handle:team[i%7]!.handle}:{type:'lp',name:name(scale.lps+1+(i*6+j)% (scale.people-scale.lps)),key:id(scale.lps+1+(i*6+j)%(scale.people-scale.lps))},kind:'board',tier:'C',basis:'Invented board evidence',source:'https://example.invalid/board'}))}}));
  await db.query(`insert into research.note(entity_id,kind,body,data,created_at) select entity::uuid,'connection_candidates','Invented paths',data,$2::timestamptz from jsonb_to_recordset($1::jsonb) x(entity text,data jsonb)`,[JSON.stringify(notes),at]);
  return {...scale,openLps};
}

async function main(){
  if((process.env.DATA_PROFILE&&process.env.DATA_PROFILE!=='demo')||process.env.ENRICH_DIR||process.env.PGLITE_DIR)throw new Error('Invented fixture refuses real profile and existing data directories');
  const root=await mkdtemp(join(tmpdir(),'plcos-network-perf-'));process.env.DATA_PROFILE='demo';process.env.ENRICH_DIR=join(root,'enrich');process.env.PGLITE_DIR=join(root,'db');process.env.PLCOS_IMPORT_WORKER='1';
  const {config}=await import('../config/deployment');Object.defineProperty(config.data,'root',{value:root});
  const [{openTestDb,cleanTestPostgres},{migrate},{withDb},{withQueryTimings},{buildNetwork}]=await Promise.all([import('./properties/database'),import('../lib/db/migrate'),import('../lib/db'),import('../lib/db/timing'),import('../modules/network/build')]);
  const db=await openTestDb(join(root,'db'));
  try{
    const openTargets=process.argv.find(arg=>arg.startsWith('--open-lps='))?.slice('--open-lps='.length);
    await migrate(db);const scale=await generateNetworkFixture(db,process.env.ENRICH_DIR!,process.argv.includes('--small'),process.argv.includes('--real-shape'),openTargets===undefined?undefined:Number(openTargets));console.log(JSON.stringify({phase:'fixture-ready',root,scale}));
    let sqlMs=0,queries=0;const start=performance.now();let transactionMs=0;
    const measured:Db={...db,transaction:async work=>{const before=performance.now();try{return await db.transaction(work);}finally{transactionMs+=performance.now()-before;console.log(JSON.stringify({phase:'transaction-complete',transactionMs:Math.round(transactionMs),elapsedMs:Math.round(performance.now()-start)}));}}};
    const heartbeat=setInterval(()=>console.log(JSON.stringify({phase:'building',elapsedMs:Math.round(performance.now()-start),sqlMs:Math.round(sqlMs),queries})),30000);heartbeat.unref();
    let counts;try{counts=await withQueryTimings(q=>{sqlMs+=q.milliseconds;queries++;},()=>withDb(measured,()=>buildNetwork({awaitBackground:true})));}finally{clearInterval(heartbeat);}
    const totalMs=Math.round(performance.now()-start);
    const warmup=await db.one<{status:string;completed:number;total:number}>(`select status,completed,total from network.route_warmup where singleton`);
    if(warmup?.status!=='complete'||warmup.completed!==scale.openLps||warmup.total!==scale.openLps)throw new Error('Incomplete fixture route warm-up');
    const edges=await db.query<{value:string}>(`select jsonb_build_array(from_entity,to_entity,kind,tier,tie_band,evidence,valid_from,valid_to,reviewed_by,reviewed_at,review_note)::text value from network.edge`);
    const snapshot={rows:edges.length,sha256:createHash('sha256').update(edges.map(e=>e.value).sort().join('\n')).digest('hex')};
    const report={root,scale,totalMs,transactionMs:Math.round(transactionMs),sqlMs:Math.round(sqlMs),queries,counts,snapshot,warmup};
    await writeFile(join(root,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  }finally{await db.close();await cleanTestPostgres();}
}
if(process.argv[1]?.endsWith('network-perf.ts'))main().catch(e=>{console.error(e);process.exitCode=1;});
