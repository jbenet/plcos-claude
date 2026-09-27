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
  const contacts = await lpContactsFor(ids);
  const version = await revisionFor(db);
  const all = [...new Set([...ids, ...[...contacts.values()].flatMap(cs => cs.map(c => c.entityId))])];
  const rows = await db.query<{
    target_id: string; computed_at: Date; routes: Route[]; current: boolean;
  }>(`select c.target_id, c.computed_at,
       (select coalesce(jsonb_agg(jsonb_build_object(
         'fromEntity', r->'fromEntity', 'fromName', r->'fromName', 'weakestTier', r->'weakestTier',
         'viaContact', r->'viaContact', 'hops', (select coalesce(jsonb_agg(jsonb_build_object(
           'toEntity', h->'toEntity', 'toName', h->'toName')), '[]'::jsonb)
           from jsonb_array_elements(coalesce(r->'hops','[]'::jsonb)) h))), '[]'::jsonb)
        from jsonb_array_elements(coalesce(c.search->'routes','[]'::jsonb)) r) routes,
       c.input_revision = $3::bigint and c.revision = $4 as current
      from network.route_cache c
      where c.target_id = any($1::uuid[]) and c.vehicle_kind = $2`, [all, kind, version.revision, version.generation]);
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
