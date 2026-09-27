/** Invented route fixtures only. Run with node --import tsx scripts/routes-0070-graph-properties.ts. */
import assert from 'node:assert/strict';
import { routeComparison, routeGraphArcLabels, routeGraphArcs, routeGraphLayout, routeReading } from '../components/routes/route-display';
import type { Route } from '../modules/network/types';

function route(ids: string[], score?: number, hopScores = ids.slice(1).map(() => 2)): Route {
  return {
    fromEntity: ids[0], fromName: ids[0],
    hops: ids.slice(1).map((to, index) => ({ toEntity: to, toName: to,
      edge: { edgeId: `${ids[index]}:${to}`, fromEntity: ids[index]!, toEntity: to,
        fromName: ids[index]!, toName: to, kind: 'colleague', tier: 'B', warmthScore: hopScores[index],
        strength: null, tieBand: null, evidence: [], reviewedByName: null, reviewedAt: null,
        reviewNote: null, validFrom: new Date('2026-01-01'), validTo: null },
    })),
    connectorIds: ids.slice(1, -1), connectorNames: ids.slice(1, -1),
    verdict: 'recommend', reasons: ['Invented relationship fixture'], weakestTier: 'B', askLoad: null, influence: null,
    ...(score === undefined ? {} : { score: { value: score, band: 'weak', version: 'fixture',
      evaluatedAt: '2026-01-01T00:00:00Z', confidence: 0.5, factors: [] } }),
  };
}

const shared = [route(['PL', 'Invented A', 'Invented C'], 25, [3, 2]),
  route(['PL', 'Invented B', 'Invented A', 'Invented C'], 20, [3, 3, 2]),
  route(['Invented A', 'Invented C'], 30, [2])];
const arcs = routeGraphArcs(shared);
assert.equal(arcs.length, 4, 'Shared directed relationships produce exactly one arc each');
const common = arcs.find((arc) => arc.from === 'Invented A' && arc.to === 'Invented C')!;
assert.deepEqual(common.routeIndices, [0, 1, 2], 'All routes remain reachable from the aggregated relationship');
assert.deepEqual(common.edgeIds, ['Invented A:Invented C']);
assert.equal(common.score, 2);
assert.equal(common.grade, 'B');
const layout = routeGraphLayout(shared);
assert.equal(layout.nodes.length, 4);
assert.equal(layout.nodes.filter((node) => node.name === 'PL').length, 1);
assert.ok(layout.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
assert.ok(arcs.every((arc) => layout.nodes.some((node) => node.id === arc.from)
  && layout.nodes.some((node) => node.id === arc.to)), 'Every distinct arc has two positioned endpoints');
const crossing = routeGraphArcs([route(['Left A', 'Right A']), route(['Left B', 'Right B'])]);
const labelPositions = routeGraphArcLabels(crossing, [
  { id: 'Left A', x: 100, y: 100 }, { id: 'Right A', x: 360, y: 194.4 },
  { id: 'Left B', x: 100, y: 120 }, { id: 'Right B', x: 360, y: 192.8 },
], 250);
const closeLabels = [...labelPositions.values()];
assert.ok(Math.abs(closeLabels[0]!.y - closeLabels[1]!.y) >= 22,
  'Arc labels 9.2px apart at the same x gain at least 22px vertical clearance');
assert.deepEqual([...routeGraphArcLabels([...crossing].reverse(), [
  { id: 'Left A', x: 100, y: 100 }, { id: 'Right A', x: 360, y: 194.4 },
  { id: 'Left B', x: 100, y: 120 }, { id: 'Right B', x: 360, y: 192.8 },
], 250)], [...labelPositions], 'Label positions do not depend on route insertion order');

const weak = route(['Invented A', 'Invented C'], 0, [0]);
weak.hops[0]!.edge.tier = 'D';
weak.hops[0]!.edge.edgeId = 'invented-parallel-evidence';
const unknown = route(['Invented A', 'Invented C']);
delete unknown.hops[0]!.edge.warmthScore;
const combined = routeGraphArcs([weak, unknown, shared[2]!]);
assert.equal(combined.length, 1);
assert.equal(combined[0]!.score, 2, 'Strongest recorded parallel tie supplies the shared label');
assert.equal(combined[0]!.grade, 'B', 'Grade belongs to the same evidence as the shown score');
assert.equal(combined[0]!.edgeIds.length, 2, 'Distinct evidence edges stay available');
assert.equal(routeGraphArcs([unknown])[0]!.score, null, 'Missing scores remain unknown');
assert.equal(routeGraphArcs([unknown, weak])[0]!.score, 0, 'Known zero beats an unknown score');
assert.equal(routeGraphArcs([shared[2]!, route(['Invented C', 'Invented A'])]).length, 2,
  'Aggregation keeps direction explicit');

const options = { minimumWarmth: 0, lastWarmth: () => 2, preferred: () => false };
const held = route(['Invented source', 'Invented held'], 90);
held.verdict = 'hold';
const lower = route(['Invented source', 'Invented lower'], 40);
const unscored = route(['Invented source', 'Invented unknown']);
unscored.weakestTier = 'A';
const invalid = route(['Invented source', 'Invented invalid'], Number.NaN);
const zero = route(['Invented source', 'Invented zero'], 0);
const sorted = routeComparison([unscored, lower, invalid, zero, held], { ...options,
  preferred: (candidate) => candidate === unscored || candidate === lower });
assert.deepEqual(sorted.eligible.map((entry) => entry.index), [4, 1, 3, 0, 2],
  'Actual score orders routes, including held ones; preferences cannot promote unknowns or weaker scores');
assert.equal(sorted.eligible[0]!.route.verdict, 'hold', 'Sorting never changes the action verdict');
assert.equal(routeReading(unscored).score, 0);
assert.equal(routeReading(unscored).provisional, true);
assert.deepEqual(routeReading(unscored).factors, []);
assert.equal(routeReading(invalid).provisional, true);
assert.equal(routeReading(zero).provisional, false, 'A known zero and an unscored route remain distinguishable');
assert.equal(routeReading(route(['Invented source', 'Invented precise'], 0.04)).score, 0.04,
  'Display ordering preserves score precision');

console.log('Routes 0068/0070: shared directed arcs, evidence labels, single entity positions and scored-first ordering pass.');
