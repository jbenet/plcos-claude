import { getDb } from '@/lib/db';
import { buildCache } from '@/lib/build-cache';
import type { Strategy } from '@/lib/enrich/strategy';
import { provisionalScore } from '@/lib/strategy-score';
import { byVersion, VERSION } from '@/modules/strategy/by-version';
import type { PursuitStatus } from '@/modules/strategy';

/** Read the latest applicable proposal per pursuit, never the best score across vehicles.
 * No bodies, route enumeration or contact history are needed for this projection. */
export async function vehicleReadings(vehicleId: string | null, entityId: string | null = null) {
  return [...await (entityId ? oneLpAt : readingsAt)(vehicleId ?? '', entityId ?? '')];
}

/** Kept per read revision: suggestions, pursuits, entities, vehicles and users all move it. The fit table and LP
 * stats read all 6,000 again on every visit (15 Oct 2026: about 85 ms each). Rows are shared: never change one. */
const readingsAt = buildCache((vehicle: string, entity: string) => loadReadings(vehicle || null, entity || null));
/** One LP's readings (its fit and meeting pages), kept apart: a few LP visits must not push the whole lists out. */
const oneLpAt = buildCache((vehicle: string, entity: string) => loadReadings(vehicle || null, entity || null), 64);

async function loadReadings(vehicleId: string | null, entityId: string | null) {
  const db = await getDb();
  const rows = await db.query<{
    pursuit_id: string; entity_id: string; entity_name: string; vehicle_id: string;
    vehicle_name: string; vehicle_slug: string; status: PursuitStatus; owner_name: string; next_step: string | null;
    suggestion_id: string | null; made_at: Date | null; made_by: string | null; v: string | null;
  }>(`with ps as materialized (
    select p.pursuit_id, p.vehicle_id, p.status, p.owner_id, p.next_step, identity.canonical_entity_id(p.entity_id) entity_id
    from strategy.active_pursuit p where ($1::uuid is null or p.vehicle_id=$1)
  ), mine as materialized (
    select * from ps where ($2::uuid is null or ps.entity_id=$2)
  ) select p.pursuit_id,e.entity_id,e.display_name entity_name,v.id vehicle_id,v.name vehicle_name,v.slug vehicle_slug,
      p.status,u.name owner_name,p.next_step,s.suggestion_id,s.made_at,s.made_by,${VERSION('s')} v
    from mine p join identity.entity e on e.entity_id=p.entity_id
    join platform.vehicle v on v.id=p.vehicle_id join platform.app_user u on u.id=p.owner_id
    -- Each pursuit's latest applicable proposal, by its index (pursuit_id, created_at): joined to a distinct-on of all
    -- of them, the planner guessed one row and rescanned it per pursuit, 40 of a vehicle's 47 ms (perf pass, 17 Oct
    -- 2026; now 13 ms). The ask's vehicle is a stored column (strategy 012), not the jsonb (15 Oct 2026: 440 ms → 20 ms).
    left join lateral (
      select c.suggestion_id from strategy.suggestion c
       where c.pursuit_id=p.pursuit_id and c.status in ('proposed','accepted')
         and (c.ask_vehicle is null or c.ask_vehicle in (lower(v.name),lower(v.slug)))
       order by c.created_at desc,c.suggestion_id limit 1
    ) l on true left join strategy.suggestion s on s.suggestion_id=l.suggestion_id
    order by e.display_name,v.sort_order`, [vehicleId, entityId]);
  // Each proposal's data only when it is new or changed since (by-version.ts): every vehicle's readings read all of it
  // again after each write, 137 ms of the conversion page's rebuild (17 Oct 2026).
  const keys = rows.flatMap((r) => (r.suggestion_id && r.v ? [{ id: r.suggestion_id, v: r.v }] : []));
  const datas = await byVersion<Partial<Strategy>>(db, 'suggestion-data', keys, async (ids) =>
    (await db.query<{ id: string; v: string; data: Partial<Strategy> }>(
      `select s.suggestion_id::text id, ${VERSION('s')} v, s.data - 'body' as data from strategy.suggestion s where s.suggestion_id = any($1::uuid[])`, [ids]))
      .map((r) => ({ id: r.id, v: r.v, value: r.data })));
  return rows.map(({ v: _v, ...row }) => {
    const r = { ...row, data: row.suggestion_id ? datas.get(row.suggestion_id) ?? null : null };
    const fit = Object.entries(r.data?.fit ?? {}).find(([key]) =>
      [r.vehicle_name, r.vehicle_slug].some(v => v.toLowerCase() === key.trim().toLowerCase()))?.[1];
    return { ...r, fit, score: provisionalScore(r.data?.scores) };
  });
}
