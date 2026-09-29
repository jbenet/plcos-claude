import { randomUUID } from 'node:crypto';
import { resolvedIdentities } from '../../lib/enrich/identity-roots';
import { mergeImportDuplicatesInTransaction } from '../../lib/enrich/import-dupes';
import type { Check, Db } from './harness';

export async function identityRootProperties(check: Check, db: Db) {
  await db.transaction(async tx => {
    await tx.exec('savepoint invented_identity_roots');
    try {
      const ids: string[] = Array.from({length:8},()=>randomUUID());
      await tx.query(`insert into identity.entity(entity_id,entity_type,display_name)
        select id,'person','Invented root fixture' from unnest($1::uuid[]) id`,[ids]);
      // Branching aliases, a multi-hop alias, a retired root, and a closed cycle.
      for (const [a,b] of [[1,0],[2,1],[3,0],[5,4],[6,7],[7,6]]) {
        await tx.query('update identity.entity set merged_into=$2 where entity_id=$1',[ids[a!],ids[b!]]);
      }
      await tx.query('update identity.entity set retired_at=now() where entity_id=$1',[ids[4]]);
      const actual = (await resolvedIdentities(tx)).filter(e=>ids.includes(e.id)).map(e=>[e.id,e.root]).sort();
      const expected = (await tx.query<{id:string;root:string}>(`select entity_id::text id,canonical_id::text root
        from identity.entity_resolution where entity_id=any($1::uuid[])`,[ids])).map(e=>[e.id,e.root]).sort();
      check('EXPORT bulk roots match canonical view across aliases, retired roots and cycles',
        JSON.stringify(actual)===JSON.stringify(expected) && actual.length===6,
        'Only terminal-root components are exported; cycles are excluded, and retired roots retain their aliases.');
      const endpoints = Array.from({length:4},()=>randomUUID()).sort();
      await tx.query(`insert into identity.entity(entity_id,entity_type,display_name)
        select id,'org','Invented queue fixture '||id::text from unnest($1::uuid[]) id`,[endpoints]);
      await tx.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by)
        select 'fixture-export',id::text,id,'rule:invented' from unnest($1::uuid[]) id`,[endpoints]);
      await tx.query('update identity.entity set merged_into=$2 where entity_id=$1',[endpoints[1],endpoints[0]]);
      await tx.query(`insert into identity.match_assertion
        (kind,left_source,left_source_id,right_source,right_source_id)
        select 'not_same_as','fixture-export',$1,'fixture-export',id from unnest($2::text[]) id`,
      [endpoints[0],endpoints.slice(2)]);
      await tx.query(`insert into identity.possible_match(left_entity,right_entity,confidence,signals)
        select $1,id,0.5,jsonb_build_object('rule',case when id=$3::uuid then 'other-rule' else 'creation-name-only' end)
        from unnest($2::uuid[]) id`,[endpoints[0],endpoints.slice(1),endpoints[3]]);
      await mergeImportDuplicatesInTransaction(tx,'invented-preview',[],[],{reviewOnly:true});
      const preview = await tx.query<{active:boolean}>(`select active from identity.possible_match where left_entity=$1`,[endpoints[0]]);
      check('EXPORT review preview skips queue retirement',preview.length===3 && preview.every(p=>p.active),
        'Queue cleanup cannot affect the report and would be rolled back by the export.');
      await mergeImportDuplicatesInTransaction(tx,'invented-import');
      const remaining = await tx.query<{id:string;active:boolean}>(`select right_entity::text id,active from identity.possible_match where left_entity=$1`,[endpoints[0]]);
      check('EXPORT set-based cleanup retires aliases and creation separations only',remaining.length===3
        && remaining.every(p=>p.active===(p.id===endpoints[3])),
        'Same-root edges retire for any rule; explicit source separations retire creation-name-only edges, retaining unrelated rules.');
    } finally { await tx.exec('rollback to savepoint invented_identity_roots; release savepoint invented_identity_roots'); }
  });
}
