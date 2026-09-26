import type { Check, Db } from './properties/harness';
import { entityForUser, enumeratePaths, edgesByIds } from '../modules/network/repo';
import { planRoutes, planRoutesLive } from '../modules/network/service';

/** Invented source records exercise the reader contract independently of matching rules. */
export async function identityRouteProperties(check: Check, db: Db) {
  const source = (await entityForUser('juan'))!.entityId;
  const ids: string[] = [];
  for (const name of ['IDRES invented target', 'IDRES invented carrier', 'IDRES invented carrier']) {
    ids.push((await db.one<{ id: string }>(`insert into identity.entity (entity_type, display_name)
      values ('person', $1) returning entity_id::text as id`, [name]))!.id);
  }
  const [target, canonical, alias] = ids as [string, string, string];
  const edgeIds: string[] = [];
  for (const [from, to] of [[source, alias], [canonical, target]]) {
    edgeIds.push((await db.one<{ id: string }>(`insert into network.edge
      (from_entity, to_entity, kind, tier, evidence, valid_from)
      values ($1, $2, 'colleague', 'B', $3::jsonb, '2026-01-01') returning edge_id::text as id`,
    [from, to, JSON.stringify([{ note: 'Invented source evidence preserved across identity resolution', tie: { kind: 'worked_together' } }])]))!.id);
  }
  try {
    const before = await planRoutes('juan', target, 3, 'fund', 'team');
    await db.query('update identity.entity set merged_into = $1 where entity_id = $2', [canonical, alias]);
    const paths = await enumeratePaths(source, target);
    const merged = await planRoutes('juan', target, 3, 'fund', 'team');
    const hydrated = await edgesByIds(edgeIds);
    check('IDRES routes join merged source aliases and invalidate an already cached empty search',
      before?.routes.length === 0 && paths.some((p) => p.nodes.join() === [source, canonical, target].join())
      && Boolean(merged?.routes.some((r) => r.connectorIds.includes(canonical)))
      && hydrated.get(edgeIds[0]!)?.toEntity === canonical
      && edgeIds.every((id) => hydrated.get(id)?.evidence[0]?.note === 'Invented source evidence preserved across identity resolution'),
      'Canonical endpoints connect the graph while original edge UUIDs and evidence remain available.');
    await db.query(`insert into coordination.restriction (entity_id, scope, instruction)
      values ($1, 'blanket', 'Invented alias restriction')`, [alias]);
    const restricted = await planRoutes('juan', canonical, 3, 'fund', 'team');
    check('IDRES target restrictions on a merged alias still exclude every route to its canonical identity',
      Boolean(restricted?.routes.length) && restricted!.routes.every((r) => r.verdict === 'excluded'),
      'An alias restriction is enforced on canonical route and cache reads.');
    await db.query('delete from coordination.restriction where entity_id = $1', [alias]);
    await db.query('update identity.entity set merged_into = null where entity_id = $1', [alias]);
    const undone = await planRoutes('juan', target, 3, 'fund', 'team');
    check('IDRES undo restores graph separation and invalidates cached joined routes',
      undone?.routes.length === 0 && (await edgesByIds([edgeIds[0]!])).get(edgeIds[0]!)?.toEntity === alias,
      'Removing the reversible merge pointer restores original topology and edge endpoints.');
    const possible = (await db.one<{ id: string }>(`insert into identity.possible_match
      (left_entity, right_entity, confidence, signals) values ($1, $2, 0.25, '[]') returning edge_id::text as id`,
    [...[alias, canonical].sort()]))!.id;
    const uncertain = await planRoutes('juan', target, 3, 'fund', 'team');
    const live = await planRoutesLive('juan', target, 3, 'fund', 'team');
    check('IDRES name-only identities route through a labelled D-tier bridge without merging',
      Boolean(uncertain?.routes.some((r) => r.weakestTier === 'D' && r.verdict === 'recommend'
        && r.hops.some((h) => h.edge.edgeId === possible && h.edge.kind === 'possible_identity')
        && r.reasons.some((reason) => reason.includes('Possible identity match by name only'))))
      && uncertain?.routes[0]?.score?.value === live?.routes[0]?.score?.value
      && (await db.one<{ merged_into: string | null }>('select merged_into from identity.entity where entity_id = $1', [alias]))?.merged_into === null,
      'A possible identity supplies weak, explicit uncertainty in cached and live routes, without claiming identity or requiring information approval.');
    await db.query('update identity.possible_match set active = false where edge_id = $1', [possible]);
    check('IDRES dismissing a possible match removes its cached route',
      (await planRoutes('juan', target, 3, 'fund', 'team'))?.routes.length === 0,
      'Possible-match changes invalidate the topology and persistent route generations.');
  } finally {
    await db.query('delete from identity.possible_match where left_entity = any($1::uuid[]) or right_entity = any($1::uuid[])', [ids]);
    await db.query('delete from coordination.restriction where entity_id = any($1::uuid[])', [ids]);
    await db.query('delete from network.edge where edge_id = any($1::uuid[])', [edgeIds]);
    await db.query('delete from identity.entity where entity_id = any($1::uuid[])', [ids]);
  }
}
