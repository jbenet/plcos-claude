import type { Route, RouteSearch } from '@/modules/network/client';

export interface RouteReading {
  score: number;
  provisional: boolean;
  band: 'strong' | 'warm' | 'weak';
  factors: Array<{ label: string; value: string; basis: string }>;
}

/** Only the network scorer supplies a route score. Missing scores remain explicitly unscored. */
export function routeReading(route: Route): RouteReading {
  const supplied = route.score?.value;
  const valid = typeof supplied === 'number' && Number.isFinite(supplied);
  return {
    score: valid ? Math.max(0, Math.min(100, supplied)) : 0,
    provisional: !valid,
    band: valid ? route.score!.band : 'weak',
    factors: valid ? route.score!.factors.map((f) => ({ label: f.label, value: `${f.points > 0 ? '+' : ''}${Math.round(f.points * 100) / 100}`, basis: f.basis })) : [],
  };
}

export interface RouteSummary {
  strong: number;
  promising: number;
  weak: number;
  unavailable: number;
  confidence: string;
  basis: string;
}

/** Interim display summary. Shared edges make independent-route probability arithmetic misleading. */
export function routeSummaryFor(search: RouteSearch): RouteSummary {
  const supplied = (search as unknown as { stats?: { counts: { strong: number; warm: number; weak: number }; confidenceStatement: string } }).stats;
  if (supplied) return { strong: supplied.counts.strong, promising: supplied.counts.warm, weak: supplied.counts.weak,
    unavailable: search.routes.filter((r) => r.verdict !== 'recommend').length,
    confidence: supplied.confidenceStatement,
    basis: 'Network scoring summary · distinct usable chains before filters. Strength is an uncalibrated estimate; shared ties do not establish independent chances.' };
  return provisionalRouteSummary(search.routes.filter((r) => r.foldedUnder == null));
}

export function provisionalRouteSummary(routes: Route[]): RouteSummary {
  const usable = routes.filter((r) => r.verdict === 'recommend');
  const strong = usable.filter((r) => !routeReading(r).provisional && routeReading(r).band === 'strong').length;
  const promising = usable.filter((r) => !routeReading(r).provisional && routeReading(r).band === 'warm').length;
  const supported = usable.some((r) => !routeReading(r).provisional && routeReading(r).band === 'strong' && r.weakestTier <= 'B');
  return { strong, promising, weak: usable.length - strong - promising, unavailable: routes.length - usable.length,
    confidence: supported ? 'A strong route has supporting evidence' : strong ? 'Strong estimates; evidence is uncertain' : 'A great route is not established',
    basis: 'Provisional summary of available route scores. Unscored routes do not establish strength. Shared ties are not independent evidence.' };
}

export function routeNodeIds(route: Route): string[] {
  const first = route.hops[0];
  const source = route.fromEntity ?? (first ? (first.edge.toEntity === first.toEntity ? first.edge.fromEntity : first.edge.toEntity) : 'source');
  return [source, ...route.hops.map((h) => h.toEntity)];
}

export interface RouteGraphArc {
  key: string;
  from: string;
  to: string;
  edgeIds: string[];
  routeIndices: number[];
  score: number | null;
  grade: Route['weakestTier'];
}

/** One directed arc per entity pair. Parallel evidence stays linked to its route disclosures.
 * The best scored relationship supplies the label; a missing score never outranks a known zero.
 */
export function routeGraphArcs(routes: Route[]): RouteGraphArc[] {
  const arcs = new Map<string, RouteGraphArc>();
  routes.forEach((route, routeIndex) => {
    const nodes = routeNodeIds(route);
    route.hops.forEach((hop, i) => {
      const from = nodes[i]!, to = nodes[i + 1]!;
      if (from === to) return;
      const key = JSON.stringify([from, to]);
      const supplied = hop.edge.warmthScore;
      const score = typeof supplied === 'number' && Number.isFinite(supplied) ? Math.max(0, Math.min(5, supplied)) : null;
      const arc = arcs.get(key);
      if (!arc) {
        arcs.set(key, { key, from, to, edgeIds: [hop.edge.edgeId], routeIndices: [routeIndex], score, grade: hop.edge.tier });
        return;
      }
      if (!arc.edgeIds.includes(hop.edge.edgeId)) arc.edgeIds.push(hop.edge.edgeId);
      if (!arc.routeIndices.includes(routeIndex)) arc.routeIndices.push(routeIndex);
      if ((score !== null && (arc.score === null || score > arc.score))
        || (score === arc.score && hop.edge.tier < arc.grade)) {
        arc.score = score;
        arc.grade = hop.edge.tier;
      }
    });
  });
  return [...arcs.values()];
}

/** Keep labels legible when multiple relationships cross at almost the same midpoint.
 * Pixel clearances are presentation dimensions; displaced labels retain a leader to their arc.
 */
export function routeGraphArcLabels(arcs: RouteGraphArc[], nodes: Array<{ id: string; x: number; y: number }>, height: number) {
  const positions = new Map(nodes.map(node => [node.id, node]));
  const labels = arcs.map(arc => {
    const from = positions.get(arc.from)!, to = positions.get(arc.to)!;
    const bend = from.x === to.x ? (from.y < to.y ? 42 : -42) : 0;
    const x = (from.x + to.x) / 2 + bend * 0.75, anchorY = (from.y + to.y) / 2;
    return { key: arc.key, x, y: anchorY - 7, anchorY };
  }).sort((a, b) => a.x - b.x || a.y - b.y || a.key.localeCompare(b.key));
  const bands: typeof labels[] = [];
  for (const label of labels) {
    const previous = bands.at(-1);
    if (previous && label.x - previous.at(-1)!.x < 100) previous.push(label);
    else bands.push([label]);
  }
  for (const band of bands) {
    band.sort((a, b) => a.y - b.y || a.key.localeCompare(b.key));
    // Center the required spread on the relationships instead of pushing all labels down.
    const start = Math.max(18, Math.min(height - 18 - (band.length - 1) * 22,
      band.reduce((sum, label) => sum + label.y, 0) / band.length - (band.length - 1) * 11));
    band.forEach((label, i) => { label.y = start + i * 22; });
  }
  return new Map(labels.map(label => [label.key, label]));
}

/** One position per entity. Distance from the target permits shorter paths to begin farther right. */
export function routeGraphLayout(routes: Route[]) {
  const nodes = new Map<string, { id: string; name: string; depth: number; x: number; y: number }>();
  for (const route of routes) {
    const ids = routeNodeIds(route);
    const names = [route.fromName ?? route.hops[0]?.edge.fromName ?? 'Source', ...route.hops.map((h) => h.toName)];
    ids.forEach((id, i) => {
      const depth = ids.length - 1 - i;
      const existing = nodes.get(id);
      if (existing) existing.depth = Math.max(existing.depth, depth);
      else nodes.set(id, { id, name: names[i]!, depth, x: 0, y: 0 });
    });
  }
  const maxDepth = Math.max(1, ...[...nodes.values()].map((n) => n.depth));
  const columns = Array.from({ length: maxDepth + 1 }, (_, d) => [...nodes.values()].filter((n) => n.depth === d));
  const height = Math.max(180, ...columns.map((c) => c.length * 58 + 44));
  for (const column of columns) column.forEach((n, i) => {
    n.x = 100 + (maxDepth - n.depth) * 520 / maxDepth;
    n.y = height / (column.length + 1) * (i + 1);
  });
  return { nodes: [...nodes.values()], height, width: 740 };
}

export interface ComparisonOptions {
  expanded?: string; family?: string; selected?: string; show?: string; page?: string;
  exclude?: string; minimumWarmth: number;
  lastWarmth: (route: Route) => number;
  preferred: (route: Route) => boolean;
}

/** Keep stable source indices through filters, folding and paging. Deep links always reveal their row. */
export function routeComparison(routes: Route[], options: ComparisonOptions) {
  const filtered = routes.map((route, index) => ({ route, index }))
    .filter(({ route }) => !options.exclude || !route.hops.slice(0, -1).some((h) => h.toEntity === options.exclude))
    .filter(({ route }) => !options.minimumWarmth || options.lastWarmth(route) >= options.minimumWarmth);
  const eligibleIds = new Set(filtered.map((x) => x.index));
  const familyId = /^\d+$/.test(options.family ?? '') && routes[Number(options.family)]
    ? routes[Number(options.family)]!.foldedUnder ?? Number(options.family) : null;
  const eligible = filtered.filter(({ route, index }) => familyId !== null
    ? index === familyId || route.foldedUnder === familyId
    : options.expanded === '1' || route.foldedUnder == null || !eligibleIds.has(route.foldedUnder) || String(index) === options.selected)
    .sort((a, b) => Number(routeReading(a.route).provisional) - Number(routeReading(b.route).provisional)
      || routeReading(b.route).score - routeReading(a.route).score
      || Number(b.route.verdict === 'recommend') - Number(a.route.verdict === 'recommend')
      || Number(options.preferred(b.route)) - Number(options.preferred(a.route)) || a.index - b.index);
  const requested = Number(options.show);
  const selectedPosition = eligible.findIndex((entry) => String(entry.index) === options.selected);
  const requestedShow = Number.isSafeInteger(requested) && requested >= 8 ? Math.min(requested, 80) : 8;
  const show = selectedPosition >= 0 ? Math.max(requestedShow, Math.ceil((selectedPosition % 80 + 1) / 8) * 8) : requestedShow;
  const pageNumber = selectedPosition >= 0 ? Math.floor(selectedPosition / 80)
    : /^\d+$/.test(options.page ?? '') ? Math.min(Number(options.page), Math.max(0, Math.ceil(eligible.length / 80) - 1)) : 0;
  const displayedRoutes = eligible.slice(pageNumber * 80, pageNumber * 80 + show);
  const selected = displayedRoutes.find((x) => String(x.index) === options.selected)?.index ?? displayedRoutes[0]?.index;
  const alternatives = new Map<number, typeof filtered>();
  for (const entry of filtered) if (entry.route.foldedUnder != null) alternatives.set(entry.route.foldedUnder, [...(alternatives.get(entry.route.foldedUnder) ?? []), entry]);
  return { eligible, familyId, show, pageNumber, displayedRoutes, selected, alternatives };
}
