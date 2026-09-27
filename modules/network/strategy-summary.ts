import { getDb } from '@/lib/db';
import { revisionFor } from './cache';
import type { EvidenceTier } from './types';

export interface RecordedRoute {
  entityId: string; count: number; at: Date; tier: EvidenceTier | null;
  path: string; basis: string; current: boolean;
}
/** Bounded projection of stored searches, not a new search per LP. A snapshot says
 * what was found at its date, never that an ask is permitted now. The route page
 * reapplies current restrictions, connector load and scoring before any action. */
export async function strategyRouteSummaries(ids: string[], kind: string): Promise<Map<string, RecordedRoute>> {
  if (!ids.length) return new Map();
  const db = await getDb();
  const version = await revisionFor(db);
  const rows = await db.query<{
    target_id: string; computed_at: Date; n: number; tier: EvidenceTier | null;
    route: { fromName?: string; hops?: Array<{ toName: string }> } | null; current: boolean;
  }>(`select c.target_id, c.computed_at, jsonb_array_length(c.search->'routes') as n,
       c.search #>> '{routes,0,weakestTier}' as tier,
       c.search #> '{routes,0}' as route,
       c.input_revision = $3::bigint and c.revision = $4 as current
      from network.route_cache c
      where c.target_id = any($1::uuid[]) and c.vehicle_kind = $2`, [ids, kind, version.revision, version.generation]);
  return new Map(rows.map(r => [r.target_id, {
    entityId: r.target_id, count: Number(r.n), at: new Date(r.computed_at), tier: r.tier,
    path: [r.route?.fromName, ...(r.route?.hops ?? []).map(h => h.toName)].filter(Boolean).join(' → '),
    basis: 'Stored graph search; first recorded candidate. Live route ranking and action guards are checked on the route page.',
    current: r.current,
  }]));
}
