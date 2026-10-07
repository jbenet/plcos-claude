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

function recordNodeIds(route: Route): string[] {
  const first = route.hops[0];
  const source = route.fromEntity ?? (first ? (first.edge.toEntity === first.toEntity ? first.edge.fromEntity : first.edge.toEntity) : 'source');
  return [source, ...route.hops.map((h) => h.toEntity)];
}
export function routeNodeIds(route: Route): string[] {
  return recordNodeIds(route).map(id => route.identityGroups?.[id] ?? id);
}

const LEGAL_SUFFIX = /(incorporated|inc|llc|ltd|limited|gmbh|corp|corporation|company|co|plc|sa|ag|bv|lp|llp|holdings)$/;
/** Lower-case letters and digits, without a trailing legal form: "Netho Labs, Inc." and "NethoLabs" read the same. */
export function orgNameKey(name: string): string {
  let key = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/^the\s+/, '').replace(/[^\p{L}\p{N}]/gu, '');
  for (let previous = ''; previous !== key && key.length > 4;) { previous = key; key = key.replace(LEGAL_SUFFIX, '') || previous; }
  return key;
}
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
// A short form drops one of these words: "Netho" for "Netho Labs". GUESS list from feedback 0123.
const GENERIC_TAIL = /^(labs?|capital|ventures?|partners|group|fund|foundation|network|technologies|tech|management|investments?|ai|bio|research|global|vc)+$/;
/** Near-identical organisation names: the same letters, one typo apart (6+ letters), or a short form of 4+ letters
 * the other adds only generic words to. Thresholds are GUESSES from feedback 0123 (two spellings plus a short form). */
export function nearIdenticalOrgNames(a: string, b: string): boolean {
  const x = orgNameKey(a), y = orgNameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return (short.length >= 4 && long.startsWith(short) && GENERIC_TAIL.test(long.slice(short.length))) || (short.length >= 6 && withinOneEdit(x, y));
}

/** Feedback 0123: draw near-identical organisation names as one map node. Display only: the routes returned are copies
 * whose identityGroups point the matched organisations at one id, records stay unmerged, and `combined` names what
 * each drawn node stands for so the node can say so. People are never combined by name here. */
export function orgDisplayGroups(routes: Route[]): { routes: Route[]; combined: Map<string, { names: string[]; records: number }>; groupOf: Map<string, string> } {
  const names = new Map<string, string>();
  for (const route of routes) {
    const ids = routeNodeIds(route), raw = recordNodeIds(route);
    const labels = [route.fromName ?? route.hops[0]?.edge.fromName ?? '', ...route.hops.map((h) => h.toName)];
    raw.forEach((id, i) => { if (route.organizationIds?.includes(id) && !names.has(ids[i]!)) names.set(ids[i]!, labels[i]!); });
  }
  const ids = [...names.keys()].sort(), parent = new Map(ids.map((id) => [id, id]));
  const find = (id: string): string => { while (parent.get(id) !== id) id = parent.get(id)!; return id; };
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++)
    if (nearIdenticalOrgNames(names.get(ids[i]!)!, names.get(ids[j]!)!)) {
      const a = find(ids[i]!), b = find(ids[j]!);
      if (a !== b) parent.set(a < b ? b : a, a < b ? a : b);
    }
  const groupOf = new Map<string, string>(), combined = new Map<string, { names: string[]; records: number }>();
  for (const id of ids) {
    const root = find(id);
    if (root === id && ids.every((other) => other === id || find(other) !== id)) continue;
    groupOf.set(id, root);
    const entry = combined.get(root) ?? { names: [], records: 0 };
    entry.records++;
    if (!entry.names.includes(names.get(id)!)) entry.names.push(names.get(id)!);
    combined.set(root, entry);
  }
  if (!groupOf.size) return { routes, combined, groupOf };
  return { combined, groupOf, routes: routes.map((route) => {
    const drawn = routeNodeIds(route);
    return { ...route, identityGroups: { ...route.identityGroups,
      ...Object.fromEntries(recordNodeIds(route).flatMap((id, i) => groupOf.has(drawn[i]!) ? [[id, groupOf.get(drawn[i]!)!]] : [])) } };
  }) };
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

/** One position per canonical entity supplied by the route model. Layers satisfy every
 * relationship in the union, not just each path's original hop number. A union can contain
 * cycles even when each path is simple: reserve distinct, deterministic columns inside
 * each strongly connected component and retain the true direction of its reverse arcs.
 */
export function routeGraphLayout(routes: Route[], availableWidth = 0) {
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
  const successors = new Map([...nodes.keys()].map(id => [id, new Set<string>()]));
  for (const arc of routeGraphArcs(routes)) successors.get(arc.from)!.add(arc.to);
  const order = new Map<string, number>(), low = new Map<string, number>();
  const stack: string[] = [], stacked = new Set<string>(), components: string[][] = [];
  function visit(id: string) {
    order.set(id, order.size);
    low.set(id, order.get(id)!);
    stack.push(id);
    stacked.add(id);
    for (const next of [...successors.get(id)!].sort()) {
      if (!order.has(next)) {
        visit(next);
        low.set(id, Math.min(low.get(id)!, low.get(next)!));
      } else if (stacked.has(next)) low.set(id, Math.min(low.get(id)!, order.get(next)!));
    }
    if (low.get(id) !== order.get(id)) return;
    const component: string[] = [];
    let member: string;
    do {
      member = stack.pop()!;
      stacked.delete(member);
      component.push(member);
    } while (member !== id);
    // Prefer original hop order inside a cycle; the ID resolves ambiguous ties.
    component.sort((a, b) => nodes.get(b)!.depth - nodes.get(a)!.depth || a.localeCompare(b));
    components.push(component);
  }
  for (const id of [...nodes.keys()].sort()) if (!order.has(id)) visit(id);
  const componentOf = new Map(components.flatMap((ids, index) => ids.map(id => [id, index] as const)));
  const depths = new Map<number, number>();
  function componentDepth(index: number): number {
    if (depths.has(index)) return depths.get(index)!;
    let depth = 0;
    for (const id of components[index]!) for (const next of successors.get(id)!) {
      const downstream = componentOf.get(next)!;
      if (downstream !== index) depth = Math.max(depth, componentDepth(downstream) + components[downstream]!.length);
    }
    depths.set(index, depth);
    return depth;
  }
  components.forEach((ids, index) => {
    const depth = componentDepth(index);
    ids.forEach((id, offset) => { nodes.get(id)!.depth = depth + ids.length - 1 - offset; });
  });
  const maxDepth = Math.max(1, ...[...nodes.values()].map((n) => n.depth));
  const columns = Array.from({ length: maxDepth + 1 }, (_, d) => [...nodes.values()].filter((n) => n.depth === d));
  const width = Math.max(740, maxDepth * 240 + 220, Number.isFinite(availableWidth) ? availableWidth : 0);
  const height = Math.max(240, ...columns.map((c) => c.length * 58 + 44));
  for (const column of columns) column.sort((a, b) => a.id.localeCompare(b.id));
  for (const column of columns) column.forEach((n, i) => {
    n.x = 110 + (maxDepth - n.depth) * (width - 220) / maxDepth;
    n.y = height / (column.length + 1) * (i + 1);
  });
  return { nodes: [...nodes.values()], height, width };
}

export interface ComparisonOptions {
  expanded?: string; family?: string; selected?: string; show?: string; page?: string;
  exclude?: string; minimumWarmth: number;
  lastWarmth: (route: Route) => number;
  preferred: (route: Route) => boolean;
}

/** Keep stable source indices through filters, folding and paging. Deep links always reveal their row. */
/**
 * Indirect routes a direct one already beats (feedback 0131–0132, 7 Oct 2026: weak chains through several people, from
 * one teammate, shown beside much stronger direct routes from others). Each indirect route scoring below the best
 * recommended direct route is folded beneath it, as an alternative: still one click away, and in the expanded view,
 * never deleted. Display only; the routes, their verdicts and scores are unchanged. Returns index → the direct route's.
 */
export function dominatedFolds(routes: Route[]): Map<number, number> {
  let best: { index: number; score: number } | null = null;
  routes.forEach((route, index) => {
    if (route.hops.length !== 1 || route.verdict !== 'recommend' || route.foldedUnder != null) return;
    const r = routeReading(route);
    if (!r.provisional && (!best || r.score > best.score)) best = { index, score: r.score };
  });
  const folds = new Map<number, number>();
  const direct = best as { index: number; score: number } | null;
  if (!direct) return folds;
  routes.forEach((route, index) => {
    if (route.hops.length < 2 || route.foldedUnder != null) return;
    const r = routeReading(route);
    if (r.provisional || r.score < direct.score) folds.set(index, direct.index);
  });
  return folds;
}

export function routeComparison(routes: Route[], options: ComparisonOptions) {
  const folds = dominatedFolds(routes);
  const foldOf = (route: Route, index: number) => route.foldedUnder ?? folds.get(index) ?? null;
  const filtered = routes.map((route, index) => ({ route, index }))
    .filter(({ route }) => !options.exclude || !route.hops.slice(0, -1).some((h) => h.toEntity === options.exclude))
    .filter(({ route }) => !options.minimumWarmth || options.lastWarmth(route) >= options.minimumWarmth);
  const eligibleIds = new Set(filtered.map((x) => x.index));
  const familyId = /^\d+$/.test(options.family ?? '') && routes[Number(options.family)]
    ? foldOf(routes[Number(options.family)]!, Number(options.family)) ?? Number(options.family) : null;
  const eligible = filtered.filter(({ route, index }) => familyId !== null
    ? index === familyId || foldOf(route, index) === familyId
    : options.expanded === '1' || foldOf(route, index) == null || !eligibleIds.has(foldOf(route, index)!) || String(index) === options.selected)
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
  for (const entry of filtered) {
    const under = foldOf(entry.route, entry.index);
    if (under != null) alternatives.set(under, [...(alternatives.get(under) ?? []), entry]);
  }
  return { eligible, familyId, show, pageNumber, displayedRoutes, selected, alternatives };
}
