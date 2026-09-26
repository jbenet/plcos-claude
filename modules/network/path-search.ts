import type { Db } from '@/lib/db';
import type { EvidenceTier } from './types';
import type { RawPath } from './repo';

export type Link = { edgeId: string; other: string };
export type GraphSnapshot = {
  adjacency: Map<string, Link[]>;
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
    const counts = new Map<EvidenceTier, { n: number; reviewed: number }>();
    let cursor: string | null = null, edgeCount = 0, from = Infinity, to = -Infinity;
    for (;;) {
      const rows: Array<{ edge_id: string; from_entity: string; to_entity: string; tier: EvidenceTier;
        reviewed: boolean; valid_from: string; valid_to: string | null }> = await db.query(
        `select edge_id, from_entity, to_entity, tier, reviewed_by is not null as reviewed,
                valid_from::text, valid_to::text from network.edge
          ${cursor ? 'where edge_id > $1::uuid' : ''} order by edge_id limit 512`, cursor ? [cursor] : []);
      for (const edge of rows) {
        edgeCount++;
        from = Math.min(from, new Date(edge.valid_from).getTime());
        to = Math.max(to, new Date(edge.valid_to ?? version!.today).getTime());
        const count = counts.get(edge.tier) ?? { n: 0, reviewed: 0 };
        count.n++; count.reviewed += Number(edge.reviewed); counts.set(edge.tier, count);
        if (edge.valid_to !== null && edge.valid_to < version!.today) continue;
        for (const [node, other] of [[edge.from_entity, edge.to_entity], [edge.to_entity, edge.from_entity]]) {
          const links = adjacency.get(node);
          const link = { edgeId: edge.edge_id, other };
          if (links) links.push(link); else adjacency.set(node, [link]);
        }
      }
      await yieldRouteWork();
      if (rows.length < 512) break;
      cursor = rows[rows.length - 1].edge_id;
    }
    const current = await db.one<{ key: string }>(
      `select revision::text || ':' || current_date::text as key from network.edge_revision where singleton`);
    if (current!.key !== key) return graphSnapshot(db);
    return { adjacency,
      coverage: { edges: edgeCount, from: Number.isFinite(from) ? new Date(from) : null,
        to: Number.isFinite(to) ? new Date(to) : null },
      tiers: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([tier, count]) => ({ tier, ...count })),
    };
  })();
  snapshots.set(db, { key, value });
  try { return await value; }
  catch (error) { if (snapshots.get(db)?.value === value) snapshots.delete(db); throw error; }
}

/** Enumerate in (source, hops, edge UUIDs) order, stopping at the same 300/source cap.
 * Short paths always precede longer paths. PL and team sources cannot be intermediaries.
 * Time slicing covers high-degree hubs even when they have no supported route. */
export async function pathsFromSnapshot(
  graph: GraphSnapshot, sources: string[], target: string, maxHops: number, sourceOnly: Set<string>,
): Promise<RawPath[]> {
  if (!graph.adjacency.has(target)) return [];
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
  for (const source of new Set(sources)) {
    const start = paths.length;
    const first = graph.adjacency.get(source) ?? [];
    for (const edge of first) {
      if (edge.other === target) paths.push({ nodes: [source, target], edges: [edge.edgeId], hops: 1 });
      if (paths.length - start >= 300) break;
      if (needsYield()) await checkpoint();
    }
    if (tails.size && maxHops >= 2 && paths.length - start < 300) {
      for (const edge of first) {
        if (edge.other !== source) {
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
        for (const middle of graph.adjacency.get(edge.other) ?? []) {
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
