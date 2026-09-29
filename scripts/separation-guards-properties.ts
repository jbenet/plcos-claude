/** Invented compact separation constraints exercise the production merge entrances. */
import { randomUUID } from 'node:crypto';
import type { Check, Db } from './properties/harness';
import { readSeparationGroups, violatesSeparationGroup } from '../modules/identity/separation-groups';
import { resolveIdentities } from '../modules/identity/resolution';
import { resolveEntity } from '../modules/identity/create';
import { applyIdentityDecisions, identityReviewGroupId } from '../lib/enrich/identity-decisions';
import { mergeImportDuplicatesInTransaction, type ImportDuplicateReport } from '../lib/enrich/import-dupes';

export async function separationGuardsProperties(check: Check, db: Db) {
  const rollback = new Error('rollback invented separation guard fixtures');
  try {
    await db.transaction(async tx => {
      const tag = randomUUID(), group = `invented-separation-${tag}`;
      const entity = async (name: string, source: string) => {
        const id = randomUUID();
        await tx.query(`insert into identity.entity(entity_id,entity_type,display_name) values($1,'person',$2)`,[id,`${name} ${tag}`]);
        await tx.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by) values($1,$2::text,$2::uuid,'fixture')`,[source,id]);
        return id;
      };
      const anchor = await entity('Invented former name anchor','affinity');
      const left = await entity('Invented renamed members','warehouse');
      const right = await entity('Invented renamed members','w3_person');
      const alias = await entity('Invented older alias','prospect');
      const outsider = await entity('Invented renamed members','prospect');
      await tx.query('update identity.entity set merged_into=$2 where entity_id=$1',[alias,left]);
      const assertion = async (member: string, source: string, compact: boolean) => tx.query(`insert into identity.match_assertion
        (kind,left_source,left_source_id,right_source,right_source_id,merged_entity,canonical_entity,rule,signals)
        values('not_same_as',$1,$2::text,'affinity',$3::text,$2::uuid,$3::uuid,'identity:v1:fixture',$4::jsonb)`,
      [source,member,anchor,JSON.stringify(compact ? {separationGroup:group} : {})]);
      await assertion(alias,'prospect',true);
      await assertion(right,'w3_person',true);
      const groups = await readSeparationGroups(tx);
      check('SEPARATION GROUP canonical aliases constrain non-anchor members',
        violatesSeparationGroup([left,right],groups) && !violatesSeparationGroup([left,outsider],groups),
        'An alias endpoint projects to its current root; one group member and an outsider remain permitted.');
      const plainLeft = await entity('Invented ordinary pair left','prospect');
      const plainRight = await entity('Invented ordinary pair right','prospect');
      await assertion(plainLeft,'prospect',false);
      await assertion(plainRight,'prospect',false);
      check('SEPARATION GROUP ordinary pair stars are not transitively different',
        !violatesSeparationGroup([plainLeft,plainRight],await readSeparationGroups(tx)),
        'Only explicit separationGroup metadata establishes all-different semantics.');

      for (const id of [left,right,outsider]) await tx.query(`insert into research.note(entity_id,kind,body,data)
        values($1,'public_profile','Invented common affiliation',$2::jsonb)`,[id,JSON.stringify({org:`Invented shared organization ${tag}`})]);
      const queuedPair = [left,right].sort();
      await tx.query(`insert into identity.possible_match(left_entity,right_entity,confidence,signals)
        values($1,$2,0.25,'{"rule":"name_only"}')`,queuedPair);
      const imported = await mergeImportDuplicatesInTransaction(tx,'invented-import');
      check('SEPARATION GROUP queued non-anchor candidates are retired',
        !(await tx.one<{active:boolean}>('select active from identity.possible_match where left_entity=$1 and right_entity=$2',queuedPair))!.active,
        'Set-based canonical membership overlap retires the edge without expanding all group pairs.');
      check('SEPARATION GROUP imported renamed non-anchors cannot bridge',
        !imported.merges.some(m => new Set<string>([left,right,outsider]).has(m.loserId)),
        'Different current source names cannot conceal a compact constraint held by a canonical alias.');

      // Keep production nested transactions inside this disposable outer rollback.
      const fixtureDb: Db = { ...tx, kind: 'postgres', query: tx.query.bind(tx), one: tx.one.bind(tx),
        exec: tx.exec.bind(tx), transaction: fn => fn(tx), close: async () => {} };
      await resolveIdentities(fixtureDb,[left,right,outsider].map(entityId=>({entityId,organizations:[`Invented shared organization ${tag}`]})));
      const root = async (id: string) => (await tx.one<{id:string}>('select identity.canonical_entity_id($1)::text id',[id]))!.id;
      const l = await root(left), r = await root(right), o = await root(outsider);
      check('SEPARATION GROUP resolver refuses renamed non-anchors through a shared outsider',
        l!==r && (o===l || o===r),
        'Corroboration permits the outsider to merge once; its component cannot bridge two distinct group members.');

      const report: ImportDuplicateReport = {merged:0,merges:[],corrected:[],ambiguous:[{name:'Invented renamed members',entityIds:[l,r],reason:'Invented review'}]};
      await applyIdentityDecisions(tx,'invented-reviewer',report,[{line:1,value:{group:identityReviewGroupId([l,r]),
        decision:'merge',members:[l,r],survivor:l,decided_by:'invented-reviewer',
        evidence:[{source:'https://example.org/invented-separation',as_of:'2026-09-29',quote:'Invented profiles are asserted to identify one person.'}]}}]);
      check('SEPARATION GROUP manual merge refuses two non-anchor members',
        report.merged===0 && report.decisions?.refused.some(x=>x.reason.includes('separation'))===true && await root(left)!==await root(right),
        'Review evidence cannot silently waive a recorded all-different group.');

      await tx.query("delete from identity.source_record where source='w3_person' and source_id=$1",[right]);
      const created = await resolveEntity(tx,{type:'person',name:`Invented renamed members ${tag}`,source:'w3_person',sourceId:right});
      check('SEPARATION GROUP creation honors an absent recorded source binding',
        created.created && created.id!==l && created.id!==r && !created.possible.includes(l) && !created.possible.includes(r),
        'A removed source binding cannot attach or queue a namesake through a different non-anchor.');
      throw rollback;
    });
  } catch (error) { if (error!==rollback) throw error; }
}
