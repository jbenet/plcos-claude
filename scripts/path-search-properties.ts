import { isDeepStrictEqual } from 'node:util';
import { pathsFromSnapshot, type GraphSnapshot } from '../modules/network/path-search';
import type { RawPath } from '../modules/network/repo';
import type { Check } from './properties/harness';

/** Independent exhaustive oracle: sort all supported paths before taking the SQL cap.
 * Fictional multigraphs include parallel edges, self-links, source-only nodes and cycles. */
export async function pathSearchProperties(check: Check) {
  let state = 1729;
  const random = (n: number) => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % n; };
  let comparisons = 0, capped = false, equal = true;
  const order = (a: RawPath, b: RawPath) => a.hops - b.hops || a.edges.join(',').localeCompare(b.edges.join(','));
  for (let fixture = 0; fixture < 16; fixture++) {
    const graph: GraphSnapshot = { adjacency: new Map(), coverage: { edges: 0, from: null, to: null }, tiers: [] };
    for (let edge = 0; edge < 96; edge++) {
      const a = `node-${random(12)}`, b = `node-${random(12)}`, edgeId = String(edge).padStart(6, '0');
      for (const [node, other] of [[a, b], [b, a]]) {
        const links = graph.adjacency.get(node) ?? []; links.push({ edgeId, other }); graph.adjacency.set(node, links);
      }
    }
    for (const maxHops of [1, 2, 3]) {
      const target = `node-${fixture % 12}`, sources = ['node-2', 'node-0', 'node-2', target];
      const sourceOnly = new Set(['node-3', 'node-7']);
      const expected: RawPath[] = [];
      for (const source of new Set(sources)) {
        const candidates: RawPath[] = [];
        for (const first of graph.adjacency.get(source) ?? []) {
          if (first.other === target) candidates.push({ nodes: [source, target], edges: [first.edgeId], hops: 1 });
          if (maxHops < 2 || first.other === source || sourceOnly.has(first.other)) continue;
          for (const second of graph.adjacency.get(first.other) ?? []) {
            if (second.other === target) candidates.push({ nodes: [source, first.other, target], edges: [first.edgeId, second.edgeId], hops: 2 });
            if (maxHops < 3 || first.other === target || second.other === source || second.other === first.other || sourceOnly.has(second.other)) continue;
            for (const third of graph.adjacency.get(second.other) ?? []) {
              if (third.other === target) candidates.push({ nodes: [source, first.other, second.other, target],
                edges: [first.edgeId, second.edgeId, third.edgeId], hops: 3 });
            }
          }
        }
        capped ||= candidates.length > 300;
        expected.push(...candidates.sort(order).slice(0, 300));
      }
      const actual = await pathsFromSnapshot(graph, sources, target, maxHops, sourceOnly);
      equal &&= isDeepStrictEqual(actual, expected); comparisons++;
    }
  }
  check('CACHE2 cooperative graph enumeration preserves exact bounded SQL path semantics', equal && capped,
    `${comparisons} exhaustive comparisons cover one/two/three hops, source order, parallel edges, cycles, PL exclusion and the 300/source cap.`);
}

/** Query spy uses the fictional fixture DB; no persisted benchmark data is needed. */
export async function edgeEvidenceCacheProperties(check: Check, db: import('../lib/db').Db) {
  const { edgesByIds } = await import('../modules/network/repo');
  const fixture = (await db.one<{ edge_id: string; from_entity: string; review_note: string | null; display_name: string }>(
    `select e.edge_id, e.from_entity, e.review_note, n.display_name from network.edge e
      join identity.entity n on n.entity_id = e.from_entity order by e.edge_id limit 1`))!;
  const originalQuery = db.query.bind(db);
  let evidenceReads = 0;
  db.query = (async (sql: string, params?: unknown[]) => {
    if (sql.includes('where e.edge_id = any')) evidenceReads++;
    return originalQuery(sql, params);
  }) as typeof db.query;
  try {
    await db.query('update network.edge set review_note = $2 where edge_id = $1', [fixture.edge_id, 'Fictional cache invalidation check']);
    const first = (await edgesByIds([fixture.edge_id])).get(fixture.edge_id)!;
    const second = (await edgesByIds([fixture.edge_id])).get(fixture.edge_id)!;
    const afterHit = evidenceReads;
    await db.query('update identity.entity set display_name = $2 where entity_id = $1', [fixture.from_entity, 'Fictional renamed source']);
    const renamed = (await edgesByIds([fixture.edge_id])).get(fixture.edge_id)!;
    check('CACHE2 evidence LRU reuses hydrated edges and refreshes labels after network writes',
      first === second && afterHit === 1 && evidenceReads === 2 && renamed.fromName === 'Fictional renamed source',
      `Repeated edge lookup: one hydration and one memory hit; source rename causes one new hydration (${evidenceReads} reads total).`);
  } finally {
    db.query = originalQuery;
    await db.query('update network.edge set review_note = $2 where edge_id = $1', [fixture.edge_id, fixture.review_note]);
    await db.query('update identity.entity set display_name = $2 where entity_id = $1', [fixture.from_entity, fixture.display_name]);
  }
}
