import type { Db } from '../lib/db';
import { planRoutes } from '../modules/network';
type Check = (name: string, ok: boolean, detail: string) => void;

/** A source becoming eligible can reach targets beyond the scoped two-hop invalidation radius. */
export async function cacheSourceProperties(check: Check, db: Db) {
  const ids: string[] = [];
  try {
    for (const name of ['Prospective fictional source', 'Fictional bridge one', 'Fictional bridge two', 'Fictional isolated recipient']) {
      ids.push((await db.one<{ id: string }>(`insert into identity.entity (entity_type, display_name)
        values ('org', $1) returning entity_id::text as id`, [name]))!.id);
    }
    await db.query(`insert into identity.source_record (source, source_id, entity_id, resolved_by)
      values ('w3_person', 'cache2-future-source', $1, 'fixture')`, [ids[0]]);
    for (let i = 0; i < 3; i++) await db.query(`insert into network.edge
      (from_entity, to_entity, kind, tier, valid_from, evidence) values ($1, $2, 'colleague', 'B', current_date,
      '[{"note":"Fictional documented colleague","tie":{"kind":"worked_together"}}]'::jsonb)`, [ids[i], ids[i + 1]]);
    const before = await planRoutes('', ids[3]!, 3, 'fund', 'team');
    await db.query("update identity.entity set display_name = 'PL' where entity_id = $1", [ids[0]]);
    const after = await planRoutes('', ids[3]!, 3, 'fund', 'team');
    check('CACHE2 a newly eligible PL source refreshes a previously empty three-hop target',
      before?.routes.length === 0 && after?.routes.some((r) => r.fromEntity === ids[0] && r.hops.length === 3) === true,
      'Source membership invalidates globally; ordinary entity changes remain scoped to affected targets.');
    await db.query("update identity.entity set display_name = 'Former fictional source' where entity_id = $1", [ids[0]]);
    const removed = await planRoutes('', ids[3]!, 3, 'fund', 'team');
    check('CACHE2 removing PL source eligibility removes cached approaches', removed?.routes.length === 0,
      'A label/type/source-membership change cannot leave an ineligible starting node in cached routes.');
  } finally {
    await db.query('delete from network.edge where from_entity = any($1::uuid[]) or to_entity = any($1::uuid[])', [ids]);
    await db.query('delete from identity.source_record where entity_id = any($1::uuid[])', [ids]);
    await db.query('delete from identity.possible_match where left_entity= any($1::uuid[]) or right_entity= any($1::uuid[])', [ids]);
    await db.query("delete from research.note where entity_id= any($1::uuid[]) and kind='identity_creation'", [ids]);
    await db.query('delete from identity.entity where entity_id = any($1::uuid[])', [ids]);
  }
}
