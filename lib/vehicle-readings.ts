import { getDb } from '@/lib/db';
import { buildCache } from '@/lib/build-cache';
import type { Strategy } from '@/lib/enrich/strategy';
import { provisionalScore } from '@/lib/strategy-score';
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
    suggestion_id: string | null; made_at: Date | null; made_by: string | null; data: Partial<Strategy> | null;
  }>(`with ps as materialized (
    select p.pursuit_id, p.vehicle_id, p.status, p.owner_id, p.next_step, identity.canonical_entity_id(p.entity_id) entity_id
    from strategy.active_pursuit p where ($1::uuid is null or p.vehicle_id=$1)
  ), mine as materialized (
    select * from ps where ($2::uuid is null or ps.entity_id=$2)
  ), cand as materialized (
    -- The ask's vehicle is a stored column (strategy 012), read only for the pursuits asked about: testing the jsonb against
    -- every vehicle row read the whole jsonb eight times over (one LP page, 15 Oct 2026: 440 ms → 20 ms).
    select s.pursuit_id, s.suggestion_id, s.created_at, s.ask_vehicle askv, m.vehicle_id
    from strategy.suggestion s join mine m using(pursuit_id)
    where s.status in ('proposed','accepted')
  ), latest as (
    select distinct on (c.pursuit_id) c.pursuit_id, c.suggestion_id
    from cand c join platform.vehicle v on v.id=c.vehicle_id
    where c.askv is null or c.askv in (lower(v.name),lower(v.slug))
    order by c.pursuit_id,c.created_at desc,c.suggestion_id
  ) select p.pursuit_id,e.entity_id,e.display_name entity_name,v.id vehicle_id,v.name vehicle_name,v.slug vehicle_slug,
      p.status,u.name owner_name,p.next_step,s.suggestion_id,s.made_at,s.made_by,s.data - 'body' as data
    from mine p join identity.entity e on e.entity_id=p.entity_id
    join platform.vehicle v on v.id=p.vehicle_id join platform.app_user u on u.id=p.owner_id
    left join latest l using(pursuit_id) left join strategy.suggestion s on s.suggestion_id=l.suggestion_id
    order by e.display_name,v.sort_order`, [vehicleId, entityId]);
  return rows.map(r => {
    const fit = Object.entries(r.data?.fit ?? {}).find(([key]) =>
      [r.vehicle_name, r.vehicle_slug].some(v => v.toLowerCase() === key.trim().toLowerCase()))?.[1];
    return { ...r, fit, score: provisionalScore(r.data?.scores) };
  });
}
