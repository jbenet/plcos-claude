import { routeComparisonInputs, graphRouteInputs } from '../lib/routes-data';
import { dominatedFolds, nearIdenticalOrgNames, orgDisplayGroups, routeComparison, routeGraphLayout } from '../components/routes/route-display';
import { config } from '../config/deployment';
import { edgeWarmth, foldRoutes, routePage, type Edge, type Route } from '../modules/network';

// Frozen pre-PERF2 behavior: changing the implementation cannot change this oracle.
function referenceFold(routes: Route[], at = new Date()): Route[] {
  const out = routes.map((r) => ({ ...r, foldedUnder: null as number | null }));
  const warmth = new Map<Edge, number>();
  const score = (edge: Edge) => {
    if (!warmth.has(edge)) warmth.set(edge, edgeWarmth(edge, at).score);
    return warmth.get(edge)!;
  };
  for (const [longerIndex, longer] of out.entries()) {
    const parent = out.findIndex((shorter, shorterIndex) => {
      const first = shorter.hops[0];
      if (!first || shorter.hops.length < 1 || shorter.hops.length > longer.hops.length
        || shorter.verdict !== 'recommend' || longer.verdict !== 'recommend') return false;
      if (shorter.fromEntity !== longer.fromEntity) return false;
      // Parallel evidence edges along the same people are alternatives, not new introductions.
      if (shorter.hops.length === longer.hops.length) return shorterIndex < longerIndex
        && shorter.hops.every((h, i) => h.toEntity === longer.hops[i]?.toEntity
          && h.edge.tier <= longer.hops[i]!.edge.tier
          && score(h.edge) >= score(longer.hops[i]!.edge));
      const firstWarmth = score(first.edge);
      if (first.edge.tier > 'B') return false;
      // A strong A/B prefix dominates a weaker detour even when the shared suffix is C/D.
      // Unknown contact dates reduce warmth; they are not a separate eligibility gate.

      const offset = longer.hops.length - shorter.hops.length;
      const detourWarmth = Math.min(...longer.hops.slice(0, offset + 1).map((h) => score(h.edge)));
      const detourTier = longer.hops.slice(0, offset + 1).map((h) => h.edge.tier).sort().at(-1)!;
      if (first.edge.tier > detourTier || firstWarmth < detourWarmth) return false;
      if (firstWarmth < config.routeWarmth.strongFirstHop && !(first.edge.tier < detourTier && firstWarmth > detourWarmth)) return false;
      return longer.hops[offset]?.toEntity === first.toEntity
        && shorter.hops.slice(1).every((h, i) => h.toEntity === longer.hops[offset + i + 1]?.toEntity
          && h.edge.tier <= longer.hops[offset + i + 1]!.edge.tier
          && score(h.edge) >= score(longer.hops[offset + i + 1]!.edge));
    });
    if (parent >= 0) longer.foldedUnder = parent;
  }
  // If a parent was itself folded, point at the visible ancestor.
  for (const r of out) while (r.foldedUnder !== null && out[r.foldedUnder]!.foldedUnder !== null) r.foldedUnder = out[r.foldedUnder]!.foldedUnder;
  return out;
}


type Check = (name: string, ok: boolean, detail: string) => void;
const at = new Date('2026-09-26T12:00:00Z');
function edge(id: string, tier: Edge['tier'] = 'A', weak = false): Edge {
  return { edgeId: id, fromEntity: 'from', toEntity: id, fromName: 'From', toName: id,
    kind: 'colleague', tier, strength: null, tieBand: null,
    evidence: [{ note: 'Invented fixture', tie: { kind: weak ? 'proximity' : 'worked_together', lastInteraction: '2026-09-01' } }],
    reviewedByName: null, reviewedAt: null, reviewNote: null, validFrom: at, validTo: null };
}
function route(nodes: string[], index: number, source = 'team', tiers: Edge['tier'][] = ['A'], weak = false): Route {
  return { fromEntity: source, fromName: source,
    hops: nodes.map((node, i) => ({ toEntity: node, toName: node, edge: edge(`${index}-${i}`, tiers[i % tiers.length], weak) })),
    connectorIds: nodes.slice(0, -1), connectorNames: nodes.slice(0, -1), verdict: 'recommend', reasons: [], weakestTier: 'A', askLoad: null, influence: null };
}

export function routePresentationProperties(check: Check) {
  let state = 123456789;
  const random = (n: number) => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) % n; };
  for (let pass = 0; pass < 6; pass++) {
    const fixtures = Array.from({ length: 360 }, (_, i) => {
      const chain = [`via-${random(8)}`, `carrier-${random(6)}`, 'target'].slice(random(3));
      const r = route(chain, i, `source-${random(3)}`, Array.from({length:3}, () => (['A','B','C','D'] as const)[random(4)]!), random(2) === 0);
      r.verdict = (['recommend', 'recommend', 'recommend', 'hold', 'excluded'] as const)[random(5)]!;
      return r;
    });
    const actual = foldRoutes(fixtures, at), expected = referenceFold(fixtures, at);
    check(`PERF2 fold equivalence, shuffled fixture ${pass + 1}`, JSON.stringify(actual) === JSON.stringify(expected),
      'Same earliest parent, parallel evidence, suffix dominance, sources, weak tiers, held/excluded routes and ancestor folding.');
  }
  const generated = Array.from({ length: 3000 }, (_, i) => route(i % 2 ? [`a-${i}`, `b-${i}`, 'target'] : [`b-${i}`, 'target'], i));
  foldRoutes(generated, at);
  const start = performance.now();
  const folded = foldRoutes(generated, at);
  const elapsed = performance.now() - start;
  check('PERF2 folding 3000 routes stays below 250 ms', elapsed < 250 && folded.every((r) => r.foldedUnder === null),
    `${Math.round(elapsed)} ms; distinct suffixes must not cause an all-pairs comparison.`);

  const pages = Array.from({ length: 145 }, (_, i) => ({ ...route(['carrier', 'target'], i), foldedUnder: i < 65 ? null : 0 }));
  const first = routePage(pages, {}), second = routePage(pages, {page:'1'});
  const deep = routePage(pages, {selected:'144', expanded:'1'});
  const family = routePage(pages, {family:'0', page:'2'});
  check('PERF2 bounded pages preserve every ranked route and deep link',
    first.shown.length === 6 && first.eligibleCount === 65 && first.pages === 11 && second.shown[0]?.index === 6
    && deep.shown.some((x) => x.index === 144) && deep.selected === 144 && deep.shown.length <= 6,
    'The graph and list receive the same page; route IDs remain indices in the complete ranked result.');
  const all = Array.from({length:25}, (_,i) => routePage(pages, {expanded:'1', page:String(i)}).shown).flat();
  check('PERF2 pagination and alternative families lose no evidence',
    all.length === 145 && new Set(all.map((r) => r.index)).size === 145 && first.alternatives.get(0)?.length === 80
      && family.eligibleCount === 81 && family.shown.every((r) => r.index === 0 || r.route.foldedUnder === 0),
    'Every alternative can be inspected through its family; counts cover the complete result.');
  const options = { minimumWarmth: 0, lastWarmth: () => 3, preferred: () => false };
  const compact = routeComparisonInputs(pages, options);
  const more = routeComparisonInputs(pages, { ...options, show: '14' });
  const selectedBeyond = routeComparisonInputs(pages, { ...options, selected: '10' });
  const graph = graphRouteInputs(compact.displayedRoutes.map((entry) => entry.route));
  check('CACHE2 default evidence rendering is bounded while merged UI controls expose every route',
    compact.displayedRoutes.length === 6 && more.displayedRoutes.length === 14
      && selectedBeyond.displayedRoutes.some((entry) => entry.index === 10)
      && graph.every((r, i) => r.hops.every((h, j) => h.toEntity === compact.displayedRoutes[i]!.route.hops[j]!.toEntity
        && h.edge.evidence.length === 0)) && compact.displayedRoutes.every((r) => r.route.hops.every((h) => h.edge.evidence.length > 0)),
    'Show-more/deep links preserve route access; client graph omits source payloads while server evidence remains intact.');
  // Feedback 0131–0132 (7 Oct 2026): a weaker indirect chain folds beneath the best direct route, one click away.
  const scored = (r: Route, value: number): Route => ({ ...r, score: { version: 't', evaluatedAt: at.toISOString(), value, band: value >= 60 ? 'strong' : 'weak', confidence: 1, factors: [] } });
  const mix = [scored(route(['T'], 0, 'ana'), 80), scored(route(['x', 'y', 'T'], 1, 'ben'), 0), scored(route(['z', 'T'], 2, 'ben'), 90),
    scored(route(['w', 'T'], 3, 'cy'), 40), { ...scored(route(['T'], 4, 'dee'), 95), verdict: 'hold' as const }];
  const folds = dominatedFolds(mix);
  const cmp = routeComparison(mix, options);
  const expandedCmp = routeComparison(mix, { ...options, expanded: '1' });
  const shownIdx = cmp.eligible.map((e) => e.index).sort();
  check('ROUTES an indirect route scoring below the best recommended direct route folds beneath it as an alternative; a stronger one stays, and the expanded view shows all',
    folds.get(1) === 0 && folds.get(3) === 0 && !folds.has(2) && !folds.has(0) && !folds.has(4)
      && shownIdx.join() === '0,2,4' && cmp.alternatives.get(0)?.map((e) => e.index).sort().join() === '1,3'
      && expandedCmp.eligible.length === 5 && dominatedFolds([mix[1]!, mix[2]!]).size === 0,
    `folds ${JSON.stringify([...folds])}; shown ${shownIdx.join()}; expanded ${expandedCmp.eligible.length}`);
  // Feedback 0123 (7 Oct 2026): one firm split into three records shows as one map node; people never combine by name.
  const orgRoute = (via: string, org: string, name: string, i: number): Route => {
    const r = route([via, org], 100 + i, 'team');
    r.hops[1] = { ...r.hops[1]!, toName: name };
    return { ...r, organizationIds: [org] };
  };
  const split = [orgRoute('p1', 'o1', 'Netholabs', 0), orgRoute('p2', 'o2', 'Netho Labs, Inc.', 1), orgRoute('p3', 'o3', 'Netho', 2),
    orgRoute('p4', 'o4', 'Nethelabs', 3), orgRoute('p5', 'o5', 'Polaris Ventures', 4)];
  const people = [route(['Ann Lee', 'T'], 120), route(['Ann Leee', 'T'], 121)];
  const grouped = orgDisplayGroups([...split, ...people]);
  const drawn = routeGraphLayout(grouped.routes).nodes.map((n) => n.id);
  check('ROUTES near-identical organisation names share one map node that says it combines them; records, other firms and people stay separate',
    drawn.filter((id) => /^o/.test(id)).sort().join() === 'o1,o5' && grouped.combined.get('o1')?.records === 4
      && split.every((r) => r.hops[1]!.toEntity.startsWith('o') && !r.identityGroups) && drawn.includes('Ann Lee') && drawn.includes('Ann Leee')
      && !nearIdenticalOrgNames('Coin', 'Coinbase') && !nearIdenticalOrgNames('Protocol Labs', 'Protocol Ventures') && nearIdenticalOrgNames('The Acme Co', 'ACME'),
    `drawn ${drawn.join()}; combined ${JSON.stringify([...grouped.combined])}`);
  check('PERF2 invalid page parameters stay bounded', routePage(pages, {page:'999999999999999999999'}).shown.length === 6
    && routePage([], {page:'100', selected:'NaN', family:'2'}).shown.length === 0,
    'Empty and malformed queries do not expand the render or produce an invalid selection.');
}
