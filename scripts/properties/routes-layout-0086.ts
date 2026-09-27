import type { Route } from '../../modules/network/types';
import { routeGraphArcs, routeGraphLayout } from '../../components/routes/route-display';
import type { Check } from './harness';

/** Invented records: these checks need neither a server nor a database. */
function route(ids: string[]): Route {
  return { fromEntity: ids[0], fromName: ids[0], hops: ids.slice(1).map((toEntity, i) => ({
    toEntity, toName: toEntity, edge: { edgeId: `${ids[i]}:${toEntity}`, fromEntity: ids[i]!, toEntity,
      fromName: ids[i]!, toName: toEntity, kind: 'colleague', tier: 'B', strength: null, tieBand: null,
      evidence: [], reviewedByName: null, reviewedAt: null, reviewNote: null,
      validFrom: new Date('2026-01-01'), validTo: null },
  })), connectorIds: ids.slice(1, -1), connectorNames: ids.slice(1, -1), verdict: 'recommend',
  reasons: ['Invented relationship'], weakestTier: 'B', askLoad: null, influence: null };
}

export function routesLayout0086Properties(check: Check) {
  const aliasPaths = [route(['Source', 'Record A', 'Target']), route(['Source', 'Record B', 'Target'])]
    .map(r => ({ ...r, identityGroups: { 'Record A': 'same-person', 'Record B': 'same-person' } }));
  const aliasLayout = routeGraphLayout(aliasPaths), aliasArcs = routeGraphArcs(aliasPaths);
  check('0088 unmerged matching records share a map node while retaining separate route evidence',
    aliasLayout.nodes.length === 3 && aliasArcs.length === 2 && aliasArcs.every(a => a.routeIndices.length === 2)
      && aliasPaths[0]!.hops[0]!.toEntity !== aliasPaths[1]!.hops[0]!.toEntity,
    'Only presentation groups possible identities; source entity IDs and both list disclosures survive.');
  // Previously A and B both occupied depth 2, despite the A → B relationship.
  const shared = [route(['Source', 'A', 'B', 'Target']), route(['Source', 'B', 'C', 'Target'])];
  const layout = routeGraphLayout(shared);
  const positions = new Map(layout.nodes.map(node => [node.id, node]));
  check('0086 shared paths preserve every hop direction across distinct layers',
    routeGraphArcs(shared).every(arc => positions.get(arc.from)!.x < positions.get(arc.to)!.x)
      && layout.nodes.length === 5 && layout.width >= 4 * 240 + 220,
    'The union needs four hops even though each individual route has three.');

  const cyclic = [route(['Source', 'A', 'B', 'Target']), route(['Source', 'B', 'A', 'Target'])];
  const cycleLayout = routeGraphLayout(cyclic);
  const cyclePositions = new Map(cycleLayout.nodes.map(node => [node.id, node]));
  check('0086 cyclic route unions retain one person per node and no same-layer arrows',
    cycleLayout.nodes.length === 4
      && routeGraphArcs(cyclic).every(arc => cyclePositions.get(arc.from)!.x !== cyclePositions.get(arc.to)!.x)
      && cyclePositions.get('Source')!.x < Math.min(cyclePositions.get('A')!.x, cyclePositions.get('B')!.x)
      && cyclePositions.get('Target')!.x > Math.max(cyclePositions.get('A')!.x, cyclePositions.get('B')!.x),
    'Conflicting hop order remains represented by one forward and one reverse relationship.');
  const serializedPositions = (routes: Route[]) => JSON.stringify(routeGraphLayout(routes).nodes
    .sort((a, b) => a.id.localeCompare(b.id)));
  check('0086 route order cannot change graph layers or positions',
    serializedPositions(shared) === serializedPositions([...shared].reverse())
      && serializedPositions(cyclic) === serializedPositions([...cyclic].reverse()),
    'Stable ordering covers acyclic shared paths and the ambiguous cyclic union.');

  const expanded = routeGraphLayout(shared, 1800);
  const narrow = routeGraphLayout(shared, 360);
  check('0086 graph fills wider containers and keeps hop spacing in narrow containers',
    expanded.width === 1800 && narrow.width === layout.width
      && Math.max(...expanded.nodes.map(node => node.x)) === 1690
      && Math.min(...expanded.nodes.map(node => node.x)) === 110
      && expanded.height === layout.height && narrow.height === layout.height,
    'SVG viewport and pixel dimensions match; horizontal space grows without scaling text.');

  // Exercise several unions containing multiple cycles and alternate starting points.
  let allSeparated = true;
  for (let mask = 1; mask < 64; mask++) {
    const alternatives = [
      ['S', 'A', 'B', 'T'], ['S', 'B', 'C', 'T'], ['A', 'C', 'T'],
      ['C', 'A', 'T'], ['B', 'A', 'T'], ['S', 'T'],
    ].filter((_, i) => mask & (1 << i)).map(route);
    const current = routeGraphLayout(alternatives);
    const byId = new Map(current.nodes.map(node => [node.id, node]));
    allSeparated &&= current.nodes.length === new Set(alternatives.flatMap(r => [r.fromEntity!, ...r.hops.map(h => h.toEntity)])).size
      && routeGraphArcs(alternatives).every(arc => byId.get(arc.from)!.depth !== byId.get(arc.to)!.depth)
      && serializedPositions(alternatives) === serializedPositions([...alternatives].reverse());
  }
  check('0086 every relationship across 63 path unions connects distinct stable layers', allSeparated,
    'Includes multiple cycles, shared connectors, unequal lengths and alternate sources.');
  const empty = routeGraphLayout([]);
  check('0086 empty route graph has finite dimensions', empty.nodes.length === 0
    && Number.isFinite(empty.width) && Number.isFinite(empty.height), 'No invalid coordinates in the empty state.');
}
