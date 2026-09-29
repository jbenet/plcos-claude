import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Check } from './properties/harness';
import { openTestDb } from './properties/database';
import { withDb } from '../lib/db';
import { importFindings } from '../lib/enrich/import';
import { migrate } from '../lib/db/migrate';
import { resolveEntity } from '../modules/identity/create';
import { importNetworkNodes, planNetworkNodes, type NodeSpec } from '../modules/network/nodes';
import { resolveConnectionPeople } from '../lib/enrich/connection-people';
import { connectionPersonKey, type Path } from '../lib/enrich/connect';

export async function createMatchNetworkProperties(check: Check) {
  const scratch=await mkdtemp(join(tmpdir(),'plcos-create-match-network-'));
  const db=await openTestDb(join(scratch,'db'));
  try {
    await migrate(db);
    await db.transaction(async tx=>{
      const original=await resolveEntity(tx,{type:'person',name:'Invented Network Cedar',source:'fixture',sourceId:'cedar',domains:['cedar.example']});
      const node=(key:string,domains?:string[]):NodeSpec=>({key:`warehouse:${key}`,source:'warehouse',sourceId:key,name:'Invented Network Cedar',type:'person',domains});
      const counts=await importNetworkNodes(tx,{nodes:[node('domain',['cedar.example']),node('namesake')],edges:[],warehouseLoaded:true});
      const mappings=await tx.query<{source_id:string;entity_id:string}>("select source_id,entity_id::text from identity.source_record where source='warehouse'");
      const attached=mappings.find(r=>r.source_id==='domain')?.entity_id;
      const separate=mappings.find(r=>r.source_id==='namesake')?.entity_id;
      check('CREATE network warehouse attaches corroborated identities and queues name-only matches immediately',
        attached===original.id && !!separate && separate!==original.id && counts.nodesCreated===1 && !!await tx.one('select 1 from identity.possible_match where active and left_entity=least($1::uuid,$2::uuid) and right_entity=greatest($1::uuid,$2::uuid)',[original.id,separate]),
        'Invented warehouse domains corroborate identity; the namesake is separately reviewable before export.');
      const name='Invented W3 Alder',source='https://invented.example/bio/alder',key=connectionPersonKey(name,source);
      const before=await resolveEntity(tx,{type:'person',name,source:'fixture',sourceId:'alder'});
      const path:Path={lp:key,lpPerson:{key,name,source},other:{type:'lp',key:original.id,name:'Invented Network Cedar'},kind:'met',tier:'B',basis:'Invented meeting evidence'};
      const first=await resolveConnectionPeople(tx,[path]);
      const second=await resolveConnectionPeople(tx,[path]);
      check('CREATE W3 namesakes enter review on first import and stable descriptors retry without new people',
        first.length===1 && first[0]!.lp!==before.id && second[0]?.lp===first[0]!.lp && !!await tx.one('select 1 from identity.possible_match where active and left_entity=least($1::uuid,$2::uuid) and right_entity=greatest($1::uuid,$2::uuid)',[before.id,first[0]!.lp]),
        'The W3 importer retains deterministic keys and emits the review pair in its transaction.');
      const findingName='Invented Findings Birch',findingSource='https://invented.example/bio/birch',findingKey=connectionPersonKey(findingName,findingSource);
      const findingOriginal=await resolveEntity(tx,{type:'person',name:findingName,source:'fixture',sourceId:'birch',organizations:['Invented Birch Institute']});
      const findingPath:Path={...path,lp:findingKey,lpPerson:{key:findingKey,name:findingName,source:findingSource}};
      const findingResolved=await resolveConnectionPeople(tx,[findingPath],()=>{}, {findings:[{file:'invented.json',index:0,value:{key:findingKey,name:findingName,researched:{at:'2026-09-29',by:'invented',workflow:'W1',version:'1'},identity:{match:'confirmed',basis:'Invented biography',canonical:{org:'Invented Birch Institute'}},facts:[],connections:[]}}]});
      check('CREATE findings identity phase uses keyed affiliation evidence before creating W3 people',
        findingResolved[0]?.lp===findingOriginal.id,
        'Invented findings corroborate the same name and institution through the shared resolver.');
    });
    const lp=(await db.one<{id:string}>("select entity_id::text id from identity.source_record where source='fixture' and source_id='cedar'"))!.id;
    const name='Invented Imported Findings Ash',source='https://invented.example/bio/ash',key=connectionPersonKey(name,source);
    const original=await resolveEntity(db,{type:'person',name,organizations:['Invented Ash Institute']});
    await mkdir(join(scratch,'raw'));
    await writeFile(join(scratch,'raw',`${key}.json`),JSON.stringify({key,name,researched:{at:'2026-09-29',by:'invented',workflow:'W1',version:'1'},
      identity:{match:'confirmed',basis:'Invented biography',canonical:{org:'Invented Ash Institute'}},facts:[],connections:[]}));
    await writeFile(join(scratch,'connections.jsonl'),JSON.stringify({lp,other:{type:'backer',name,key,person:{key,name,source}},
      kind:'other',tier:'C',basis:'Invented association',source}));
    await withDb(db,()=>importFindings(null,scratch));
    const imported=await db.one<{id:string}>("select entity_id::text id from identity.source_record where source='w3_person' and source_id=$1",[key]);
    check('CREATE findings import routes materialized endpoints through shared matching',imported?.id===original.id,
      'The complete file importer attaches its W3 endpoint before writing paths.');
    const plan=planNetworkNodes({warehouse:{people:[],ties:[],matches:[]},candidates:[],team:[{handle:'invented',name:'Invented Team Rowan',roles:[],prior:[],education:[]}],graph:[{
      id:'invented-row',from:{name:'Invented Team Rowan',type:'person'},to:{name:'Invented Harbor',type:'organization'},kind:'proximity',claim:'Invented research',
      provenance:{source:'https://invented.example/research',as_of:'2026-09-29',confidence:'low',last_verified_by:null},evidenceTier:{proposed:'D'},
    }],direct:[],findings:[]});
    check('CREATE research endpoints never attach to a team member by name alone',plan.nodes.filter(n=>n.name==='Invented Team Rowan').length===2,
      'Explicit team handles remain authoritative; a same-name research endpoint reaches the shared resolver.');
  } finally { await db.close(); await rm(scratch,{recursive:true,force:true}); }
}
