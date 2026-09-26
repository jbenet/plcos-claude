import type { Route, RouteSearch } from '@/modules/network/client';

export interface RouteReading {
  score: number;
  provisional: boolean;
  band: 'strong' | 'warm' | 'weak';
  factors: Array<{ label: string; value: string; basis: string }>;
}

/** Presentation adapter. The scoring module owns the model; legacy influence is explicitly provisional. */
export function routeReading(route: Route): RouteReading {
  // Structural bridge to the parallel scoring branch (RouteScore.value and signed factor points).
  const scored = route as unknown as { score?: { value: number; band: 'strong' | 'warm' | 'weak'; factors: Array<{ label: string; points: number; basis: string }> } };
  const supplied = scored.score?.value;
  const valid = typeof supplied === 'number' && Number.isFinite(supplied);
  // GUESS: tier-only fallback on the existing 0–100 display scale, never a success probability.
  const fallback = route.influence ? route.influence.score * 100 : { A: 80, B: 65, C: 35, D: 15 }[route.weakestTier];
  const factors = scored.score?.factors;
  return {
    score: Math.round(Math.max(0, Math.min(100, valid ? supplied : fallback))),
    provisional: !valid,
    band: valid ? scored.score!.band : fallback >= 75 ? 'strong' : fallback >= 50 ? 'warm' : 'weak',
    factors: factors?.map((f) => ({ label: f.label, value: `${f.points > 0 ? '+' : ''}${f.points}`, basis: f.basis }))
      ?? route.influence?.components.map((f) => ({ label: f.label, value: String(Math.round(f.score * 100)), basis: f.basis })) ?? [],
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
  // GUESS: display bands while the network scorer's summary is unavailable.
  const strong = usable.filter((r) => routeReading(r).score >= 75).length;
  const promising = usable.filter((r) => routeReading(r).score >= 50 && routeReading(r).score < 75).length;
  const supported = usable.some((r) => routeReading(r).score >= 75 && r.weakestTier <= 'B');
  return { strong, promising, weak: usable.length - strong - promising, unavailable: routes.length - usable.length,
    confidence: supported ? 'A strong route has supporting evidence' : strong ? 'Strong estimates; evidence is uncertain' : 'A great route is not established',
    basis: 'Provisional: influence or evidence tier; strong ≥75, promising ≥50. Bands are estimates, not odds of an introduction. Shared ties are not independent evidence.' };
}

export function routeNodeIds(route: Route): string[] {
  const first = route.hops[0];
  const source = route.fromEntity ?? (first ? (first.edge.toEntity === first.toEntity ? first.edge.fromEntity : first.edge.toEntity) : 'source');
  return [source, ...route.hops.map((h) => h.toEntity)];
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
    .sort((a, b) => Number(b.route.verdict === 'recommend') - Number(a.route.verdict === 'recommend')
      || Number(options.preferred(b.route)) - Number(options.preferred(a.route))
      || (routeReading(a.route).provisional && routeReading(b.route).provisional ? 0 : routeReading(b.route).score - routeReading(a.route).score) || a.index - b.index);
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
