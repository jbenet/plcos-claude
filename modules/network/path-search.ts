import type { Db } from '@/lib/db';
import type { EvidenceTier } from './types';
import type { RawPath } from './repo';

export type Link = { edgeId: string; other: string };
export type GraphSnapshot = {
  adjacency: Map<string, Link[]>;
  canonicalIds?: Map<string, string>;
  coverage: { edges: number; from: Date | null; to: Date | null };
  tiers: Array<{ tier: EvidenceTier; n: number; reviewed: number }>;
};
const snapshots = new WeakMap<Db, { key: string; value: Promise<GraphSnapshot> }>();

/** Let a queued page request take the one local database between every bounded read. */
export const yieldRouteWork = () => new Promise<void>((resolve) => setImmediate(resolve));

/** These are deliberately small reads, not one transaction or an uninterruptible recursive
 * query. The graph remains in Postgres; this disposable topology index contains no evidence.
 * Keyset order also gives every adjacency list the exact UUID order used by SQL path ranking. */
export async function graphSnapshot(db: Db): Promise<GraphSnapshot> {
  const version = await db.one<{ key: string; today: string }>(
    `select revision::text || ':' || current_date::text as key, current_date::text as today
       from network.edge_revision where singleton`);
  const key = version!.key;
  const previous = snapshots.get(db);
  if (previous?.key === key) return previous.value;
  const value = (async (): Promise<GraphSnapshot> => {
    const adjacency = new Map<string, Link[]>();
    const canonicalIds = new Map<string, string>();
    const redirects = new Map<string, string | null>();
    let entityCursor: string | null = null;
    for (;;) {
      const rows: Array<{ entity_id: string; merged_into: string | null }> = await db.query(
        `select entity_id, merged_into from identity.entity
          ${entityCursor ? 'where entity_id > $1::uuid' : ''} order by entity_id limit 2048`, entityCursor ? [entityCursor] : []);
      for (const row of rows) redirects.set(row.entity_id, row.merged_into);
      await yieldRouteWork();
      if (rows.length < 2048) break;
      entityCursor = rows.at(-1)!.entity_id;
    }
    // Resolve chains once with path compression. Paging a recursive view repeatedly
    // would scan and sort the whole source roster for each 512-row slice.
    const invalid = new Set<string>();
    let walked = 0;
    for (const entityId of redirects.keys()) {
      if (canonicalIds.has(entityId) || invalid.has(entityId)) continue;
      const path: string[] = [], seen = new Set<string>();
      let node = entityId, root: string | undefined;
      for (;;) {
        if (canonicalIds.has(node)) { root = canonicalIds.get(node)!; break; }
        if (invalid.has(node) || seen.has(node) || !redirects.has(node)) break;
        seen.add(node); path.push(node);
        const next = redirects.get(node);
        if (next === null) { root = node; break; }
        node = next!;
        if (++walked % 512 === 0) await yieldRouteWork();
      }
      for (const id of path) {
        // A cycle has no canonical root, matching the SQL canonical projection.
        if (root) canonicalIds.set(id, root); else invalid.add(id);
        if (++walked % 512 === 0) await yieldRouteWork();
      }
    }
    const append = (edgeId: string, originalFrom: string, originalTo: string) => {
      const from = canonicalIds.get(originalFrom) ?? originalFrom;
      const to = canonicalIds.get(originalTo) ?? originalTo;
      if (from === to) return;
      for (const [node, other] of [[from, to], [to, from]]) {
        const links = adjacency.get(node), link = { edgeId, other };
        if (links) links.push(link); else adjacency.set(node, [link]);
      }
    };
    const counts = new Map<EvidenceTier, { n: number; reviewed: number }>();
    let cursor: string | null = null, edgeCount = 0, from = Infinity, to = -Infinity;
    for (;;) {
      const rows: Array<{ edge_id: string; from_entity: string; to_entity: string; tier: EvidenceTier;
        reviewed: boolean; valid_from: string; valid_to: string | null }> = await db.query(
        `select edge_id, from_entity, to_entity, tier, reviewed_by is not null as reviewed,
                valid_from::text, valid_to::text from network.edge
          ${cursor ? 'where edge_id > $1::uuid' : ''} order by edge_id limit 2048`, cursor ? [cursor] : []);
      for (const edge of rows) {
        edgeCount++;
        from = Math.min(from, new Date(edge.valid_from).getTime());
        to = Math.max(to, new Date(edge.valid_to ?? version!.today).getTime());
        const count = counts.get(edge.tier) ?? { n: 0, reviewed: 0 };
        count.n++; count.reviewed += Number(edge.reviewed); counts.set(edge.tier, count);
        if (edge.valid_to !== null && edge.valid_to < version!.today) continue;
        append(edge.edge_id, edge.from_entity, edge.to_entity);
      }
      await yieldRouteWork();
      if (rows.length < 2048) break;
      cursor = rows[rows.length - 1].edge_id;
    }
    cursor = null;
    for (;;) {
      const rows: Array<{ edge_id: string; left_entity: string; right_entity: string; created_at: string }> = await db.query(
        `select edge_id, left_entity, right_entity, created_at::text from identity.possible_match
          where active ${cursor ? 'and edge_id > $1::uuid' : ''} order by edge_id limit 2048`, cursor ? [cursor] : []);
      for (const edge of rows) {
        if (canonicalIds.get(edge.left_entity) === canonicalIds.get(edge.right_entity)) continue;
        append(edge.edge_id, edge.left_entity, edge.right_entity);
        edgeCount++;
        from = Math.min(from, new Date(edge.created_at).getTime());
        to = Math.max(to, new Date(version!.today).getTime());
        const count = counts.get('D') ?? { n: 0, reviewed: 0 };
        count.n++; counts.set('D', count);
      }
      await yieldRouteWork();
      if (rows.length < 2048) break;
      cursor = rows.at(-1)!.edge_id;
    }
    // Merge the two ordered edge sources deterministically before applying the path cap.
    for (const links of adjacency.values()) links.sort((a, b) => a.edgeId.localeCompare(b.edgeId));
    const current = await db.one<{ key: string }>(
      `select revision::text || ':' || current_date::text as key from network.edge_revision where singleton`);
    if (current!.key !== key) return graphSnapshot(db);
    return { adjacency, canonicalIds,
      coverage: { edges: edgeCount, from: Number.isFinite(from) ? new Date(from) : null,
        to: Number.isFinite(to) ? new Date(to) : null },
      tiers: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([tier, count]) => ({ tier, ...count })),
    };
  })();
  snapshots.set(db, { key, value });
  try { return await value; }
  catch (error) { if (snapshots.get(db)?.value === value) snapshots.delete(db); throw error; }
}

// Snapshot-owned, so a graph revision/date change also discards this index. Parallel
// edges retain UUID order; grouping never chooses a different representative tie.
const neighborIndexes = new WeakMap<GraphSnapshot, Promise<Map<string, Map<string, Link[]>>>>();
async function neighborsFor(graph: GraphSnapshot) {
  const previous = neighborIndexes.get(graph);
  if (previous) return previous;
  const value = (async () => {
    const index = new Map<string, Map<string, Link[]>>();
    let count = 0;
    for (const [node, links] of graph.adjacency) {
      const neighbors = new Map<string, Link[]>();
      for (const link of links) {
        const group = neighbors.get(link.other);
        if (group) group.push(link); else neighbors.set(link.other, [link]);
        // GUESS: keep index construction cooperative without a timer per edge.
        if (++count % 8192 === 0) await yieldRouteWork();
      }
      index.set(node, neighbors);
    }
    return index;
  })();
  neighborIndexes.set(graph, value);
  return value;
}

/** Enumerate in (source, hops, edge UUIDs) order, stopping at the same 300/source cap.
 * Short paths always precede longer paths. PL and team sources cannot be intermediaries.
 * Time slicing covers high-degree hubs even when they have no supported route. */
export async function pathsFromSnapshot(
  graph: GraphSnapshot, sources: string[], target: string, maxHops: number, sourceOnly: Set<string>,
): Promise<RawPath[]> {
  if (!graph.adjacency.has(target) || !sources.some(source => graph.adjacency.has(source))) return [];
  const paths: RawPath[] = [];
  let iterations = 0, sliceStarted = performance.now();
  const needsYield = () => ++iterations % 1024 === 0 && performance.now() - sliceStarted >= 12;
  const checkpoint = async () => { await yieldRouteWork(); sliceStarted = performance.now(); };
  const tails = new Map<string, Link[]>();
  for (const edge of graph.adjacency.get(target) ?? []) {
    if (!sourceOnly.has(edge.other)) {
      const existing = tails.get(edge.other);
      if (existing) existing.push(edge); else tails.set(edge.other, [edge]);
    }
    if (needsYield()) await checkpoint();
  }
  const neighbors = maxHops >= 3 ? await neighborsFor(graph) : null;
  const middles = new Map<string, Link[]>();
  const wanted = new Set(sources);
  // Sparse target neighborhoods are cheaper to probe backwards. Use the same
  // snapshot index, and fall back to the source walk when a target touches hubs.
  const sourceDegree = [...wanted].reduce((n, source) => n + (graph.adjacency.get(source)?.length ?? 0), 0);
  const tailDegree = [...tails.keys()].reduce((n, node) => n + (neighbors?.get(node)?.size ?? 0), 0);
  let eligible: Set<string> | null = null;
  if (neighbors && tailDegree < sourceDegree) {
    eligible = new Set([target, ...tails.keys()]);
    for (const node of tails.keys()) for (const other of neighbors.get(node)?.keys() ?? []) {
      if (!sourceOnly.has(other)) eligible.add(other);
      if (needsYield()) await checkpoint();
    }
  }
  for (const source of wanted) {
    const start = paths.length;
    let first = graph.adjacency.get(source) ?? [];
    if (eligible && eligible.size < first.length) {
      first = [];
      const byNeighbor = neighbors!.get(source);
      for (const node of eligible) {
        if (node === target || !sourceOnly.has(node)) first.push(...(byNeighbor?.get(node) ?? []));
        if (needsYield()) await checkpoint();
      }
      first.sort((a, b) => a.edgeId.localeCompare(b.edgeId));
    }
    for (const edge of first) {
      if (edge.other === target) paths.push({ nodes: [source, target], edges: [edge.edgeId], hops: 1 });
      if (paths.length - start >= 300) break;
      if (needsYield()) await checkpoint();
    }
    if (tails.size && maxHops >= 2 && paths.length - start < 300) {
      for (const edge of first) {
        if (edge.other !== source && !sourceOnly.has(edge.other)) {
          for (const tail of tails.get(edge.other) ?? []) {
            paths.push({ nodes: [source, edge.other, target], edges: [edge.edgeId, tail.edgeId], hops: 2 });
            if (paths.length - start >= 300) break;
            if (needsYield()) await checkpoint();
          }
        }
        if (paths.length - start >= 300) break;
        if (needsYield()) await checkpoint();
      }
    }
    if (tails.size && maxHops >= 3 && paths.length - start < 300) {
      for (const edge of first) {
        if (edge.other === source || edge.other === target || sourceOnly.has(edge.other)) continue;
        let middleLinks = middles.get(edge.other);
        if (!middleLinks) {
          middleLinks = [];
          const byNeighbor = neighbors!.get(edge.other);
          // Intersect unique neighbors with target tails, never expand a hub's
          // entire two-hop neighborhood. No arbitrary degree cutoff loses routes.
          if (byNeighbor) {
            const candidates = byNeighbor.size < tails.size ? byNeighbor.keys() : tails.keys();
            for (const node of candidates) {
              if (tails.has(node)) for (const link of byNeighbor.get(node) ?? []) {
                middleLinks.push(link);
                if (needsYield()) await checkpoint();
              }
              if (needsYield()) await checkpoint();
            }
          }
          middleLinks.sort((a, b) => a.edgeId.localeCompare(b.edgeId));
          middles.set(edge.other, middleLinks);
        }
        for (const middle of middleLinks) {
          if (middle.other !== source && middle.other !== edge.other) {
            for (const tail of tails.get(middle.other) ?? []) {
              paths.push({ nodes: [source, edge.other, middle.other, target],
                edges: [edge.edgeId, middle.edgeId, tail.edgeId], hops: 3 });
              if (paths.length - start >= 300) break;
              if (needsYield()) await checkpoint();
            }
          }
          if (paths.length - start >= 300) break;
          if (needsYield()) await checkpoint();
        }
        if (paths.length - start >= 300) break;
        if (needsYield()) await checkpoint();
      }
    }
  }
  return paths;
}
