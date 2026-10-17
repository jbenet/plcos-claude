import { randomUUID } from 'node:crypto';
import { resolvedIdentities } from '../../lib/enrich/identity-roots';
import { mergeImportDuplicatesInTransaction } from '../../lib/enrich/import-dupes';
import type { Principal } from '../../lib/authz';
import type { Finding } from '../../lib/enrich/schema';
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
      // identity.alias_ids (7 Oct 2026): x is among alias_ids(R) exactly when canonical_entity_id(x) is in R, so the
      // hot reads can ask a column's index for `col = any(alias_ids(R))` instead of calling canonical() on every row.
      const asked = [ids[0]!, ids[4]!, ids[6]!, ids[1]!];
      const viaAlias = (await tx.query<{id:string}>(`select x::text id from unnest(identity.alias_ids($1::uuid[])) x`,[asked])).map(r=>r.id).sort();
      const viaCanonical = (await tx.query<{id:string}>(`select x::text id from unnest($2::uuid[]) x
        where identity.canonical_entity_id(x) = any($1::uuid[])`,[asked,ids])).map(r=>r.id).sort();
      const pairs = await tx.query<{c:string;e:string}>(`select canonical_id::text c, entity_id::text e from identity.alias_pairs($1::uuid[])`,[asked]);
      check('IDENTITY alias_ids(R) holds exactly the ids whose canonical id is in R (aliases, a multi-hop alias, a retired root; not a cycle, not a non-root asked for), and alias_pairs names each one\'s root',
        JSON.stringify(viaAlias)===JSON.stringify(viaCanonical) && viaAlias.length===6
        && pairs.every(p=>(p.c===ids[0] && [0,1,2,3].map(i=>ids[i]).includes(p.e)) || (p.c===ids[4] && [4,5].map(i=>ids[i]).includes(p.e))),
        `alias_ids ${viaAlias.length}, canonical ${viaCanonical.length}; pairs ${pairs.length}`);
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
  await pushedFindingMergeProperties(check, db);
}

/**
 * Red team, 17 Oct 2026: a Team member's pushed W1 finding is checked only on its own LP, but its affiliation can corroborate
 * a same-name merge with a record pursued on a vehicle they may not change. That group goes to W13 review; an Admin's
 * import (or the system's) still merges it.
 */
async function pushedFindingMergeProperties(check: Check, db: Db) {
  const juan = (await db.one<{ id: string }>(`select id::text from platform.app_user where handle = 'juan'`))!.id;
  const fund = (await db.one<{ id: string }>(`select id::text from platform.vehicle where kind = 'fund' and phase <> 'historical' order by sort_order limit 1`))!.id;
  const spv = (await db.one<{ id: string }>(`select id::text from platform.vehicle where kind = 'spv' and phase <> 'historical' order by sort_order limit 1`))!.id;
  const tag = randomUUID().slice(0, 8), name = `Invented Pushed Namesake ${tag}`;
  const outcome = async (principal: Principal | null) => db.transaction(async tx => {
    await tx.exec('savepoint invented_pushed_finding');
    try {
      const [theirs, mine, org] = [randomUUID(), randomUUID(), randomUUID()];
      await tx.query(`insert into identity.entity(entity_id,entity_type,display_name) values($1::uuid,'person',$4),($2::uuid,'person',$4),($3::uuid,'org',$5)`,
        [theirs, mine, org, name, `Invented Cedar Org ${tag}`]);
      await tx.query(`insert into identity.source_record(source,source_id,entity_id,resolved_by) values('affinity','person:'||$1::text,$1::uuid,'rule:source-owned'),
        ('prospect_key',$2::text,$2::uuid,'rule:sourced-prospect'),('prospect_org',$3::text,$3::uuid,'rule:sourced-prospect-organization')`, [theirs, mine, org]);
      await tx.query(`insert into identity.affiliation(person_entity,org_entity,kind,role,source,as_of,certainty) values($1,$2,'contact','not recorded','fixture',current_date,'claimed')`, [theirs, org]);
      await tx.query(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status) values($1::uuid,$2::uuid,$4::uuid,'new'),($3::uuid,$5::uuid,$4::uuid,'new')`, [theirs, spv, mine, juan, fund]);
      const finding: Finding = { key: mine, name, researched: { at: '2026-10-17', by: 'fixture', workflow: 'W1', version: '1' },
        identity: { match: 'confirmed', basis: 'Invented affiliation', canonical: { org: `Invented Cedar Org ${tag}` } }, facts: [] };
      const report = await mergeImportDuplicatesInTransaction(tx, 'invented-push', [finding], [], { principal });
      const root = (await tx.one<{ id: string }>('select identity.canonical_entity_id($1)::text id', [mine]))!.id;
      return { merged: root === theirs, review: report.ambiguous.find(g => g.entityIds.includes(mine) && g.entityIds.includes(theirs))?.reason ?? null };
    } finally { await tx.exec('rollback to savepoint invented_pushed_finding; release savepoint invented_pushed_finding'); }
  });
  const team = await outcome({ access: 'team', vehicles: [fund] });
  const both = await outcome({ access: 'team', vehicles: [fund, spv] });
  const admin = await outcome({ access: 'admin', vehicles: null });
  const system = await outcome(null);
  check('IDENTITY a Team member\'s pushed finding that alone links their LP with a namesake pursued on a vehicle they can\'t change sends the group to W13 review; with that vehicle, as an Admin or the system, it merges (red team, 17 Oct 2026)',
    !team.merged && /vehicle the importer cannot change/.test(team.review ?? '') && both.merged && admin.merged && system.merged,
    `team ${JSON.stringify(team)}; both vehicles ${JSON.stringify(both)}; admin ${JSON.stringify(admin)}; system ${JSON.stringify(system)}`);
}
