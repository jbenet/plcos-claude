import { randomUUID } from 'node:crypto';
import { identityGraphContext, identityRawContext } from '../../lib/enrich/identity-context';
import type { Check, Db } from './harness';

/** Bag equivalence matters: one raw version may match two lookup arms. */
export async function identityContextProperties(check: Check, db: Db) {
  const rollback = new Error('rollback invented identity context');
  try {
    await db.transaction(async tx => {
      const person = randomUUID(), org = randomUUID(), alias = randomUUID(), tag = randomUUID();
      for (const [id, type] of [[person, 'person'], [org, 'org'], [alias, 'org']]) {
        await tx.query('insert into identity.entity(entity_id,entity_type,display_name) values($1,$2,$3)', [id, type, `Invented context ${id}`]);
      }
      await tx.query('update identity.entity set merged_into=$2 where entity_id=$1', [alias, org]);
      const keys = [`person:${tag}`, `list_entry:${tag}`, tag];
      for (const source of ['affinity', 'invented']) for (const key of keys) {
        await tx.query("insert into identity.source_record(source,source_id,entity_id,resolved_by) values($1,$2,$3,'fixture')", [source, key, person]);
      }
      for (const source of ['affinity', 'invented']) for (const kind of ['person', 'list_entry']) {
        for (const key of keys) for (const version of [1, 2]) {
          // list_entry:tag matches both its typed ID and its list subject.
          await tx.query('insert into sources.raw_record(source,kind,source_id,payload_hash,payload) values($1,$2,$3,$4,$5::jsonb)',
            [source, kind, key, `${tag}-${version}`, JSON.stringify({ type: kind, entity: { id: tag }, title: `${source} ${kind} ${key} v${version}` })]);
        }
      }
      const legacyRaw = await tx.query(`select s.entity_id::text id,r.payload
        from identity.source_record s join sources.raw_record r on r.source=s.source and
        (r.source_id=s.source_id or (s.source='affinity' and (r.kind||':'||r.source_id=s.source_id or
        (r.kind='list_entry' and (r.payload->>'type')||':'||(r.payload->'entity'->>'id')=s.source_id))))
        where s.entity_id=any($1::uuid[])`, [[person]]);
      const bag = (rows: unknown[]) => JSON.stringify(rows.map(r => JSON.stringify(r)).sort());
      check('IDENTITY CONTEXT indexed raw lookups preserve the legacy multiset',
        bag(legacyRaw) === bag(await identityRawContext(tx, [person])),
        'Direct IDs, typed IDs, list subjects, overlapping matches, versions and non-Affinity sources retain exactly the same rows.');
      for (const [from, to, kind, evidence] of [
        [person, alias, 'employment', []], [alias, person, 'colleague', [{ note: 'Works at invented firm' }]],
        [person, org, 'colleague', [{ note: 'unrelated' }]], [org, org, 'employment', []],
      ]) await tx.query("insert into network.edge(from_entity,to_entity,kind,tier,evidence,valid_from) values($1,$2,$3,'C',$4::jsonb,'2026-09-27')", [from, to, kind, JSON.stringify(evidence)]);
      const ids = [person, org];
      const legacyGraph = await tx.query(`select distinct p.id::text id,o.display_name org
        from unnest($1::uuid[]) p(id) join network.edge e on e.from_entity=p.id or e.to_entity=p.id
        join identity.entity o on o.entity_id=identity.canonical_entity_id(case when e.from_entity=p.id then e.to_entity else e.from_entity end)
        where o.entity_type='org' and (e.kind::text in ('same_firm','employment') or exists(
          select 1 from jsonb_array_elements(e.evidence) v where v->>'note' ~* 'affiliation|employment|employed by|works at'))`, [ids]);
      check('IDENTITY CONTEXT incident-edge lookups preserve legacy affiliations',
        bag(legacyGraph) === bag(await identityGraphContext(tx, ids)),
        'Both directions, aliases, evidence text, unrelated edges and self-edges preserve the same distinct affiliations.');
      throw rollback;
    });
  } catch (error) { if (error !== rollback) throw error; }
}
