import { routePolicyFacts, routeIdentityGroups } from './route-policy';
import { emptyRuleCounts, oversizedOrganization, organizationPenalty } from './route-rules';
import { createHash } from 'node:crypto';
import { config } from '@/config/deployment';
import { setImmediate } from 'node:timers/promises';
import { connectorLoad, restrictionsFor } from '@/modules/coordination';
import { listExposures } from '@/modules/pipeline';
import { listSyncSources } from '@/modules/platform';
import { edgesByIds, edgeCoverage } from './repo';
import { influenceFor } from './influence';
import { routeGraph, selectTopRoutes, summarizeRoutes } from './service';
import { investmentTie, scoreRoute, warmthReader, type RouteScoreContext } from './warmth';
import type { Edge, Route, RouteSearch, RouteVerdict, StructuralRoutes } from './types';

/** Keep evidence only for the visible routes. Other candidates retain just graph identity
 * and normalized scoring facts, so a new restriction cannot strand a usable alternative. */
export function routeCheckpoint() {
  let last = performance.now();
  return async (index: number) => {
    if (index % 128 === 0 && performance.now() - last >= 12) { await setImmediate(); last = performance.now(); }
  };
}

export async function compactStructuralRoutes(search: RouteSearch, roles: Map<string, RouteScoreContext>): Promise<RouteSearch> {
  const checkpoint = routeCheckpoint();
  const nodes: StructuralRoutes['nodes'] = [], edges: StructuralRoutes['edges'] = [];
  const nodeIds = new Map<string, number>(), edgeIds = new Map<string, number>();
  const node = (entityId: string, name: string) => {
    let index = nodeIds.get(entityId);
    if (index === undefined) { index = nodes.length; nodeIds.set(entityId, index); nodes.push({ entityId, name }); }
    return index;
  };
  const candidates: StructuralRoutes['candidates'] = [];
  for (const [routeIndex, route] of search.routes.entries()) {
    if (routeIndex % 128 === 0) await checkpoint(routeIndex);
    candidates.push({
    ...(route.viaContact ? { viaContact: route.viaContact } : {}),
    nodes: [node(route.fromEntity!, route.fromName ?? search.fromName), ...route.hops.map((h) => node(h.toEntity, h.toName))],
    edges: route.hops.map(({ edge }) => {
      let index = edgeIds.get(edge.edgeId);
      if (index === undefined) {
        index = edges.length; edgeIds.set(edge.edgeId, index);
        const evidence: Edge['evidence'] = edge.evidence.flatMap((ev) => {
          const normalized: Edge['evidence'] = ev.tie ? [{ note: '', tie: ev.tie }] : [];
          // Preserve the established legacy investment inference as a structured fact;
          // its long narrative remains in the authoritative edge and selected evidence.
          if (investmentTie({ evidence: [ev] }) && ev.tie?.kind !== 'investor_founder') {
            normalized.push({ note: '', tie: { kind: 'investor_founder', lastInteraction: ev.tie?.lastInteraction } });
          }
          return normalized;
        });
        edges.push({ edgeId: edge.edgeId, kind: edge.kind, tier: edge.tier, evidence,
          basisHashes: [...new Set(edge.evidence.map((ev) => createHash('sha256').update(ev.note).digest('hex')))] });
      }
      return index;
    }),
    });
  }
  const routes = search.routes.filter((r) => r.foldedUnder == null).map((r) => ({ ...r, foldedUnder: null }));
  return { ...search, routes, topRoutes: routes, graph: routeGraph(routes, search.targetId, true),
    structural: { nodes, edges, candidates, roles: Object.fromEntries(roles) } };
}

/** Match research evidence exactly without retaining hidden candidates' narrative text. */
export function promotedBasisHashes(routes: Route[]): string[] {
  const notes = new Set<string>();
  for (const route of routes) if (route.verdict === 'recommend' || route.verdict === 'hold') {
    for (const hop of route.hops) for (const evidence of hop.edge.evidence) notes.add(evidence.note);
  }
  return [...notes].map((note) => createHash('sha256').update(note).digest('hex')).sort();
}

const key = (r: Route) => [r.fromEntity ?? '', ...r.hops.map((h) => `${h.toEntity}:${h.edge.edgeId}`)].join('|');
const rank: Record<RouteVerdict, number> = { recommend: 0, hold: 1, not_a_route: 2, excluded: 3 };
const tiers = { A: 0, B: 1, C: 2, D: 3 } as const;

/** Bound uninterrupted sorting work as well as scoring; route identity keys are computed once. */
export interface RouteSelectionOptions {
  vehicleId?: string;
  exclude?: string;
  minimumWarmth?: number;
  /** A preference affects presentation order, never the action verdict or score. */
  preferred?: (route: Route) => boolean;
}

export async function sortRouteCandidates(routes: Route[], preferred?: (route: Route) => boolean): Promise<Route[]> {
  const keys = new Map(routes.map((route) => [route, key(route)]));
  const preferences = preferred ? new Map(routes.map((route) => [route, preferred(route)])) : null;
  const compare = (a: Route, b: Route) => (b.score?.value ?? -1) - (a.score?.value ?? -1)
    || rank[a.verdict] - rank[b.verdict] || (preferences ? Number(preferences.get(b)) - Number(preferences.get(a)) : 0)
    || a.hops.length - b.hops.length || keys.get(a)!.localeCompare(keys.get(b)!);
  const checkpoint = routeCheckpoint();
  let runs: Route[][] = [];
  for (let i = 0; i < routes.length; i += 128) {
    runs.push(routes.slice(i, i + 128).sort(compare));
    await checkpoint(i);
  }
  while (runs.length > 1) {
    const next: Route[][] = [];
    for (let k = 0; k < runs.length; k += 2) {
      const a = runs[k]!, b = runs[k + 1];
      if (!b) { next.push(a); continue; }
      const merged: Route[] = [];
      let i = 0, j = 0;
      while (i < a.length && j < b.length) {
        merged.push(compare(a[i]!, b[j]!) <= 0 ? a[i++]! : b[j++]!);
        if (merged.length % 128 === 0) await checkpoint(merged.length);
      }
      while (i < a.length || j < b.length) {
        merged.push(i < a.length ? a[i++]! : b[j++]!);
        if (merged.length % 128 === 0) await checkpoint(merged.length);
      }
      next.push(merged);
    }
    runs = next;
  }
  return runs[0] ?? [];
}
// One derived snapshot per structural object. Weak ownership follows the bounded route
// cache; no full scored candidate list survives a request. Always validate live inputs.
const overlays = new WeakMap<StructuralRoutes, { carriers: string[]; edges: Edge[];
  snapshot?: { ruleCounts: NonNullable<RouteSearch['ruleCounts']>; removedRoutes: NonNullable<RouteSearch['removedRoutes']>; signature: string; routes: Route[]; stats: RouteSearch['stats']; candidateCounts: { total: number; unavailable: number }; promotedBasisHashes: string[] } }>();

const clue: Record<string, string> = {
  possible_identity: 'Possible identity match by name only, without corroboration. These may be different people; this is an uncertain identity bridge, not a relationship.',
  event_coattendee: 'Co-attendance is a discovery clue, not evidence of a relationship. Two people in the same room have not necessarily met.',
  social_public: 'A public social connection proves neither acquaintance nor standing to introduce.',
  podcast_guest: 'Appearing on the same show is proximity, not a relationship.',
  board: 'Shared affiliation only — the record shows no evidence that they ever spoke.',
};

export async function selectDisplayRoutes(candidates: Route[], selection: RouteSelectionOptions, at: Date): Promise<Route[]> {
  const readWarmth = warmthReader(at);
  const matching = candidates.filter((route) => (!selection.exclude || !route.connectorIds.includes(selection.exclude))
    && (!selection.minimumWarmth || Boolean(route.hops.length && readWarmth(route.hops.at(-1)!.edge).score >= selection.minimumWarmth)));
  // Scoring edges are shared compact facts. Preferences that inspect friendship links need
  // actual hop endpoints; provide a transient view without duplicating the normal score cache.
  const preferred = selection.preferred ? (route: Route) => selection.preferred!({ ...route,
    hops: route.hops.map((hop, i) => ({ ...hop, edge: { ...hop.edge,
      fromEntity: i === 0 ? route.fromEntity! : route.hops[i - 1]!.toEntity, toEntity: hop.toEntity,
      fromName: i === 0 ? route.fromName! : route.hops[i - 1]!.toName, toName: hop.toName } })) }) : undefined;
  return selectTopRoutes(await sortRouteCandidates(matching, preferred)).filter((r) => r.foldedUnder == null).map((r) => ({ ...r, foldedUnder: null }));
}

/** Each read uses current target restrictions, connector pressure, money and influence.
 * Reranking and folding happen after the guards, so an excluded prefix never hides a usable one. */
export async function overlayRoutes(search: RouteSearch, vehicleKind: string, at = new Date(), selection: RouteSelectionOptions = {}): Promise<RouteSearch> {
  const structural = search.structural;
  if (!structural) throw new Error('Route cache lacks structural metadata; rebuild the route snapshot.');
  let memo = overlays.get(structural);
  if (!memo) {
    const epoch = new Date(0);
    memo = { carriers: [...new Set(structural.candidates.filter((c) => c.nodes.length > 2)
      .map((c) => structural.nodes[c.nodes.at(-2)!]!.entityId))],
      edges: structural.edges.map((e) => ({ ...e, fromEntity: '', toEntity: '', fromName: '', toName: '',
        strength: null, tieBand: null, reviewedByName: null, reviewedAt: null, reviewNote: null, validFrom: epoch, validTo: null })) };
    overlays.set(structural, memo);
  }
  const { carriers, edges: scoreEdges } = memo;
  const [restrictions, loads, exposures, coverage, sources, policy, identityGroups] = await Promise.all([
    restrictionsFor(search.targetId), connectorLoad(carriers), listExposures(null), edgeCoverage(), listSyncSources(),
    routePolicyFacts([search.targetId, ...structural.nodes.map(n => n.entityId)], selection.vehicleId),
    routeIdentityGroups(structural.nodes.map(n => n.entityId)),
  ]);
  const contactRestrictions = new Map(await Promise.all([...new Set(structural.candidates.flatMap(c => c.viaContact ? [c.viaContact.entityId] : []))]
    .map(async id => [id, await restrictionsFor(id)] as const)));
  const loadOf = new Map(loads.map((l) => [l.connectorId, l.used]));
  const hard = new Map<string, typeof exposures>();
  for (const x of exposures) if (x.track === 'hard' && x.amount > 0) {
    const entries = hard.get(x.entityId) ?? []; entries.push(x); hard.set(x.entityId, entries);
  }
  const roles = new Map<string, RouteScoreContext>();
  for (const carrier of carriers) {
    const base = structural.roles[carrier] ?? {}, money = hard.get(carrier) ?? [];
    roles.set(carrier, { ...base, investor: base.investor || money.length > 0,
      roleEvidenceRefs: money.map((x) => x.evidenceRef ?? `pipeline.exposure:${x.exposureId}`) });
  }
  const blanket = restrictions.find((r) => r.scope === 'blanket');
  const restricted = new Set(restrictions.flatMap((r) => r.connectorId ? [r.connectorId] : []));
  const cap = config.guard.asksPerConnectorPerQuarter;
  const readWarmth = warmthReader(at);
  // Exact derived warmth facts, rather than a time bucket: monthsAgo preserves the
  // time of day, so a dated contact can age immediately after midnight on a boundary.
  const signature = selection.preferred ? null : JSON.stringify([
    Boolean(blanket), [...contactRestrictions], [...restricted].sort(), [...policy.blocked].sort(), [...policy.organizations], selection.vehicleId, config.routePolicy, carriers.map((id) => [id, loadOf.get(id) ?? 0, roles.get(id)]),
    cap, config.routeScoring, config.routeWarmth, selection.exclude ?? null, selection.minimumWarmth ?? 0,
    scoreEdges.map((edge) => { const w = readWarmth(edge); return [w.kind, w.prior, w.score, w.recency]; }),
  ]);
  let snapshot = signature !== null && memo.snapshot?.signature === signature ? memo.snapshot : undefined;
  if (!snapshot) {
    const candidates: Route[] = [];
    const ruleCounts = { ...emptyRuleCounts(), ...search.ruleCounts };
    const removedRoutes: NonNullable<RouteSearch['removedRoutes']> = [];
    const usableEdges = new Set<number>();
    const checkpoint = routeCheckpoint();
    for (const [candidateIndex, candidate] of structural.candidates.entries()) {
      if (candidateIndex % 128 === 0) await checkpoint(candidateIndex);
      const nodes = candidate.nodes.map((i) => structural.nodes[i]!);
      const connectorIds = nodes.slice(1, -1).map((n) => n.entityId), carrier = connectorIds.at(-1);
      const restrictedMiddle = nodes.slice(0, candidate.viaContact ? undefined : -1).some(n => policy.blocked.has(n.entityId));
      const largeMiddle = connectorIds.some(id => policy.organizations.has(id) && oversizedOrganization(policy.organizations.get(id)!));
      if (restrictedMiddle || largeMiddle) {
        if (restrictedMiddle) ruleCounts.restricted++; else ruleCounts.largeOrganizations++;
        removedRoutes.push({ fromName: nodes[0]!.name, names: nodes.slice(1).map(n => n.name),
          reason: restrictedMiddle ? 'restricted' : 'large_organization' });
        continue;
      }
      const hops = candidate.edges.map((e, i) => ({ edge: scoreEdges[e]!, toEntity: nodes[i + 1]!.entityId, toName: nodes[i + 1]!.name }));
      const askLoad = carrier ? { connector: nodes.at(-2)!.name, used: loadOf.get(carrier) ?? 0, cap } : null;
      const contactBlocked = (contactRestrictions.get(candidate.viaContact?.entityId ?? '') ?? []).some(r => r.scope === 'blanket' || (r.connectorId && [nodes[0]!.entityId, ...connectorIds].includes(r.connectorId)));
      const excluded = blanket || contactBlocked || policy.blocked.has(search.targetId) || [nodes[0]!.entityId, ...connectorIds, ...(candidate.viaContact ? [candidate.viaContact.entityId] : [])].some((id) => restricted.has(id));
      if (!excluded) for (const edgeIndex of candidate.edges) usableEdges.add(edgeIndex);
      const route: Route = { ...(candidate.viaContact ? { viaContact: candidate.viaContact } : {}), identityGroups: Object.fromEntries(nodes.map(n => [n.entityId, identityGroups.get(n.entityId) ?? n.entityId])), fromEntity: nodes[0]!.entityId, fromName: nodes[0]!.name, hops, connectorIds,
        connectorNames: nodes.slice(1, -1).map((n) => n.name), verdict: excluded ? 'excluded' : askLoad && askLoad.used >= cap ? 'hold' : 'recommend',
        reasons: [], askLoad, influence: null,
        weakestTier: hops.reduce<Edge['tier']>((tier, h) => tiers[h.edge.tier] > tiers[tier] ? h.edge.tier : tier, 'A') };
      // Factors are reconstructed only for visible routes; candidate ranking needs numbers.
      const baseScore = scoreRoute(route, at, roles.get(carrier ?? ''), readWarmth);
      const score = organizationPenalty(baseScore, route, policy.organizations);
      if (score.value < baseScore.value) ruleCounts.organizationPenalties++;
      route.score = { ...score, factors: [] };
      candidates.push(route);
    }
    snapshot = { ruleCounts, removedRoutes, signature: signature ?? '', stats: summarizeRoutes(candidates),
      candidateCounts: { total: candidates.length, unavailable: candidates.filter((r) => r.verdict !== 'recommend').length },
      promotedBasisHashes: [...new Set([...usableEdges].flatMap((i) => structural.edges[i]!.basisHashes))].sort(),
      routes: await selectDisplayRoutes(candidates, selection, at) };
    if (signature !== null) memo.snapshot = snapshot;
  }
  // Hydration and explanations are request-local; neither caller mutation nor live
  // influence may change the saved selection or its source structural snapshot.
  const stats = { ...snapshot.stats!, counts: { ...snapshot.stats!.counts }, bestRouteCounts: { ...snapshot.stats!.bestRouteCounts } };
  const selected: Route[] = snapshot.routes.map((route) => ({ ...route, reasons: [],
    connectorIds: [...route.connectorIds], connectorNames: [...route.connectorNames],
    askLoad: route.askLoad ? { ...route.askLoad } : null }));
  const fullEdges = new Map(search.routes.flatMap((r) => r.hops.map((h) => [h.edge.edgeId, h.edge] as const)));
  const missing = [...new Set(selected.flatMap((r) => r.hops.map((h) => h.edge.edgeId)))].filter((id) => !fullEdges.has(id));
  const selectedCarriers = [...new Set(selected.flatMap((r) => r.connectorIds.at(-1) ? [r.connectorIds.at(-1)!] : []))];
  const [loaded, influences] = await Promise.all([
    edgesByIds(missing), selectedCarriers.length ? influenceFor(selectedCarriers, search.targetId, vehicleKind) : Promise.resolve(new Map()),
  ]);
  for (const [id, edge] of loaded) fullEdges.set(id, edge);
  for (const route of selected) {
    route.identityGroups = Object.fromEntries([route.fromEntity!, ...route.hops.map(h => h.toEntity)].map(id => [id, identityGroups.get(id) ?? id]));
    route.hops = route.hops.map((h) => {
      const edge = fullEdges.get(h.edge.edgeId);
      if (!edge) throw new Error('Route evidence changed while applying live guards; retry with the current network build.');
      return { ...h, edge };
    });
    const carrier = route.connectorIds.at(-1);
    route.score = organizationPenalty(scoreRoute(route, at, roles.get(carrier ?? ''), readWarmth), route, policy.organizations);
    route.influence = carrier ? influences.get(carrier) ?? null : null;
    if (route.viaContact) route.reasons.push(`Via ${route.viaContact.role}: ${route.viaContact.name} speaks for ${search.targetName}. The relationship tier is unchanged.`);
    const contactBlocked = (contactRestrictions.get(route.viaContact?.entityId ?? '') ?? []).some(r => r.scope === 'blanket' || (r.connectorId && [route.fromEntity!, ...route.connectorIds].includes(r.connectorId)));
    if (blanket || contactBlocked || policy.blocked.has(search.targetId)) route.reasons.push(contactBlocked
      ? `A restriction on ${route.viaContact?.name ?? 'this contact'} excludes this approach.`
      : `${search.targetName} asked not to be approached at all: ${blanket?.instruction ?? 'A do-not-contact instruction applies in this vehicle.'}`);
    else {
      const hit = [route.fromEntity!, ...route.connectorIds, ...(route.viaContact ? [route.viaContact.entityId] : [])].find((id) => restricted.has(id));
      if (hit) route.reasons.push(`${restrictions.find((r) => r.connectorId === hit)?.instruction ?? 'A restriction applies to this route.'} `
        + 'This path is excluded, and finding a different connector toward the same approach does not satisfy the instruction.');
    }
    for (const h of route.hops.filter((h) => h.edge.tier === 'C' || h.edge.tier === 'D')) {
      route.reasons.push(`${route.hops.indexOf(h) === 0 ? route.fromName : route.hops[route.hops.indexOf(h) - 1]!.toName} → ${h.toName}: tier ${h.edge.tier}. `
        + (clue[h.edge.kind] ?? 'Weak relationship evidence; interaction is not established.')
        + ' Routes with uncertainty; confidence discounts the investment-route score.');
    }
    if (route.verdict === 'hold' && route.askLoad) route.reasons.push(`${route.askLoad.connector} has used ${route.askLoad.used} of ${cap} asks this quarter. `
      + 'The cap is on the connector because goodwill is the resource you cannot buy back.');
    if (route.verdict === 'recommend') {
      const reviewed = route.hops.filter((h) => h.edge.reviewedByName).length;
      route.reasons.push(`Every hop is tier ${route.weakestTier} or better${route.weakestTier <= 'B' ? ', with a documented or policy-based tie' : '; the route carries weaker evidence'}`
        + (reviewed > 0 ? ` and ${reviewed} hop${reviewed === 1 ? '' : 's'} confirmed by a person.` : '.')
        + (route.askLoad && route.askLoad.used > 0 ? ` ${route.askLoad.connector} has goodwill left: ${cap - route.askLoad.used} of ${cap} asks unused this quarter.` : ''));
    }
  }
  const { structural: _internal, ...publicSearch } = search;
  return { ...publicSearch, ruleCounts: { ...snapshot.ruleCounts }, removedRoutes: snapshot.removedRoutes.map(r => ({ ...r, names: [...r.names] })), routes: selected, topRoutes: selected.filter((r) => r.verdict === 'recommend'),
    graph: routeGraph(selected, search.targetId, true), stats, candidateCounts: { ...snapshot.candidateCounts }, promotedBasisHashes: [...snapshot.promotedBasisHashes],
    coverage: { edges: coverage.edges, from: coverage.from, to: coverage.to, maxHops: search.coverage.maxHops,
      notInspected: [...sources.filter((s) => s.status === 'not_connected').map((s) => ({ source: s.label, why: s.detail ?? 'not connected' })),
        { source: 'Longer and overflow paths', why: `Search inspects up to ${search.coverage.maxHops} hops and 300 candidate paths per source and LP/contact endpoint; best means best among inspected routes.` }] },
    restrictions: restrictions.map((r) => ({ instruction: r.instruction, connectorName: r.connectorName, source: r.source })) };
}
