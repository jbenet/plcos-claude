/** Creation contract, invented records only. Each run owns a disposable database. */
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Check } from './harness';
import { openTestDb } from './database';
import { migrate } from '../../lib/db/migrate';
import { withDb } from '../../lib/db';
import { resolveEntity } from '../../modules/identity/create';
import { createEntity } from '../../modules/identity';
import { resolveIdentities } from '../../modules/identity/resolution';
import { reverseIdentitySeparation } from '../../lib/enrich/identity-decisions';
import { mergeImportDuplicatesInTransaction } from '../../lib/enrich/import-dupes';
import { exportIdentityReview } from '../../lib/enrich/identity-review-export';
import { addProspects, type Prospect } from '../../lib/enrich/prospects';
import { directEntityInsertViolation } from '../identity-creation-boundary';

export async function creationProperties(check:Check) {
  const dir=await mkdtemp(join(tmpdir(),'invented-create-match-')), db=await openTestDb(join(dir,'db'));
  try {
    await migrate(db);
    const pair=async(a:string,b:string)=>!!await db.one(`select 1 from identity.possible_match where active and left_entity=least($1::uuid,$2::uuid) and right_entity=greatest($1::uuid,$2::uuid)`,[a,b]);
    const create=(name:string,extra:Partial<Parameters<typeof resolveEntity>[1]>={})=>resolveEntity(db,{type:'person',name,...extra});
    const first=await create('Invented Élan Vale',{source:'fixture-a',sourceId:'42',domains:['contact@cedar.example'],organizations:['Invented Cedar']});
    const external=await create('Renamed at source',{source:'fixture-a',sourceId:'42'});
    const sameName=await create('  INVENTED ELAN   VALE  ',{source:'fixture-b',sourceId:'42',domains:['CEDAR.EXAMPLE']});
    const differentSource=await create('Invented Someone Else',{source:'fixture-c',sourceId:'42'});
    check('CREATE source keys are source-scoped and outrank spelling; normalized name plus business email domain attaches',
      external.id===first.id && sameName.id===first.id && differentSource.id!==first.id && !sameName.created,
      'Repeated numeric IDs across sources are unrelated; accents/case/whitespace normalize.');
    const concurrent=await Promise.all([1,2].map(()=>create('Invented Concurrent',{source:'fixture',sourceId:'concurrent',domains:['concurrent.example']})));
    check('CREATE concurrent source arrivals create one identity and one evidence note',concurrent[0]!.id===concurrent[1]!.id
      && concurrent.filter(r=>r.created).length===1
      && (await db.one<{n:number}>("select count(*)::int n from research.note where entity_id=$1 and kind='identity_creation'",[concurrent[0]!.id]))?.n===1,
      'Identity and source locks serialize lookup, attachment and evidence writes.');
    const namesake=await create('Invented Élan Vale',{source:'fixture-d',sourceId:'42'});
    check('CREATE name-only duplicate is separate and queued before any export',namesake.id!==first.id && await pair(first.id,namesake.id),'Pair is committed with entity creation.');
    const a=await create('Invented Free Mail',{domains:['first@gmail.com']});
    const b=await create('Invented Free Mail',{domains:['second@gmail.com']});
    const c=await create('Invented Free Mail',{domains:['proton.me']});
    check('CREATE free-mail domains never corroborate names',new Set([a.id,b.id,c.id]).size===3 && await pair(a.id,b.id),'Gmail and Proton namesakes remain unresolved.');
    const url=await create('Invented URL',{personalUrls:['https://www.linkedin.com/in/invented-cedar/?utm_source=fixture']});
    const urlMatch=await create('Invented URL',{personalUrls:['http://linkedin.com/in/invented-cedar#bio']});
    const companyA=await create('Invented Company Page',{personalUrls:['https://linkedin.com/company/invented-cedar']});
    const companyB=await create('Invented Company Page',{personalUrls:['https://linkedin.com/company/invented-cedar']});
    check('CREATE personal URLs normalize tracking/scheme and reject company pages',url.id===urlMatch.id && companyA.id!==companyB.id,'Shared employer profile is not a personal identity.');
    const affiliation=await create('Invented Affiliation',{organizations:['Invented Willow, Inc.']});
    const affiliationMatch=await create('Invented Affiliation',{organizations:['Invented Willow Inc']});
    const org=await create('Invented Affiliation',{type:'org',organizations:['Invented Willow Inc']});
    check('CREATE affiliation corroborates normalized names without crossing entity types',affiliation.id===affiliationMatch.id && org.id!==affiliation.id,'Person and organization stay distinct.');
    const strong=await create('Invented Priority',{domains:['priority.example']});
    const weaker=await create('Invented Priority',{organizations:['Invented Shared Employer']});
    const preferred=await create('Invented Priority',{domains:['priority.example'],organizations:['Invented Shared Employer']});
    check('CREATE contact evidence outranks affiliation evidence',preferred.id===strong.id && preferred.id!==weaker.id,'Resolver applies one ordered policy.');
    const ambiguousA=await create('Invented Ambiguous',{source:'fixture',sourceId:'amb-a'});
    const ambiguousB=await create('Invented Ambiguous',{source:'fixture',sourceId:'amb-b'});
    await create('Invented Ambiguous',{source:'fixture',sourceId:'amb-a',domains:['ambiguous.example']});
    await create('Invented Ambiguous',{source:'fixture',sourceId:'amb-b',domains:['ambiguous.example']});
    const ambiguous=await create('Invented Ambiguous',{domains:['ambiguous.example']});
    check('CREATE conflicting corroborated candidates never pick an arbitrary winner',ambiguous.created && await pair(ambiguous.id,ambiguousA.id) && await pair(ambiguous.id,ambiguousB.id),'All candidate pairs are queued.');
    const separated=await create('Invented Separated',{source:'fixture',sourceId:'separated',domains:['separated.example']});
    await db.query(`insert into identity.match_assertion(kind,left_source,left_source_id,right_source,right_source_id) values('not_same_as','fixture','separated','fixture','future')`);
    const future=await create('Invented Separated',{source:'fixture',sourceId:'future',domains:['separated.example']});
    check('CREATE human source separation defeats automatic attachment',future.id!==separated.id && !await pair(future.id,separated.id),'Existing separation is not reopened.');
    const canonical=await create('Invented Canonical',{source:'fixture',sourceId:'canonical',domains:['canonical.example']});
    const alias=await create('Invented Alias',{source:'fixture',sourceId:'alias'});
    await db.query('update identity.entity set merged_into=$2 where entity_id=$1',[alias.id,canonical.id]);
    const redirected=await create('Invented Alias',{source:'fixture',sourceId:'alias'});
    check('CREATE existing source keys follow canonical redirects',redirected.id===canonical.id,'No third entity or source rebind.');
    const manual=await withDb(db,()=>createEntity('person','Invented Manual',{organizations:['Invented Manual Org']}));
    const manualMatch=await withDb(db,()=>createEntity('person','Invented Manual',{organizations:['Invented Manual Org']}));
    const manualNamesake=await withDb(db,()=>createEntity('person','Invented Manual'));
    check('CREATE manual entry uses the same corroboration and immediate review queue',manual.entityId===manualMatch.entityId && manualNamesake.entityId!==manual.entityId && await pair(manual.entityId,manualNamesake.entityId),'Manual entry API accepts optional evidence.');
    const orgA=await create('Invented Organization Queue',{type:'org',source:'network_org',sourceId:'invented-queue-a'});
    const orgB=await create('Invented Organization Queue',{type:'org',source:'prospect_org',sourceId:'invented-queue-b'});
    const groups=await db.transaction(tx=>exportIdentityReview(tx));
    check('CREATE W13 exports manual and organization creation queues without silently merging names',
      groups.some(g=>g.members.some(m=>m.entityId===manual.entityId)&&g.members.some(m=>m.entityId===manualNamesake.entityId))
      && groups.some(g=>g.members.some(m=>m.entityId===orgA.id)&&g.members.some(m=>m.entityId===orgB.id)),
      'Creation queue groups reach the existing review/decision format immediately.');
    for(const match of ['confirmed','ambiguous','not_found']) {
      const name=`Invented Legacy Bio ${match}`,bio=`https://invented.example/bio/${match}`;
      const existing=await create(name);
      await db.query(`insert into research.note(entity_id,kind,body,data) values($1,'public_profile','Invented profile',$2::jsonb)`,[existing.id,
        JSON.stringify({identity:{match,links:[{kind:'bio',url:bio}]},researched:{at:'2026-09-29',by:'invented'}})]);
      const next=await create(name,{personalUrls:[bio]});
      check(`CREATE legacy profile ${match} uses only resolved identity evidence`,(next.id===existing.id)===(match==='confirmed'),
        'Bio URLs corroborate confirmed profiles; unresolved profiles never corroborate attachment.');
    }
    const actor=randomUUID(),vehicle=randomUUID();
    await db.query(`insert into platform.app_user(id,handle,name,initials,role,email) values($1,'invented','Invented Operator','IO','fixture','')`,[actor]);
    await db.query(`insert into platform.vehicle(id,slug,name,kind,exemption,target_amount) values($1,'invented-create','Invented Vehicle','fund','506(c)',1000)`,[vehicle]);
    const reviewGroup=groups.find(g=>g.members.some(m=>m.entityId===manual.entityId)&&g.members.some(m=>m.entityId===manualNamesake.entityId))!;
    const reviewed=await db.transaction(tx=>mergeImportDuplicatesInTransaction(tx,actor,[],[],{decisions:[{line:1,value:{group:reviewGroup.group,
      decision:'separate',decided_by:'invented-reviewer',evidence:[{source:'https://invented.example/identity',as_of:'2026-09-29',quote:'Invented local comparison: these namesakes are distinct people.'}]}}]}));
    check('CREATE queued groups accept existing W13 separation decisions',reviewed.decisions?.applied===1 && !await pair(manual.entityId,manualNamesake.entityId),
      'Human separation consumes the exported group and clears its active creation pair.');
    const reversed=await reverseIdentitySeparation(db,reviewed.decisions!.separations[0]!.assertionId,actor,'Invented request to review again');
    const reopened=await db.transaction(tx=>exportIdentityReview(tx));
    check('CREATE reversing a W13 separation reopens its creation queue',reversed && await pair(manual.entityId,manualNamesake.entityId)
      && reopened.some(g=>g.group===reviewGroup.group),'The original decision receipt remains consumed; review can resume.');
    const prospectBase=await create('Invented Prospect Match',{organizations:['Invented Prospect Org']});
    const prospect:Prospect={personKey:'invented-prospect-1',name:'Invented Prospect Match',org:'Invented Prospect Org',vehicle:'invented-create',status:'new',capacity:{band:'unknown',basis:'Invented',guess:true},reason:'Invented',strategic:false,route:null,sources:['https://invented.example/profile']};
    await addProspects(db,actor,[{file:'invented.jsonl',text:JSON.stringify(prospect)}]);
    await addProspects(db,actor,[{file:'invented.jsonl',text:JSON.stringify({...prospect,personKey:'invented-prospect-2',org:null})}]);
    const prospectRows=await db.query<{source_id:string;entity_id:string}>(`select source_id,entity_id::text from identity.source_record where source='prospect'`);
    const p1=prospectRows.find(r=>r.source_id==='invented-prospect-1')?.entity_id,p2=prospectRows.find(r=>r.source_id==='invented-prospect-2')?.entity_id;
    check('CREATE prospect import attaches affiliation matches and queues namesakes immediately',p1===prospectBase.id && !!p2 && p2!==p1 && await pair(p1,p2),'Distinct prospect keys reach the same resolver.');
    await resolveIdentities(db);
    check('CREATE later resolution passes preserve unresolved creation pairs',await pair(orgA.id,orgB.id),'An unrelated batch cannot clear the organization review queue.');
    const count=Number((await db.one<{n:string}>('select count(*)::text n from identity.entity'))!.n);
    const rollback=new Error('invented rollback');
    try {await db.transaction(async tx=>{await resolveEntity(tx,{type:'person',name:'Invented Rollback'});throw rollback;});}catch(error){if(error!==rollback)throw error;}
    check('CREATE entity, evidence, mapping and review work share the caller transaction',Number((await db.one<{n:string}>('select count(*)::text n from identity.entity'))!.n)===count,'Failed creation transaction leaves no entity.');
  } finally {await db.close();await rm(dir,{recursive:true,force:true});}
  check('CREATE boundary blocks direct writes in app, module and operational scripts',
    ['lib/new-import.ts','app/api/entity/route.ts','modules/identity/repo.ts','scripts/new-import.ts'].every(path=>
      directEntityInsertViolation(path,'INSERT /* comment */ INTO "identity"."entity" (display_name) VALUES ($1)'))
      && !directEntityInsertViolation('modules/identity/create.ts','insert into identity.entity values ($1)')
      && !directEntityInsertViolation('lib/correct.ts','insert into identity.entity_type_correction values ($1)'),
    'Only the resolver and explicitly scoped legacy fixture writers may insert entities.');
}
