import { getDb, type Db } from '@/lib/db';
import { graphSnapshot, pathsFromSnapshot, yieldRouteWork } from './path-search';
import type { Edge, EdgeKind, EvidenceTier } from './types';

type EdgeRow = {
  edge_id: string; from_entity: string; to_entity: string; from_name: string; to_name: string;
  kind: EdgeKind; tier: EvidenceTier; strength: string | null; tie_band: string | null;
  evidence: Edge['evidence']; reviewed_by_name: string | null;
  reviewed_at: Date | string | null; review_note: string | null;
  valid_from: Date | string; valid_to: Date | string | null;
};

const EDGE_SELECT = `
  select e.edge_id, e.from_entity, e.to_entity, f.display_name as from_name,
         t.display_name as to_name, e.kind, e.tier, e.strength, e.tie_band, e.evidence,
         u.name as reviewed_by_name, e.reviewed_at, e.review_note, e.valid_from, e.valid_to
    from network.edge e
    join identity.entity f on f.entity_id = e.from_entity
    join identity.entity t on t.entity_id = e.to_entity
    left join platform.app_user u on u.id = e.reviewed_by`;

const toEdge = (r: EdgeRow): Edge => ({
  edgeId: r.edge_id, fromEntity: r.from_entity, toEntity: r.to_entity,
  fromName: r.from_name, toName: r.to_name, kind: r.kind, tier: r.tier,
  strength: r.strength === null ? null : Number(r.strength), tieBand: r.tie_band,
  evidence: r.evidence ?? [], reviewedByName: r.reviewed_by_name,
  reviewedAt: r.reviewed_at ? new Date(r.reviewed_at) : null, reviewNote: r.review_note,
  validFrom: new Date(r.valid_from), validTo: r.valid_to ? new Date(r.valid_to) : null,
});

export async function listEdges(): Promise<Edge[]> {
  const db = await getDb();
  return (await db.query<EdgeRow>(`${EDGE_SELECT} order by e.tier, f.display_name`)).map(toEdge);
}

type EvidenceEntry = { edge: Edge; bytes: number };
type EvidenceCache = { revision: string; entries: Map<string, EvidenceEntry>; bytes: number };
const evidenceCaches = new WeakMap<Db, EvidenceCache>();
const evidenceRevision = async (db: Db) => (await db.one<{ revision: string }>(
  'select revision::text from network.route_revision where singleton'))!.revision;

/** Shared team edges recur across many targets. Retain a bounded, disposable evidence
 * LRU; topology, entity-label and reviewer changes all advance this revision. */
export async function edgesByIds(ids: string[]): Promise<Map<string, Edge>> {
  if (ids.length === 0) return new Map();
  const db = await getDb(), revision = await evidenceRevision(db);
  let cache = evidenceCaches.get(db);
  if (!cache || cache.revision !== revision) {
    cache = { revision, entries: new Map(), bytes: 0 }; evidenceCaches.set(db, cache);
  }
  const result = new Map<string, Edge>(), missing: string[] = [];
  for (const id of new Set(ids)) {
    const entry = cache.entries.get(id);
    if (entry) {
      cache.entries.delete(id); cache.entries.set(id, entry); result.set(id, entry.edge);
    } else missing.push(id);
  }
  for (let offset = 0; offset < missing.length; offset += 64) {
    const rows = await db.query<EdgeRow>(`${EDGE_SELECT} where e.edge_id = any($1::uuid[])`, [missing.slice(offset, offset + 64)]);
    for (const row of rows) {
      const edge = toEdge(row), bytes = JSON.stringify(edge).length * 2;
      result.set(row.edge_id, edge);
      const previous = cache.entries.get(row.edge_id);
      if (previous) { cache.bytes -= previous.bytes; cache.entries.delete(row.edge_id); }
      cache.entries.set(row.edge_id, { edge, bytes }); cache.bytes += bytes;
      while (cache.entries.size > 8192 || cache.bytes > 16 * 1024 * 1024) {
        const first = cache.entries.keys().next().value!;
        cache.bytes -= cache.entries.get(first)!.bytes; cache.entries.delete(first);
      }
    }
    await yieldRouteWork();
  }
  // Do not return a mixture of generations if a network write ran during a yield.
  if (missing.length && await evidenceRevision(db) !== revision) return edgesByIds(ids);
  return result;
}

export interface RawPath {
  nodes: string[];
  edges: string[];
  hops: number;
}

/**
 * Enumerate up to 300 currently-valid paths from `fromEntity` to `targetEntity`, up to `maxHops`.
 *
 * Deliberately enumerates unusable paths too. A planner that silently drops the
 * proximity-only path returns an empty list, and an empty list reads as "no route exists"
 * while only justifying "no route in the material available". The caller labels them.
 */
export async function enumeratePaths(
  fromEntity: string, targetEntity: string, maxHops = 3,
): Promise<RawPath[]> {
  return enumeratePathsFromSources([fromEntity], targetEntity, maxHops);
}

/** Same 300 candidates per source, with bounded database reads and cooperative CPU slices. */
export async function enumeratePathsFromSources(
  fromEntities: string[], targetEntity: string, maxHops = 3, sourceOnlyEntities: string[] = [],
): Promise<RawPath[]> {
  if (!fromEntities.length) return [];
  const db = await getDb();
  const excluded = await db.query<{ entity_id: string }>(
    `select distinct e.entity_id from identity.entity e join identity.source_record s on s.entity_id = e.entity_id
      where s.source = 'w3_person' and e.entity_type = 'org' and e.display_name = 'PL'`);
  const graph = await graphSnapshot(db);
  return pathsFromSnapshot(graph, fromEntities, targetEntity, maxHops,
    new Set([...sourceOnlyEntities, ...excluded.map((row) => row.entity_id)]));
}

async function edgeSummary() { return graphSnapshot(await getDb()); }

export async function edgeCoverage() {
  return (await edgeSummary()).coverage;
}

export async function tierCounts(): Promise<Array<{ tier: EvidenceTier; n: number; reviewed: number }>> {
  return (await edgeSummary()).tiers;
}

/** The entity that represents a member of the team. Linked through identity.source_record. */
export async function entityForUser(handle: string): Promise<{ entityId: string; name: string } | null> {
  const db = await getDb();
  const row = await db.one<{ entity_id: string; display_name: string }>(
    `select e.entity_id, e.display_name
       from identity.source_record s join identity.entity e on e.entity_id = s.entity_id
      where s.source = 'app_user' and s.source_id = $1`,
    [handle],
  );
  return row ? { entityId: row.entity_id, name: row.display_name } : null;
}

/** People on the active team plus the explicit PL organization source. */
export async function routeSources(): Promise<Array<{ entityId: string; name: string }>> {
  const db = await getDb();
  const rows = await db.query<{ id: string; name: string }>(
    `select distinct e.entity_id::text as id, e.display_name as name
       from identity.entity e join identity.source_record s on s.entity_id = e.entity_id
       left join platform.app_user u on s.source = 'app_user' and s.source_id = u.handle
      where (s.source = 'app_user' and u.active)
         or (s.source = 'w3_person' and e.entity_type = 'org' and e.display_name = 'PL')
      order by name`);
  return rows.map((r) => ({ entityId: r.id, name: r.name }));
}


/** Role evidence on the source/connector pair, including edges that did not fit a candidate path. */
export async function sourceEdges(sourceIds: string[], entityIds: string[]): Promise<Edge[]> {
  if (!sourceIds.length || !entityIds.length) return [];
  const db = await getDb();
  const graph = await graphSnapshot(db);
  const wanted = new Set(entityIds), ids = new Set<string>();
  for (const source of sourceIds) {
    for (const edge of graph.adjacency.get(source) ?? []) {
      if (wanted.has(edge.other)) ids.add(edge.edgeId);
    }
    await yieldRouteWork();
  }
  return [...(await edgesByIds([...ids])).values()];
}

/** A changed endpoint can affect a three-hop route only within two hops of its target.
 * Called only for pending topology changes: ordinary persistent-cache hits need no graph load. */
export async function routeTouchesChanges(targetId: string, changedIds: string[]): Promise<boolean> {
  const changed = new Set(changedIds);
  if (changed.has(targetId)) return true;
  if (!changed.size) return false;
  const graph = await graphSnapshot(await getDb());
  let checked = 0, slice = performance.now();
  const first = graph.adjacency.get(targetId) ?? [];
  for (const edge of first) {
    if (changed.has(edge.other)) return true;
    for (const next of graph.adjacency.get(edge.other) ?? []) {
      if (changed.has(next.other)) return true;
      if (++checked % 1024 === 0 && performance.now() - slice >= 12) {
        await yieldRouteWork(); slice = performance.now();
      }
    }
  }
  return false;
}
