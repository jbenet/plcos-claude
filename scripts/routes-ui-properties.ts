/** UI-only invariants, fictional records. Run with node --import tsx scripts/routes-ui-properties.ts. */
import assert from 'node:assert/strict';
import type { Route, RouteSearch } from '../modules/network/client';
import { routeComparison, routeGraphLayout, routeNodeIds, routeReading, routeSummaryFor } from '../components/routes/route-display';

function route(ids: string[], foldedUnder: number | null = null): Route {
  return { fromEntity: ids[0], fromName: ids[0], foldedUnder, hops: ids.slice(1).map((toEntity, i) => ({
    toEntity, toName: toEntity, edge: { edgeId: `${ids[i]}-${toEntity}`, fromEntity: ids[i]!, toEntity,
      fromName: ids[i]!, toName: toEntity, kind: 'colleague', tier: 'B', strength: null, tieBand: null,
      evidence: [], reviewedByName: null, reviewedAt: null, reviewNote: null, validFrom: new Date('2026-01-01'), validTo: null },
  })), connectorIds: ids.slice(1, -1), connectorNames: ids.slice(1, -1), verdict: 'recommend', reasons: ['Fictional supported tie'], weakestTier: 'B', askLoad: null, influence: null };
}
const shared = [route(['Source', 'Shared', 'Target']), route(['Shared', 'Target']), route(['Other', 'Shared', 'Target'])];
const layout = routeGraphLayout(shared);
assert.equal(layout.nodes.length, 4, 'A person shared between source and intermediate positions appears once');
assert.equal(new Set(layout.nodes.map((n) => n.id)).size, layout.nodes.length);
assert.ok(layout.nodes.find((n) => n.id === 'Shared')!.x > layout.nodes.find((n) => n.id === 'Source')!.x, 'Shorter route starts farther right');
const reversed = route(['Source', 'Target']);
delete reversed.fromEntity;
reversed.hops[0]!.edge.fromEntity = 'Target';
reversed.hops[0]!.edge.toEntity = 'Source';
assert.equal(routeNodeIds(reversed)[0], 'Source', 'Undirected edges infer the traversed source correctly');

const routes = Array.from({ length: 110 }, (_, i) => route(['Source', `Connector ${i}`, 'Target']));
routes[10]!.foldedUnder = 0;
routes[11]!.foldedUnder = 0;
const options = { minimumWarmth: 0, lastWarmth: () => 2, preferred: () => false };
assert.equal(routeComparison(routes, options).displayedRoutes.length, 8);
assert.equal(routeComparison(routes, { ...options, show: '16' }).displayedRoutes.length, 16);
for (const selected of ['10', '79', '109']) {
  const result = routeComparison(routes, { ...options, selected });
  assert.ok(result.displayedRoutes.some((r) => String(r.index) === selected), 'Selected route remains visible across folds and pages');
}
assert.deepEqual(routeComparison(routes, { ...options, family: '10' }).eligible.map((x) => x.index), [0, 10, 11], 'Family link includes only parent and alternatives');
assert.equal(routeComparison(routes, { ...options, exclude: 'Connector 0' }).eligible.some((x) => x.index === 10), true, 'A filtered parent never hides an otherwise eligible alternative');
assert.equal(routeComparison(routes, { ...options, minimumWarmth: 3 }).eligible.length, 0);
const restricted = route(['Source', 'Restricted', 'Target']);
restricted.verdict = 'excluded';
assert.equal(routeComparison([restricted, routes[0]!], { ...options, preferred: (r) => r === restricted }).eligible[0]!.route, routes[0], 'A preference cannot promote a restricted route above usable routes');
assert.equal(routeComparison(routes, { ...options, show: '999999', page: '999999' }).displayedRoutes.length <= 80, true);

const scored = { ...shared[0]!, score: { version: 'fixture', evaluatedAt: '2026-01-01T00:00:00Z', confidence: 0.8, value: 91, band: 'strong' as const, factors: [{ key: 'lastHop' as const, edgeIds: [], label: 'Last hop', points: 42, basis: 'Recorded joint work' }] } };
assert.equal(routeReading(scored).score, 91);
assert.equal(routeReading(scored).provisional, false);
assert.equal(routeReading(scored).factors[0]!.value, '+42');
assert.equal(routeReading(shared[0]!).provisional, true);
const search: RouteSearch = { targetId: 'Target', targetName: 'Target', fromName: 'Source', routes: shared, restrictions: [], coverage: { edges: 4, maxHops: 3, from: null, to: null, notInspected: [] } };
const withStats = { ...search, stats: { targetCount: 1, routeCount: 3, bestScore: 91, strongTargets: 1, bestRouteCounts: { strong: 1, warm: 0, weak: 0, unavailable: 0 }, counts: { strong: 2, warm: 1, weak: 0 }, confidenceStatement: 'Scoring module statement' } };
assert.equal(routeSummaryFor(withStats).confidence, 'Scoring module statement', 'Prefer the network summary function output');
assert.equal(routeSummaryFor(withStats).promising, 1);
assert.match(routeSummaryFor(search).basis, /Provisional/);
console.log('Routes UI: shared nodes, score/stats adapter, filtering, folding, deep links and bounded paging pass.');
