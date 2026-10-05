import { can, type Principal } from '@/lib/authz';
import { getDb, type Db } from '@/lib/db';
import type { RouteSearch } from '@/modules/network';

/** No arbitrary edge fields, source notes, consultant titles or score explanations cross this DTO. */
export function projectRoutes(user: Principal, vehicle: string, search: RouteSearch | null) {
  if (!search || !can(user, 'read', { vehicle })) return null;
  return {
    target: search.targetName, from: search.fromName,
    // Ids are not licensed values: each hop and the introducer (the last person before the target, who carries the
    // ask) name their entity, so a client can address an intro ask or look further through a hop (docs/27 §4a).
    routes: search.routes.map(r => {
      // A legacy or compact route may lack connector lists; then there is no introducer to name.
      const ids = r.connectorIds ?? [], carrier = ids.length - 1;
      return { from: r.fromName ?? search.fromName, fromEntityId: r.fromEntity ?? null, verdict: r.verdict,
        hops: r.hops.map(h => ({ entityId: h.toEntity, name: h.toName, tier: h.edge.tier })),
        introducer: carrier >= 0 ? { entityId: ids[carrier]!, name: r.connectorNames?.[carrier] ?? 'Unknown' } : null,
      };
    }),
    restrictionCount: search.restrictions.length,
    restrictionReasons: can(user, 'read', { vehicle, fieldClass: 'R4' }) ? search.restrictions.map(r => r.instruction) : [],
    coverage: { edges: search.coverage.edges, maxHops: search.coverage.maxHops,
      from: search.coverage.from?.toISOString() ?? null, to: search.coverage.to?.toISOString() ?? null },
  };
}
export async function scopedStrategyData(user: Principal, query?: Db) {
  const db = query ?? await getDb();
  const allowed = user.access === 'admin' || user.vehicles === null ? null : [...user.vehicles];
  const rows = await db.query<{ id: string; pursuit: string; entity: string; name: string; vehicleId: string; vehicle: string; author: string; at: string; status: string }>(`select s.suggestion_id::text id,p.pursuit_id::text pursuit,
    identity.canonical_entity_id(p.entity_id)::text entity,e.display_name name,p.vehicle_id::text "vehicleId",v.name vehicle,
    s.made_by author,s.made_at::text at,s.status
    from strategy.suggestion s join strategy.active_pursuit p using(pursuit_id)
    join identity.entity e on e.entity_id=identity.canonical_entity_id(p.entity_id) join platform.vehicle v on v.id=p.vehicle_id
    where ($1::uuid[] is null or p.vehicle_id=any($1::uuid[])) order by s.made_at desc`, [allowed]);
  const readable = rows.filter(r => can(user,'read',{vehicle:r.vehicleId,fieldClass:'R2'})).map(r => r.id);
  const words = readable.length ? await db.query<{ id: string; body: string }>(`select suggestion_id::text id,body from strategy.suggestion
    where suggestion_id=any($1::uuid[]) and data->>'source' is distinct from 'dakota'`,[readable]) : [];
  return rows.map(r => ({ ...r, body: words.find(w => w.id === r.id)?.body ?? null }));
}
