import { getDb } from '@/lib/db';
import type { Strategy } from '@/lib/enrich/strategy';
import { provisionalScore } from '@/lib/strategy-score';
import type { PursuitStatus } from '@/modules/strategy';

/** Read the latest applicable proposal per pursuit, never the best score across vehicles.
 * No bodies, route enumeration or contact history are needed for this projection. */
export async function vehicleReadings(vehicleId: string | null, entityId: string | null = null) {
  const db = await getDb();
  const rows = await db.query<{
    pursuit_id: string; entity_id: string; entity_name: string; vehicle_id: string;
    vehicle_name: string; vehicle_slug: string; status: PursuitStatus; owner_name: string; next_step: string | null;
    suggestion_id: string | null; made_at: Date | null; made_by: string | null; data: Partial<Strategy> | null;
  }>(`with latest as (
    select distinct on (s.pursuit_id) s.pursuit_id,s.suggestion_id,s.made_at,s.made_by,
      s.data - 'body' as data
    from strategy.suggestion s join strategy.pursuit p using(pursuit_id)
    join platform.vehicle v on v.id=p.vehicle_id
    where ($1::uuid is null or p.vehicle_id=$1) and ($2::uuid is null or identity.canonical_entity_id(p.entity_id)=$2)
      and s.status in ('proposed','accepted')
      and (nullif(trim(s.data#>>'{ask,vehicle}'),'') is null
        or lower(trim(s.data#>>'{ask,vehicle}')) in (lower(v.name),lower(v.slug)))
    order by s.pursuit_id,s.created_at desc,s.suggestion_id
  ) select p.pursuit_id,e.entity_id,e.display_name entity_name,v.id vehicle_id,v.name vehicle_name,v.slug vehicle_slug,
      p.status,u.name owner_name,p.next_step,s.suggestion_id,s.made_at,s.made_by,s.data
    from strategy.pursuit p join identity.entity e on e.entity_id=identity.canonical_entity_id(p.entity_id)
    join platform.vehicle v on v.id=p.vehicle_id join platform.app_user u on u.id=p.owner_id
    left join latest s using(pursuit_id)
    where ($1::uuid is null or p.vehicle_id=$1) and ($2::uuid is null or e.entity_id=$2)
    order by e.display_name,v.sort_order`, [vehicleId, entityId]);
  return rows.map(r => {
    const fit = Object.entries(r.data?.fit ?? {}).find(([key]) =>
      [r.vehicle_name, r.vehicle_slug].some(v => v.toLowerCase() === key.trim().toLowerCase()))?.[1];
    return { ...r, fit, score: provisionalScore(r.data?.scores) };
  });
}
