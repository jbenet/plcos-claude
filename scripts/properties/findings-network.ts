/** Invented fixtures for incremental research ties and indexed endpoint parity. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { Check } from './harness';
import { openTestDb } from './database';
import { migrate } from '../../lib/db/migrate';
import { withDb } from '../../lib/db';
import { buildNetwork, reviewEdge } from '../../modules/network/build';
import { researchEndpoint, researchEndpointResolver, type RoutePerson } from '../../modules/network/research-path';
import type { Path } from '../../lib/enrich/connect';
import { write, inserted, restoreChanges, type Row, type Change } from '../../modules/strategy/merge';

export async function findingsNetworkProperties(check: Check) {
  const people:RoutePerson[]=[
    {id:'one',name:'Invented Unique',handle:'first'},
    {id:'two',name:'Invented Namesake',handle:'shared'},
    {id:'three',name:'Invented Namesake',handle:'shared'},
    {id:'four',name:'Inventéd Accént (Organization)'},
    {id:'five',name:'Single'},
  ];
  const endpoints:Path['other'][]=[
    {type:'lp',name:'Invented Unique',key:'missing',handle:'first'},
    {type:'lp',name:'Invented Namesake',key:'one'},
    {type:'team',name:'Invented Unique',handle:'missing'},
    {type:'team',name:'Invented Unique',handle:'shared'},
    {type:'lp',name:'Invented Unique'},
    {type:'backer',name:'Invented Namesake'},
    {type:'lp',name:'Invented Accent'},
    {type:'lp',name:'Single'},
    {type:'ours',name:'Invented Absent'},
  ];
  const resolver=researchEndpointResolver(people);
  check('FINDINGS indexed endpoints preserve explicit identity precedence and namesake refusal',
    endpoints.every(other=>resolver(other)===researchEndpoint(other,people))
      &&resolver(endpoints[0]!)===null&&resolver(endpoints[3]!)==='two'&&resolver(endpoints[5]!)===null,
    'Missing explicit IDs and handles never fall back to names; duplicate handles preserve first match and duplicate names stay ambiguous.');

  const scratch=await mkdtemp(join(tmpdir(),'plcos-findings-network-'));
  const previous=process.env.ENRICH_DIR;
  process.env.ENRICH_DIR=join(scratch,'empty-enrich');
  const db=await openTestDb(join(scratch,'db'));
  try {
    await migrate(db);
    await db.transaction(async tx=>{
      await tx.exec(`create temporary table findings_journal (
        group_id uuid not null, item_key text not null, value jsonb, at timestamptz,
        primary key(group_id,item_key)) on commit drop`);
      const group=randomUUID(),table='pg_temp.findings_journal';
      await tx.query(`insert into findings_journal values
        ($1,'first','{"initial":true}','2026-09-27 12:34:56.123456+00'),
        ($1,'second','null','2026-09-27 12:34:56.654321+00')`,[group]);
      const snapshot=()=>tx.query<{row:Row}>(`select to_jsonb(t) row from findings_journal t order by item_key`);
      const before=await snapshot(),changes:Change[]=[];
      await write(tx,changes,table,before[0]!.row,{value:{updated:['invented',null,3]}});
      const changed=await snapshot();
      await restoreChanges(tx,changes,'invented fixture');
      check('FINDINGS journal uses every typed composite key and restores exact database values',
        isDeepStrictEqual(changed[1],before[1])&&!isDeepStrictEqual(changed[0],before[0])
          &&isDeepStrictEqual(await snapshot(),before),
        'Only the matching UUID/text key changes; nullable JSON and microsecond timestamps survive reversal.');
      const added=(await tx.one<{row:Row}>(`insert into findings_journal values ($1,'third','{}',null) returning to_jsonb(findings_journal) row`,[group]))!.row;
      const additions:Change[]=[];await inserted(tx,additions,table,added);await restoreChanges(tx,additions,'invented fixture');
      const conflict:Change[]=[];await write(tx,conflict,table,before[0]!.row,{value:{revision:1}});
      await tx.query(`update findings_journal set value='{"revision":2}' where group_id=$1 and item_key='first'`,[group]);
      let refused=false;try{await restoreChanges(tx,conflict,'invented fixture');}catch{refused=true;}
      const after=await snapshot();
      check('FINDINGS journal deletes only its inserted composite key and refuses later edits',
        refused&&after.length===2&&isDeepStrictEqual(after[0]!.row.value,{revision:2})&&isDeepStrictEqual(after[1],before[1]),
        'Compare-and-restore still protects a later writer and preserves the other composite-key row.');
    });
    const actor=randomUUID(), connector=randomUUID(), targets=Array.from({length:4},()=>randomUUID());
    await db.query(`insert into platform.app_user(id,handle,name,initials,role,email)
      values ($1,'findings-fixture','Invented Fixture Connector','IF','admin','fixture@example.invalid')`,[actor]);
    await db.query(`insert into identity.entity(entity_id,entity_type,display_name)
      select id::uuid,'person'::identity.entity_type,name from jsonb_to_recordset($1::jsonb) x(id text,name text)`,
      [JSON.stringify([{id:connector,name:'Invented Fixture Connector'},...targets.map((id,i)=>({id,name:`Invented Target ${['Alpha','Bravo','Charlie','Delta'][i]}`}))])]);
    await db.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by)
      values ('app_user','findings-fixture',$1,'fixture')`,[connector]);
    let paths:Path[]=targets.map(lp=>({lp,other:{type:'lp',name:'Invented Fixture Connector',key:connector},
      kind:'board',tier:'C',basis:'Invented board tie',source:'https://example.invalid/board'}));
    const note=randomUUID();
    await db.query(`insert into research.note(note_id,entity_id,kind,body,data)
      values ($1,$2,'connection_candidates','Invented network fixture',$3)`,[note,targets[0],JSON.stringify({paths})]);
    const run=()=>withDb(db,()=>buildNetwork({awaitBackground:true}));
    const edges=()=>db.query<{id:string;target:string;tier:string;reviewer:string|null;ended:string|null}>(
      `select edge_id::text id,to_entity::text target,tier::text,reviewed_by::text reviewer,valid_to::text ended
       from network.edge where from_entity=$1 order by to_entity`,[connector]);
    await run();
    const initial=await edges();
    const firstRevision=await db.one(`select revision::text,epoch::text from network.route_revision`);
    await run();
    const repeated=await edges();
    const secondRevision=await db.one(`select revision::text,epoch::text from network.route_revision`);
    check('FINDINGS unchanged full network build keeps edge identities and topology revision',
      initial.length===4&&isDeepStrictEqual(initial,repeated)&&isDeepStrictEqual(firstRevision,secondRevision),
      'An unchanged findings import preserves cached structural routes and every generated tie ID.');
    const confirmed=initial.find(e=>e.target===targets[0])!,declined=initial.find(e=>e.target===targets[1])!;
    await withDb(db,()=>reviewEdge(actor,confirmed.id,'confirm','Invented confirmation'));
    await withDb(db,()=>reviewEdge(actor,declined.id,'decline','Invented decline'));
    paths=paths.slice(0,3).map((p,i)=>i===1?p:{...p,tier:'B',basis:'Invented updated board evidence'});
    await db.query(`update research.note set data=$2 where note_id=$1`,[note,JSON.stringify({paths})]);
    const beforeChange=await db.one<{revision:string;epoch:string}>(`select revision::text,epoch::text from network.route_revision`);
    await run();
    const changed=await edges(),afterChange=await db.one<{revision:string;epoch:string}>(`select revision::text,epoch::text from network.route_revision`);
    check('FINDINGS changed and removed research paths reconcile ties and mark changed endpoints',
      changed.length===3&&!changed.some(e=>e.target===targets[3])
        &&changed.find(e=>e.target===targets[2])?.tier==='B'
        &&afterChange?.revision!==beforeChange?.revision&&afterChange?.epoch===beforeChange?.epoch,
      'A changed tier updates the graph, a removed path disappears, and endpoint invalidation preserves the global topology epoch.');
    check('FINDINGS rebuild retains review provenance and never resurrects a declined tie',
      changed.find(e=>e.target===targets[0])?.reviewer===actor&&changed.find(e=>e.target===targets[0])?.tier==='B'
        &&changed.find(e=>e.target===targets[1])?.id===declined.id&&!!changed.find(e=>e.target===targets[1])?.ended,
      'Confirmation remains provenance while modelled evidence changes; a declined tie keeps its original ended row.');
  } finally {
    await db.close();
    if(previous===undefined)delete process.env.ENRICH_DIR;else process.env.ENRICH_DIR=previous;
    await rm(scratch,{recursive:true,force:true});
  }
}
