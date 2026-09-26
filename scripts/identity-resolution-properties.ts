import { randomUUID } from 'node:crypto';
import type { Check, Db } from './properties/harness';
import { resolveIdentities, undoIdentityMerge, type IdentityEvidence } from '../modules/identity/resolution';
import { addProspects, type Prospect } from '../lib/enrich/prospects';
import { poolChecks } from '../modules/pipeline/repo';

/** Invented source identities only; no fixture contains an actual LP record. */
export async function identityResolutionProperties(check: Check, db: Db) {
  const ids: string[] = [], evidence: IdentityEvidence[] = [];
  const sourceKeys = new Map<string, { source: string; key: string }>();
  const person = async (name: string, source: string, ev: Omit<IdentityEvidence, 'entityId'> = {}, type = 'person') => {
    const id: string = randomUUID(), key = `idres:invented:${id}`;
    await db.query('insert into identity.entity (entity_id,entity_type,display_name) values($1,$2::identity.entity_type,$3)', [id,type,name]);
    await db.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by) values($1,$2,$3,'invented:identity-properties')`, [source,key,id]);
    ids.push(id); sourceKeys.set(id, { source, key }); evidence.push({ entityId:id, ...ev }); return id;
  };
  const root = async (id: string) => (await db.one<{ id:string }>('select identity.canonical_entity_id($1::uuid)::text id',[id]))!.id;
  const allAt = async (items: string[], canonical: string) => (await Promise.all(items.map(root))).every(id => id===canonical);
  const org = { organizations: ['Invented Harbor Partners'] };
  try {
    const affinity = await person('IDRES Invented Élodie  Harbor', 'affinity', {organizations:['Invented Harbor Partners (formerly known as Invented Cove)']});
    const research = await person('  idres invented elodie Harbor ', 'w3_person', {organizations:['Invented Cove']});
    const nameOnly = await Promise.all(['affinity','warehouse'].map(s=>person('IDRES Invented Namesake',s)));
    const sameSource = await Promise.all(['affinity','affinity'].map(s=>person('IDRES Invented Affinity Namesake',s,org)));
    const orgOnly = await Promise.all(['affinity','network_org'].map(s=>person('IDRES Invented Organization',s,org,'org')));
    const preference: Array<{ids:string[]; canonical:string}> = [];
    for (const [i,sources] of [['prospect','w3_person','warehouse','affinity'],['prospect','w3_person','warehouse'],['prospect','w3_person']].entries()) {
      const group=[]; for(const source of sources)group.push(await person(`IDRES Invented Preference ${i}`,source,org));
      preference.push({ids:group,canonical:group.at(-1)!});
    }
    const domains = [await person('IDRES Invented Domain','affinity',{domains:['One@invented.example']}),
      await person('IDRES Invented Domain','prospect',{domains:['INVENTED.EXAMPLE']})];
    const warehouse = await person('IDRES Invented Warehouse','warehouse');
    const warehouseResearch = await person('IDRES Invented Warehouse','w3_person',{warehouseIds:[sourceKeys.get(warehouse)!.key]});
    const referenced = await person('IDRES Invented Reference','affinity');
    const referenceResearch = await person('IDRES Invented Reference','w3_person',{references:[`affinity:${sourceKeys.get(referenced)!.key}`]});
    const undo = [await person('IDRES Invented Undo','affinity',org),await person('IDRES Invented Undo','prospect',org)];
    const negative = [await person('IDRES Invented Negative','affinity',org),await person('IDRES Invented Negative','warehouse',org),await person('IDRES Invented Negative','w3_person',org)];
    const left=sourceKeys.get(negative[0]!)!,right=sourceKeys.get(negative[2]!)!;
    await db.query(`insert into identity.match_assertion(kind,left_source,left_source_id,right_source,right_source_id,note)
      values('not_same_as',$1,$2,$3,$4,'Invented disambiguating evidence')`,[left.source,left.key,right.source,right.key]);
    const uncertainNegative=[await person('IDRES Invented Negative Possible','affinity',org),
      await person('IDRES Invented Negative Possible','warehouse',org),await person('IDRES Invented Negative Possible','w3_person')];
    const uncertainLeft=sourceKeys.get(uncertainNegative[0]!)!,uncertainRight=sourceKeys.get(uncertainNegative[2]!)!;
    await db.query(`insert into identity.match_assertion(kind,left_source,left_source_id,right_source,right_source_id,note)
      values('not_same_as',$1,$2,$3,$4,'Invented namesake correction also prohibits uncertainty bridge')`,
      [uncertainLeft.source,uncertainLeft.key,uncertainRight.source,uncertainRight.key]);
    const prospectPair=[await person('IDRES Invented Prospect Clean','affinity',org),await person('IDRES Invented Prospect Clean','w3_person',org)];
    const counts=await resolveIdentities(db,evidence);
    check('IDRES matching folds accents, case and whitespace and recognizes formerly known as affiliations',
      await root(research)===affinity && counts.merges>0 && (counts.mergesByRule.affiliation??0)>0,
      'Two invented spellings resolve only with their shared historical organization as recorded corroboration.');
    const possible=await db.query<{left_entity:string;right_entity:string;confidence:string}>(`select left_entity::text,right_entity::text,confidence::text from identity.possible_match where active and left_entity=any($1::uuid[])`,[nameOnly]);
    check('IDRES matching leaves name-only candidates distinct with explicit low-confidence possible matches',
      await root(nameOnly[0]!)!==await root(nameOnly[1]!) && possible.some(p=>nameOnly.includes(p.right_entity)&&Number(p.confidence)===0.25),
      'Name equality alone supplies a possible match, never a merge.');
    check('IDRES only cross-source people enter the automatic resolver',
      await root(sameSource[0]!)!==await root(sameSource[1]!) && await root(orgOnly[0]!)!==await root(orgOnly[1]!),
      'Two Affinity namesakes and organization records remain separate even with matching affiliations.');
    check('IDRES canonical preference is Affinity, then warehouse, then W3, then prospect',
      (await Promise.all(preference.map(p=>allAt(p.ids,p.canonical)))).every(Boolean),
      'Three independent invented clusters exercise every priority boundary regardless of UUID merge order.');
    check('IDRES email domains, carried warehouse IDs and explicit identity findings independently corroborate names',
      await root(domains[1]!)===domains[0] && await root(warehouseResearch)===warehouse && await root(referenceResearch)===referenced
      && (counts.mergesByRule.email_domain??0)>0 && (counts.mergesByRule.warehouse_id??0)>0 && (counts.mergesByRule.finding_identity??0)>0,
      'Each corroboration is tested in an isolated pair without organization evidence.');
    check('IDRES negative identity assertions constrain transitive components',
      await root(negative[0]!)!==await root(negative[2]!),
      'A shared middle-source identity cannot reconnect a pair explicitly recorded as different people.');
    const forbiddenPossible=await db.query(`select edge_id from identity.possible_match where active
      and left_entity=any($1::uuid[]) and right_entity=any($1::uuid[])`,[uncertainNegative]);
    check('IDRES corrected identities cannot reconnect through an alias possible-match bridge',
      await root(uncertainNegative[0]!)===await root(uncertainNegative[1]!) && forbiddenPossible.length===0,
      'A disambiguating assertion applies to the entire canonical component, including name-only candidates on another source alias.');
    const epoch=(await db.one<{epoch:string}>('select epoch::text from network.route_revision where singleton'))!.epoch;
    const repeated=await resolveIdentities(db,evidence);
    check('IDRES repeated unchanged resolution neither remerges identities nor invalidates route caches',
      repeated.merges===0 && (await db.one<{epoch:string}>('select epoch::text from network.route_revision where singleton'))!.epoch===epoch,
      'Possible matches retain their evidence identity without publishing a changed topology on a no-op pass.');
    const assertion=(await db.one<{assertion_id:string;rule:string;signals:unknown}>(`select assertion_id::text,rule,signals from identity.match_assertion where merged_entity=$1 and undone_at is null`,[undo[1]]))!;
    const undone=await undoIdentityMerge(db,assertion.assertion_id,'Invented correction: distinct namesakes');
    const twice=await undoIdentityMerge(db,assertion.assertion_id,'Invented correction repeated');
    await resolveIdentities(db,evidence);
    check('IDRES every merge records its rule and signals; undo survives resolver reruns',
      assertion.rule==='identity:v1:affiliation' && Boolean(assertion.signals) && undone && !twice && await root(undo[0]!)!==await root(undo[1]!),
      'An audited correction reverses its pointer once and prevents the next build from repeating that merge.');
    const actor=(await db.one<{id:string}>(`select id::text from platform.app_user where active order by handle limit 1`))!.id;
    const vehicleIds=await db.query<{id:string}>(`select id::text from platform.vehicle where phase<>'historical' order by slug limit 2`);
    for(const [i,entity] of [affinity,research].entries())await db.query(
      `insert into pipeline.exposure(entity_id,vehicle_id,instrument,track,amount,owner_id)
       values($1,$2,'lp_commitment','soft',$3,$4)`,[entity,vehicleIds[i]!.id,i+1,actor]);
    await db.query(`insert into pipeline.capital_pool(entity_id,budget,source,as_of,verified_by)
      values($1,10,'Invented merged-record budget',current_date,$2)`,[research,actor]);
    const pooled=(await poolChecks()).find(p=>p.entityId===affinity);
    check('IDRES a budget on an alias checks every exposure on the canonical person',
      pooled?.total===3 && pooled.budget===10 && pooled.status==='ok' && pooled.committed.length===2,
      'The two separate vehicle exposures remain separate records and consume one documented capital pool.');
    await db.query(`insert into pipeline.capital_pool(entity_id,budget,source,as_of,verified_by)
      values($1,20,'Invented conflicting alias budget',current_date,$2)`,[affinity,actor]);
    const conflicting=(await poolChecks()).find(p=>p.entityId===affinity);
    check('IDRES conflicting alias budgets are not silently combined or selected',
      conflicting?.budget===null && conflicting.status==='no_budget' && Boolean(conflicting.budgetSource?.includes('Multiple budgets')),
      'Two independently recorded budgets require reconciliation before any capital-pool check can pass.');
    const vehicle=(await db.one<{slug:string}>(`select slug from platform.vehicle where phase<>'historical' order by slug limit 1`))!.slug;
    const record:Prospect={personKey:sourceKeys.get(prospectPair[1]!)!.key,name:'IDRES Invented Prospect Clean',org:null,vehicle,status:'new',
      capacity:{band:'$500K–$1M',basis:'Invented fixture capacity.',guess:true},reason:'Invented prospect import after identity resolution.',
      strategic:false,route:null,sources:['https://example.org/invented-identity']};
    const imported=await addProspects(db,actor,[{file:'invented-idres-prospects.jsonl',text:JSON.stringify(record)+'\n'}]);
    const pursuits=await db.query<{entity_id:string}>(`select entity_id::text from strategy.pursuit where entity_id=any($1::uuid[])`,[prospectPair]);
    check('IDRES a prospect source key that merges cleanly resolves to one canonical pursuit',
      imported.added===1 && imported.ambiguous===0 && pursuits.length===1 && pursuits[0]!.entity_id===prospectPair[0],
      'The original Affinity and W3 records remain stored; the import follows the W3 source key to their single canonical identity.');
  } finally {
    await db.query('delete from pipeline.exposure where entity_id=any($1::uuid[])',[ids]);
    await db.query('delete from pipeline.capital_pool where entity_id=any($1::uuid[])',[ids]);
    await db.query('delete from research.note where entity_id=any($1::uuid[])',[ids]);
    await db.query('delete from strategy.pursuit where entity_id=any($1::uuid[])',[ids]);
    await db.query('delete from identity.possible_match where left_entity=any($1::uuid[]) or right_entity=any($1::uuid[])',[ids]);
    await db.query(`delete from identity.match_assertion where left_source_id like 'idres:invented:%' or right_source_id like 'idres:invented:%'`,[]);
    await db.query('delete from identity.source_record where entity_id=any($1::uuid[])',[ids]);
    await db.query('delete from identity.entity where entity_id=any($1::uuid[])',[ids]);
  }
}
