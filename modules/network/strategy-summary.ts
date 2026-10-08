import { getDb } from '@/lib/db';
import { lpContactsFor } from '@/modules/strategy/lp-contacts';
import { revisionFor } from './cache';
import type { EvidenceTier, Route } from './types';

export interface RecordedRoute {
  entityId: string; count: number; at: Date; tier: EvidenceTier | null;
  path: string; basis: string; current: boolean;
}
/** Stored evidence only. Contact endpoints represent their LP without adding a tie or
 * upgrading a tier. Repeated searches/evidence for the same entity chain count once. */
export async function strategyRouteSummaries(ids: string[], kind: string): Promise<Map<string, RecordedRoute>> {
  if (!ids.length) return new Map();
  const db = await getDb();
  // The stored searches are read beside the revision (whose contact signature is the slow part after
  // a write), and whether each is current is decided here (performance pass, 8 Oct 2026).
  const versioned = revisionFor(db);
  versioned.catch(() => undefined); // awaited below
  const contacts = await lpContactsFor(ids);
  const all = [...new Set([...ids, ...[...contacts.values()].flatMap(cs => cs.map(c => c.entityId))])];
  // Only the fields shown, built per route as a flat array (hop ids and names side by side; both are
  // required on every hop): a nested jsonb_build_object per hop cost ~3x more on a 3,000-LP vehicle.
  type Flat = [string, string, Route['weakestTier'], Route['viaContact'] | null, string[], string[]];
  const [flat, version] = await Promise.all([db.query<{ target_id: string; computed_at: Date; routes: Flat[] | null; input_revision: string; revision: string }>(`select c.target_id, c.computed_at,
       (select jsonb_agg(jsonb_build_array(r->'fromEntity', r->'fromName', r->'weakestTier', r->'viaContact',
          jsonb_path_query_array(r, '$.hops[*].toEntity'), jsonb_path_query_array(r, '$.hops[*].toName')))
        from jsonb_array_elements(coalesce(c.search->'routes','[]'::jsonb)) r) routes,
       c.input_revision::text, c.revision
      from network.route_cache c
      where c.target_id = any($1::uuid[]) and c.vehicle_kind = $2`, [all, kind]), versioned]);
  const rows = flat.map(r => ({ ...r, current: r.input_revision === version.revision && r.revision === version.generation, routes: (r.routes ?? []).map(([fromEntity, fromName, weakestTier, viaContact, ids, names]) =>
    ({ fromEntity, fromName, weakestTier, viaContact, hops: ids.map((toEntity, i) => ({ toEntity, toName: names[i]! })) }) as unknown as Route) }));
  const byTarget = new Map(rows.map(r => [r.target_id, r]));
  const result = new Map<string, RecordedRoute>();
  for (const id of ids) {
    const endpointContacts = new Map((contacts.get(id) ?? []).map(c => [c.entityId, c]));
    const chains = new Map<string, { route: Route; at: Date; current: boolean }>();
    const own = byTarget.get(id);
    if (!endpointContacts.size) {
      // Individuals keep the original stored ranking and count. A removed firm contact
      // cannot survive solely through an old projected organisation snapshot.
      const routes = (own?.routes ?? []).filter(r => !r.viaContact);
      const route = routes[0];
      if (own) result.set(id, { entityId: id, count: routes.length, at: new Date(own.computed_at), tier: route?.weakestTier ?? null,
        path: [route?.fromName, ...(route?.hops ?? []).map(h => h.toName)].filter(Boolean).join(' → '),
        basis: 'Stored graph search; first recorded candidate. Live route ranking and action guards are checked on the route page.', current: own.current });
      continue;
    }
    for (const endpoint of [id, ...endpointContacts.keys()]) {
      const row = byTarget.get(endpoint);
      for (const original of row?.routes ?? []) {
        if (original.viaContact && !endpointContacts.has(original.viaContact.entityId)) continue;
        const contact = endpointContacts.get(endpoint);
        const route = contact ? { ...original, viaContact: contact } : original;
        const key = [route.fromEntity, ...route.hops.map(h => h.toEntity)].join('|');
        const prior = chains.get(key);
        if (!prior || route.weakestTier < prior.route.weakestTier) chains.set(key, { route, at: new Date(row!.computed_at), current: row!.current });
      }
    }
    const best = [...chains.values()].sort((a, b) => a.route.weakestTier.localeCompare(b.route.weakestTier))[0];
    if (!best && !own) continue;
    const route = best?.route;
    result.set(id, { entityId: id, count: chains.size, at: best?.at ?? new Date(own!.computed_at), tier: route?.weakestTier ?? null,
      path: route ? [route.fromName, ...route.hops.map(h => h.toName)].filter(Boolean).join(' → ') + (route.viaContact ? ` · via ${route.viaContact.role}` : '') : '',
      basis: 'Stored graph searches, including the LP unit’s contacts. Live route ranking and action guards are checked on the route page.',
      current: best?.current ?? own!.current });
  }
  return result;
}
