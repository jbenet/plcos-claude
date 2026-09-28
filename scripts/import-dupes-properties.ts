/** Import duplicate repair: invented local fixtures only. */
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withDb } from '../lib/db';
import { importFindings } from '../lib/enrich/import';
import type { Finding } from '../lib/enrich/schema';
import type { Strategy } from '../lib/enrich/strategy';
import { latestRun } from '../modules/sources';
import { mergeImportDuplicates, mergeImportDuplicatesInTransaction } from '../lib/enrich/import-dupes';
import { addProspects, type Prospect } from '../lib/enrich/prospects';
import { undoIdentityMerge } from '../modules/identity/resolution';
import { reverseEntityTypeCorrection } from '../modules/identity/entity-type';
import { reversePursuitMerge } from '../modules/strategy/merge';
import { notesFor } from '../modules/research/repo';
import type { Path } from '../lib/enrich/connect';
import type { Check, Db } from './properties/harness';

export async function importDupesProperties(check: Check, db: Db) {
  const actor = (await db.one<{ id: string }>('select id::text from platform.app_user where active order by handle limit 1'))!.id;
  const vehicle = (await db.one<{ id: string; slug: string }>("select id::text,slug from platform.vehicle where phase='active' and kind='fund' limit 1"))!;
  const ids: string[] = [];
  const document = `import-dupes-fixture:${randomUUID()}`;
  const tag = randomUUID().slice(0,8);
  const scratch = await mkdtemp(join(tmpdir(),'invented-import-dupes-'));
  const name = (s: string) => `Invented Dupe ${tag} ${s}`;
  const entity = async (label: string, type: 'person' | 'org' = 'org', source = 'prospect', sourceId?: string, resolvedBy = 'rule:sourced-prospect', created = '2026-09-01'): Promise<string> => {
    const id = randomUUID(); ids.push(id);
    await db.query('insert into identity.entity(entity_id,entity_type,display_name,created_at) values($1,$2::identity.entity_type,$3,$4)', [id,type,label,created]);
    if (source) await db.query('insert into identity.source_record(source,source_id,entity_id,resolved_by) values($1,$2,$3,$4)', [source,sourceId ?? id,id,resolvedBy]);
    return id;
  };
  const root = async (id: string) => (await db.one<{ id: string }>('select identity.canonical_entity_id($1)::text id',[id]))!.id;
  const type = async (id: string) => (await db.one<{ type: string }>('select entity_type::text type from identity.entity where entity_id=$1',[id]))!.type;
  const run = () => db.transaction(tx => mergeImportDuplicatesInTransaction(tx,actor));
  const pursuit = (id: string) => db.query("insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status,status_source) values($1,$2,$3,'new','rule')",[id,vehicle.id,actor]);
  const claim = (id: string, field = 'public.investment') => db.query("insert into research.claim(entity_id,field,value,source,as_of,confidence) values($1,$2,'Invented fixture evidence',$3,'2026-09-27','high')",[id,field,document]);
  try {
    await db.query("insert into research.source_doc(doc_id,title,kind,origin,as_of,strength,supports,body) values($1,'Invented duplicate source','fixture','https://example.org/import-dupes','2026-09-27','moderate','Invented data','Invented data')",[document]);
    const key = `invented-dupe-key:${tag}`, label = name('Cédar Capital');
    const first = await entity(label,'org','prospect',key), second = await entity(`  ${label.toUpperCase()}  `,'org','w3_person'), third = await entity(label.normalize('NFD').replace(/\p{M}/gu,''),'org','investing-organization:v1',undefined,'investing-organization:v1');
    await pursuit(first); await pursuit(second); await claim(second); await claim(second,'public.ticket');
    await db.query("insert into research.note(entity_id,kind,body,data) values($1,'connection_candidates','Invented path',$2::jsonb)",[first,JSON.stringify({paths:[{lp:first,other:{key:third,name:label},basis:'Invented path'}]})]);
    await db.query("insert into strategy.suggestion(pursuit_id,body,data,made_by,made_at,file_hash) select pursuit_id,'Invented strategy','{}','fixture','2026-09-27',$2 from strategy.pursuit where entity_id=$1",[first,tag]);
    const originalPursuit = (await db.one<{id:string}>('select pursuit_id::text id from strategy.pursuit where entity_id=$1',[first]))!.id;
    const repaired = await mergeImportDuplicates(db,actor);
    check('DUPES normalized imported organizations converge on the most referenced survivor', await root(first)===second && await root(third)===second && repaired.merges.filter(m=>[first,third].includes(m.loserId)).length===2,
      'NFKD, case and whitespace normalize; imported W3 and investing-organization nodes are eligible.');
    const references = await db.one<{ pursuits: number; claims: number; paths: number; strategies: number; sources: number }>(`select
      (select count(*)::int from strategy.active_pursuit where identity.canonical_entity_id(entity_id)=$1) pursuits,
      (select count(*)::int from research.claim where identity.canonical_entity_id(entity_id)=$1) claims,
      (select count(*)::int from research.note where kind='connection_candidates' and identity.canonical_entity_id(entity_id)=$1) paths,
      (select count(*)::int from strategy.suggestion s join strategy.active_pursuit p using(pursuit_id) where identity.canonical_entity_id(p.entity_id)=$1) strategies,
      (select count(*)::int from identity.source_record where identity.canonical_entity_id(entity_id)=$1) sources`,[second]);
    check('DUPES pursuit consolidation retains claims, paths, strategies and source references', references?.pursuits===1 && references.claims===2 && references.paths===1 && references.strategies===1 && references.sources===3,
      'Canonical projection preserves source facts and all pursuit-dependent work follows one active pursuit.');
    const retry = await run();
    check('DUPES a second pass creates no additional redirects', !retry.merges.some(m=>[first,second,third].includes(m.loserId)), 'Existing redirect components are one identity.');
    const row: Prospect = { personKey:key,name:label,entityType:'org',org:null,vehicle:vehicle.slug,status:'new',capacity:{band:'unknown',basis:'Invented fixture',guess:true},reason:'Invented duplicate regression',strategic:false,route:null,sources:['https://example.org/import-dupes'] };
    const added = await addProspects(db,actor,[{file:'invented-dupe-prospects.jsonl',text:JSON.stringify(row)}]);
    check('DUPES prospect source keys resolve to exactly one merged candidate', added.ambiguous===0 && added.invalid.length===0 && added.existing===1 && added.added===0,
      'The original source key reaches the survivor without minting another identity or pursuit.');
    const projected = await withDb(db,()=>notesFor(first,'connection_candidates'));
    const projectedPath = (projected[0]?.data.paths as Path[] | undefined)?.[0];
    const storedPath = (await db.one<{data:{paths:Path[]}}>("select data from research.note where entity_id=$1 and kind='connection_candidates'",[first]))!.data.paths[0];
    for (const merge of repaired.pursuitMerges?.merges ?? []) if (merge.survivorId===originalPursuit || merge.loserIds.includes(originalPursuit)) await reversePursuitMerge(db,merge.id,actor,'Invented full reversal');
    for (const merge of [...repaired.merges].reverse()) if ([first,second,third].includes(merge.loserId)) await undoIdentityMerge(db,merge.assertionId,'Invented full reversal');
    const restored = await db.one<{pursuits:number;strategy:string;sources:number;paths:number;claims:number}>(`select
      (select count(*)::int from strategy.active_pursuit where entity_id=any($1::uuid[])) pursuits,
      (select pursuit_id::text from strategy.suggestion where file_hash=$2) strategy,
      (select count(*)::int from identity.source_record where (source='prospect' and entity_id=$3) or (source='w3_person' and entity_id=$4) or (source='investing-organization:v1' and entity_id=$5)) sources,
      (select count(*)::int from research.note where entity_id=$3 and kind='connection_candidates') paths,
      (select count(*)::int from research.claim where entity_id=$4) claims`,[[first,second,third],tag,first,second,third]);
    check('DUPES complete reversal restores original pursuit and identity references', restored?.pursuits===2 && restored.strategy===originalPursuit && restored.sources===3 && restored.paths===1 && restored.claims===2 && await root(first)===first && await root(third)===third,
      'Reverse the journalled pursuit merge and identity redirects; original claims, paths and source ownership remain intact.');
    const reversedNotes = await withDb(db,()=>notesFor(first,'connection_candidates'));
    const reversedPath = (reversedNotes[0]?.data.paths as Path[] | undefined)?.[0];
    check('DUPES note path projection follows both canonical endpoints and reverses without rewriting evidence', storedPath?.lp===first && storedPath.other.key===third && projectedPath?.lp===second && projectedPath.other.key===second && reversedPath?.lp===first && reversedPath.other.key===third,
      'Stored JSON retains original path IDs; notesFor(alias) projects both endpoints while merged and returns the originals after undo.');

    const oldest = await entity(name('Oldest'),'org','prospect',undefined,'rule:sourced-prospect','2020-01-01');
    const newer = await entity(name('Oldest'),'org','prospect',undefined,'rule:sourced-prospect','2025-01-01');
    await run();
    check('DUPES equal reference counts prefer the oldest identity', await root(newer)===oldest, 'Creation time resolves a reference-count tie.');

    const person = await entity(name('Mistyped'),'person'), org = await entity(name('Mistyped'));
    const corrected = await run(), correction = corrected.corrected.find(c=>c.entityId===person);
    check('DUPES an imported person without person evidence is corrected and merged', !!correction && await type(person)==='org' && await root(person)===await root(org),
      'The local type correction records the original type before the identity redirect.');
    const redirect = corrected.merges.find(m=>m.loserId===person || m.loserId===org);
    if (!redirect || !correction) throw new Error('Invented mistyped fixture did not merge');
    await undoIdentityMerge(db,redirect.assertionId,'Invented undo regression');
    await reverseEntityTypeCorrection(db,correction.correctionId,actor,'Invented correction reversal');
    const veto = await run();
    check('DUPES undo restores separate identities and vetoes automatic remerge', await root(person)!==await root(org) && await type(person)==='person' && !veto.merges.some(m=>[person,org].includes(m.loserId)),
      'The identity assertion and local type reversal remain durable negative constraints.');

    for (const [label,payload] of [
      ['email',{email:'invented@example.org'}], ['role',{role:'Partner'}],
      ['personal LinkedIn',{linkedin:'https://linkedin.com/in/invented-fixture'}],
      ['personal page',{links:[{kind:'bio',url:'https://example.org/people/invented-fixture'}]}],
    ] as const) {
      const person = await entity(name(label),'person'), org = await entity(name(label));
      await db.query("insert into research.note(entity_id,kind,body,data) values($1,'public_profile','Invented person evidence',$2::jsonb)",[person,JSON.stringify(payload)]);
      const result = await run();
      check(`DUPES ${label} blocks a person/organization merge`, await type(person)==='person' && await root(person)!==await root(org) && result.ambiguous.some(a=>a.entityIds.includes(person)),
        'A namesake vehicle never overrides personal evidence.');
    }
    const affiliated = await entity(name('Affiliated'),'person'), sameOrg = await entity(name('Affiliated')), otherOrg = await entity(name('Employer'));
    await db.query("insert into identity.affiliation(person_entity,org_entity,kind,role,source,as_of,certainty) values($1,$2,'contact','not recorded','fixture','2026-09-27','claimed')",[affiliated,otherOrg]);
    const aff = await run();
    check('DUPES affiliation without a recorded role still establishes person evidence', await type(affiliated)==='person' && await root(affiliated)!==await root(sameOrg) && aff.ambiguous.some(a=>a.entityIds.includes(affiliated)),
      'Any person affiliation to another organization prevents automatic type conversion.');

    for (const source of ['affinity','dakota']) {
      const a = await entity(name(source),'org',source,`${source==='affinity'?'organization':'account'}:invented-${tag}-a`,'rule:source-owned');
      const b = await entity(name(source),'org',source,`${source==='affinity'?'organization':'account'}:invented-${tag}-b`,'rule:source-owned');
      const alias = await entity(name(`${source} alias`));
      await db.query('update identity.entity set merged_into=$2 where entity_id=$1',[a,alias]);
      await db.query('update identity.entity set display_name=$2 where entity_id=$1',[alias,name(source)]);
      const result = await run();
      check(`DUPES distinct ${source} external IDs remain ambiguous across aliases`, await root(b)!==await root(alias) && result.ambiguous.some(x=>x.entityIds.includes(b)),
        'External source conflicts include every member of each redirect component.');
    }
    const unknown = await entity(name('Unknown'),'org','unrecognized_fixture_source',undefined,'manual:fixture'), known = await entity(name('Unknown'));
    const absent = await entity(name('Absent'),'org',''), present = await entity(name('Absent'));
    const unsupported = await run();
    check('DUPES unknown and missing provenance never authorize a name-only merge', await root(unknown)!==await root(known) && await root(absent)!==await root(present) && unsupported.ambiguous.some(x=>x.entityIds.includes(unknown)),
      'A complete import-owned source history is required for every component.');

    const blockedPerson = await entity(name('Blocked triple'),'person'), blockedOrg1 = await entity(name('Blocked triple')), blockedOrg2 = await entity(name('Blocked triple'));
    await claim(blockedPerson,'public.role');
    const blockedTriple = await run();
    check('DUPES one evidenced person blocks the entire mixed-type group', await root(blockedOrg1)!==await root(blockedOrg2) && await type(blockedPerson)==='person' && blockedTriple.ambiguous.some(a=>a.entityIds.includes(blockedPerson) && a.entityIds.length===3),
      'The pass does not partially merge the organization subset before discovering person evidence.');
    const external1 = await entity(name('Resolver label'),'org','dakota',`account:label-${tag}-a`,'rule:sourced-prospect');
    const external2 = await entity(name('Resolver label'),'org','dakota',`account:label-${tag}-b`,'rule:sourced-prospect');
    const labels = await run();
    check('DUPES an internal-looking resolver cannot erase external source conflicts', await root(external1)!==await root(external2) && labels.ambiguous.some(a=>a.entityIds.includes(external1)),
      'Distinct Dakota account IDs remain distinct regardless of the resolution label.');
    const separated1 = await entity(name('Source veto')), separated2 = await entity(name('Source veto'));
    await db.query("insert into identity.match_assertion(kind,left_source,left_source_id,right_source,right_source_id,rule,undone_at,undo_reason) values('same_as','prospect',$1,'prospect',$2,'identity:v1:fixture',now(),'Invented source-only undo')",[separated1,separated2]);
    const separated = await run();
    check('DUPES source-only reversed assertions veto a new redirect', await root(separated1)!==await root(separated2) && separated.ambiguous.some(a=>a.entityIds.includes(separated1)),
      'Legacy source constraints apply even when the assertion lacks entity-ID columns.');
    const historicalPerson = await entity(name('Historical role'),'person'), historicalOrg = await entity(name('Historical role'));
    await claim(historicalPerson,'public.role'); await claim(historicalPerson,'public.investment');
    await db.query("update research.claim set superseded_by=(select claim_id from research.claim where entity_id=$1 and field='public.investment') where entity_id=$1 and field='public.role'",[historicalPerson]);
    await run();
    check('DUPES superseded role evidence still protects a person identity', await type(historicalPerson)==='person' && await root(historicalPerson)!==await root(historicalOrg),
      'New sparse research cannot erase the historical evidence that this is a person.');
    const networkPerson = await entity(name('Network affiliation'),'person'), networkOrg = await entity(name('Network affiliation'));
    await db.query("insert into network.edge(from_entity,to_entity,kind,tier,evidence,valid_from) values($1,$2,'employment','C','[{\"source\":\"fixture\",\"note\":\"Invented employment affiliation\"}]','2026-09-27')",[networkPerson,otherOrg]);
    await run();
    check('DUPES sourced network employment protects a person without an affiliation row', await type(networkPerson)==='person' && await root(networkPerson)!==await root(networkOrg),
      'Person affiliation evidence is recognized in the network as well as the affiliation table.');

    const importPerson = await entity(name('Import ordering'),'person','prospect',undefined,'rule:sourced-prospect','2020-01-01');
    const importOrg = await entity(name('Import ordering'),'org','w3_person');
    const importOrg2 = await entity(name('Import ordering'),'org','investing-organization:v1',undefined,'investing-organization:v1');
    await pursuit(importPerson); await pursuit(importOrg); await claim(importOrg); await claim(importOrg,'public.ticket');
    const finding: Finding = {key:importPerson,name:name('Import ordering'),researched:{at:'2026-09-27',by:'fixture',workflow:'W1',version:'1'},identity:{match:'confirmed',basis:'Invented organization'},facts:[{field:'investment',value:'Invented canonical import fact',confidence:'high',source:{url:`https://example.org/import-dupes-${tag}`,kind:'primary'}}]};
    const strategy: Strategy = {key:importPerson,name:finding.name,made:{at:'2026-09-27',by:'fixture',workflow:'W5',version:'1.18'},fit:{[vehicle.slug]:{verdict:'possible',why:'Invented fixture'}},scores:{capacity:{band:'unknown',basis:'Invented fixture'},affinity:{level:'unknown',basis:'Invented fixture'},propensity:{level:'unknown',basis:'Invented fixture'},timeToDecision:{band:'unknown',basis:'Invented fixture'}},angle:'Invented angle',route:null,next:{what:'Review invented evidence',who:'Fixture owner',when:'2026-10-01'},ask:{vehicle:vehicle.slug,shape:'verify first'},openQuestions:[],risks:[],list:'this year',confidence:'low'};
    await mkdir(join(scratch,'raw')); await mkdir(join(scratch,'strategy'));
    await writeFile(join(scratch,'raw',`${importPerson}.json`),JSON.stringify(finding));
    await writeFile(join(scratch,'strategy',`${importPerson}.json`),JSON.stringify(strategy));
    const imported = await withDb(db,()=>importFindings(actor,scratch));
    const storedRun = await withDb(db,()=>latestRun('enrich','import'));
    const saved = storedRun?.detail as {duplicateIdentities?:{merges:Array<{loserId:string}>}} | undefined;
    check('DUPES Import the findings corrects types, merges identities and then consolidates pursuits', imported.entityTypes?.corrected.some(c=>c.entityId===importPerson)===true && imported.entityTypes.ambiguous.every(c=>c.entityId!==importPerson) && imported.duplicateIdentities?.merges.some(m=>m.loserId===importPerson)===true && imported.duplicateIdentities.merges.some(m=>m.loserId===importOrg2) && imported.pursuitMerges?.merged===1 && saved?.duplicateIdentities?.merges.some(m=>m.loserId===importPerson)===true,
      'The server import resolves the initial two-org type ambiguity, reports the correction once and consolidates pursuits after both redirects.');
    const canonicalWrites = await db.one<{claims:number;notes:number;strategies:number;aliases:number}>(`select
      (select count(*)::int from research.claim where entity_id=$1 and value='Invented canonical import fact') claims,
      (select count(*)::int from research.note where entity_id=$1 and kind='public_profile') notes,
      (select count(*)::int from strategy.suggestion s join strategy.active_pursuit p using(pursuit_id) where identity.canonical_entity_id(p.entity_id)=$1 and s.data->>'key'=$1::text) strategies,
      (select count(*)::int from research.claim where entity_id=$2 and value='Invented canonical import fact') aliases`,[importOrg,importPerson]);
    check('DUPES post-merge findings and strategies write the canonical identity', canonicalWrites?.claims===1 && canonicalWrites.notes===1 && canonicalWrites.strategies===1 && canonicalWrites.aliases===0,
      'File keys stay valid while new claims, profiles and strategy payloads use the survivor.');
  } finally {
    await rm(scratch,{recursive:true,force:true});
    const pursuits = (await db.query<{ id: string }>('select pursuit_id::text id from strategy.pursuit where entity_id=any($1::uuid[])',[ids])).map(r=>r.id);
    await db.query('delete from strategy.pursuit_merge where survivor_id=any($1::uuid[]) or loser_ids && $1::uuid[]',[pursuits]);
    for (const table of ['strategy.suggestion','strategy.pursuit_update','strategy.pursuit_owner']) await db.query(`delete from ${table} where pursuit_id=any($1::uuid[])`,[pursuits]);
    await db.query('delete from research.note where entity_id=any($1::uuid[])',[ids]);
    await db.query('delete from research.claim where entity_id=any($1::uuid[])',[ids]);
    await db.query('delete from research.source_doc where doc_id=$1 or origin=$2',[document,`https://example.org/import-dupes-${tag}`]);
    await db.query('delete from network.edge where from_entity=any($1::uuid[]) or to_entity=any($1::uuid[])',[ids]);
    await db.query('delete from identity.affiliation where person_entity=any($1::uuid[]) or org_entity=any($1::uuid[])',[ids]);
    await db.query('delete from identity.entity_type_correction where entity_id=any($1::uuid[])',[ids]);
    await db.query('delete from identity.match_assertion where merged_entity=any($1::uuid[]) or canonical_entity=any($1::uuid[]) or left_source_id=any($1::text[])',[ids]);
    await db.query('delete from identity.possible_match where left_entity=any($1::uuid[]) or right_entity=any($1::uuid[])',[ids]);
    await db.query('delete from identity.source_record where entity_id=any($1::uuid[])',[ids]);
    await db.query('delete from strategy.pursuit where entity_id=any($1::uuid[])',[ids]);
    await db.query('update identity.entity set merged_into=null where entity_id=any($1::uuid[])',[ids]);
    await db.query('delete from identity.entity where entity_id=any($1::uuid[])',[ids]);
  }
}
