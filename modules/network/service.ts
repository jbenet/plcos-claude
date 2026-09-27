import { cachedRoutes } from './cache';
import { promotedBasisHashes, compactStructuralRoutes, overlayRoutes, routeCheckpoint, selectDisplayRoutes, sortRouteCandidates, type RouteSelectionOptions } from './route-overlay';
import { setImmediate } from 'node:timers/promises';
import { config } from '@/config/deployment';
import { listEntities } from '@/modules/identity';
import { connectorLoad, restrictionsFor } from '@/modules/coordination';
import { listSyncSources } from '@/modules/platform';
import { listExposures } from '@/modules/pipeline';
import { canonicalRouteEntity, edgeCoverage, edgesByIds, entityForUser, enumeratePathsFromSources, routeSources, sourceEdges } from './repo';
import { influenceFor } from './influence';
import { investmentTie, scoreRoute, tieDetailsProblems, warmthReader, type RouteScoreContext } from './warmth';
import { CLUE_KINDS, type Edge, type Route, type RouteHop, type RouteSearch, type RouteVerdict, type RouteStats, type RouteGraph } from './types';

const TIER_ORDER = { A: 0, B: 1, C: 2, D: 3 } as const;

const CLUE_REASON: Record<string, string> = {
  possible_identity: 'Possible identity match by name only, without corroboration. These may be different people; this is an uncertain identity bridge, not a relationship.',
  event_coattendee:
    'Co-attendance is a discovery clue, not evidence of a relationship. Two people in the same room have not necessarily met.',
  social_public:
    'A public social connection proves neither acquaintance nor standing to introduce.',
  podcast_guest: 'Appearing on the same show is proximity, not a relationship.',
  board: 'Shared affiliation only — the record shows no evidence that they ever spoke.',
};

/**
 * Rank the routes from a member of the team to a target.
 *
 * Three rules are enforced here rather than left to the ranking:
 *  - Team members are sources, never intermediaries.
 *  - C and D hops route with uncertainty reflected in score confidence.
 *  - A restriction on the target excludes every path through the restricted party, and
 *    the exclusion is reported rather than silently dropped.
 */
export async function planRoutes(
  fromHandle: string, targetId: string, maxHops = 3, vehicleKind = 'fund', scope: 'current' | 'team' = 'current', at?: Date,
  selection: RouteSelectionOptions = {},
): Promise<RouteSearch | null> {
  targetId = await canonicalRouteEntity(targetId);
  // Explicit historical evaluations and nonstandard searches are never served a build snapshot.
  if (scope === 'team' && maxHops === 3 && !at) {
    const structural = await cachedRoutes(targetId, vehicleKind, () => computeStructuralRoutes(fromHandle, targetId, maxHops, vehicleKind, scope));
    return structural ? overlayRoutes(structural, vehicleKind, new Date(), selection) : null;
  }
  const live = await planRoutesLive(fromHandle, targetId, maxHops, vehicleKind, scope, at);
  if (!live || !(selection.exclude || selection.minimumWarmth || selection.preferred)) return live;
  const routes = await selectDisplayRoutes(live.routes, selection, at ?? new Date());
  return { ...live, routes, topRoutes: routes.filter((r) => r.verdict === 'recommend'), graph: routeGraph(routes, targetId, true) };
}

export async function planRoutesLive(
  fromHandle: string, targetId: string, maxHops = 3, vehicleKind = 'fund', scope: 'current' | 'team' = 'current', at = new Date(),
): Promise<RouteSearch | null> {
  return calculateRoutes(fromHandle, targetId, maxHops, vehicleKind, scope, at, false);
}

/** Build-only paths and network scoring. Mutable action guards and money are overlaid on read. */
export async function computeStructuralRoutes(
  fromHandle: string, targetId: string, maxHops = 3, vehicleKind = 'fund', scope: 'current' | 'team' = 'team', at = new Date(),
): Promise<RouteSearch | null> {
  return calculateRoutes(fromHandle, targetId, maxHops, vehicleKind, scope, at, true);
}

async function calculateRoutes(
  fromHandle: string, targetId: string, maxHops: number, vehicleKind: string, scope: 'current' | 'team', at: Date, structuralOnly: boolean,
): Promise<RouteSearch | null> {
  targetId = await canonicalRouteEntity(targetId);
  const checkpoint = routeCheckpoint();
  const me = await entityForUser(fromHandle);
  const team = await routeSources();
  const onlySources = team.filter(s => s.sourceOnly).map(s => s.entityId);
  const currentSource = me ? { ...me, sourceOnly: onlySources.includes(me.entityId) } : null;
  const fromSources = scope === 'team' ? team : currentSource ? [currentSource] : [];
  const sourceIds = new Set(team.map((s) => s.entityId));
  if (!fromSources.length) return null;

  const [rawPaths, restrictions, coverage, sources] = await Promise.all([
    enumeratePathsFromSources(fromSources.map((s) => s.entityId).filter((id) => id !== targetId), targetId, maxHops, scope === 'team' ? [...sourceIds] : []),
    structuralOnly ? Promise.resolve([]) : restrictionsFor(targetId),
    edgeCoverage(),
    listSyncSources(),
  ]);
  const sourceOf = new Map([...team, ...fromSources].map((s) => [s.entityId, s]));
  // In current-user scope a team prefix transfers the source to its last team member.
  // In team scope SQL already prevents these paths before they spend the candidate budget.
  const paths: Array<typeof rawPaths[number] & { source: typeof team[number] }> = [];
  for (const [index, p] of rawPaths.entries()) {
    if (index % 128 === 0) await checkpoint(index);
    if (sourceIds.has(targetId)) continue;
    let start = 0;
    if (!onlySources.includes(p.nodes[0]!)) for (let i = 1; i < p.nodes.length - 1; i++) if (sourceIds.has(p.nodes[i]!)) start = i;
    paths.push({ ...p, nodes: p.nodes.slice(start), edges: p.edges.slice(start),
      hops: p.hops - start, source: sourceOf.get(p.nodes[start]!)! });
  }
  const nodeSet = new Set([targetId]), edgeSet = new Set<string>(), carrierSet = new Set<string>();
  for (const [index, path] of paths.entries()) {
    for (const node of path.nodes) nodeSet.add(node);
    for (const edge of path.edges) edgeSet.add(edge);
    if (path.nodes.length > 2) carrierSet.add(path.nodes.at(-2)!);
    if (index % 128 === 0) await checkpoint(index);
  }
  const nodeIds = [...nodeSet], allEdgeIds = [...edgeSet], carrierIds = [...carrierSet];
  const loadEntities = async () => {
    const out: Awaited<ReturnType<typeof listEntities>> = [];
    for (let i = 0; i < nodeIds.length; i += 256) {
      out.push(...await listEntities(nodeIds.slice(i, i + 256)));
      await setImmediate();
    }
    return out;
  };
  const [entities, edgeMap, loads] = await Promise.all([
    loadEntities(), edgesByIds(allEdgeIds), structuralOnly ? Promise.resolve([]) : connectorLoad(carrierIds),
  ]);
  const nameOf = new Map(entities.map((e) => [e.entityId, e.displayName]));
  const targetName = nameOf.get(targetId) ?? 'Unknown';
  const loadOf = new Map(loads.map((l) => [l.connectorId, l.used]));
  const cap = config.guard.asksPerConnectorPerQuarter;
  const blanket = restrictions.find((r) => r.scope === 'blanket');
  const restrictedConnectors = new Set(
    restrictions.filter((r) => r.connectorId).map((r) => r.connectorId as string),
  );

  const routes: Route[] = [];
  const seen = new Set<string>();

  for (const [index, p] of paths.entries()) {
    if (index % 128 === 0) await checkpoint(index);
    const key = `${p.nodes[0]}:${p.edges.join('>')}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const hops: RouteHop[] = [];
    let broken = false;
    for (let i = 0; i < p.edges.length; i += 1) {
      const edge = edgeMap.get(p.edges[i]!);
      const toEntity = p.nodes[i + 1]!;
      if (!edge) { broken = true; break; }
      hops.push({ edge, toEntity, toName: nameOf.get(toEntity) ?? 'Unknown' });
    }
    if (broken || hops.length === 0) continue;

    const connectorIds = p.nodes.slice(1, -1);
    const connectorNames = connectorIds.map((id) => nameOf.get(id) ?? 'Unknown');
    const weakestTier = hops.reduce<Edge['tier']>(
      (worst, h) => (TIER_ORDER[h.edge.tier] > TIER_ORDER[worst] ? h.edge.tier : worst),
      'A',
    );

    const reasons: string[] = [];
    let verdict: RouteVerdict = 'recommend';

    // Rule 8. The restriction attaches to the target and every candidate path is checked.
    if (blanket) {
      verdict = 'excluded';
      reasons.push(`${targetName} asked not to be approached at all: ${blanket.instruction}`);
    } else {
      const hit = [p.source.entityId, ...connectorIds].find((id) => restrictedConnectors.has(id));
      if (hit) {
        const r = restrictions.find((x) => x.connectorId === hit);
        verdict = 'excluded';
        reasons.push(
          `${r?.instruction ?? 'A restriction applies to this route.'} ` +
          'This path is excluded, and finding a different connector toward the same approach ' +
          'does not satisfy the instruction.',
        );
      }
    }

    // Tiers describe uncertainty, never a human information gate (rule 6).
    for (const h of hops.filter((h) => h.edge.tier === 'C' || h.edge.tier === 'D')) {
      reasons.push(`${hops.indexOf(h) === 0 ? p.source.name : hops[hops.indexOf(h) - 1]!.toName} → ${h.toName}: tier ${h.edge.tier}. ` +
        (CLUE_REASON[h.edge.kind] ?? 'Weak relationship evidence; interaction is not established.') +
        ' Routes with uncertainty; confidence discounts the investment-route score.');
    }

    // Connector goodwill: the load cap is on the connector because that is the scarcer resource.
    const lastConnector = connectorIds[connectorIds.length - 1];
    const askLoad = lastConnector
      ? {
          connector: nameOf.get(lastConnector) ?? 'Unknown',
          used: loadOf.get(lastConnector) ?? 0,
          cap,
        }
      : null;
    if (askLoad && askLoad.used >= cap && verdict === 'recommend') {
      verdict = 'hold';
      reasons.push(
        `${askLoad.connector} has used ${askLoad.used} of ${cap} asks this quarter. ` +
        'The cap is on the connector because goodwill is the resource you cannot buy back.',
      );
    }

    if (verdict === 'recommend') {
      const reviewed = hops.filter((h) => h.edge.reviewedByName).length;
      reasons.push(
        `Every hop is tier ${weakestTier} or better${weakestTier <= 'B' ? ', with a documented or policy-based tie' : '; the route carries weaker evidence'}` +
        (reviewed > 0 ? ` and ${reviewed} hop${reviewed === 1 ? '' : 's'} confirmed by a person.` : '.') +
        (askLoad && askLoad.used > 0
          ? ` ${askLoad.connector} has goodwill left: ${cap - askLoad.used} of ${cap} asks unused this quarter.`
          : ''),
      );
    }

    routes.push({
      fromEntity: p.source.entityId, fromName: p.source.name,
      hops, connectorNames, connectorIds, verdict, reasons, weakestTier, askLoad,
      influence: null,
    });
  }

  /**
   * Influence is scored after the rules, on the connector who actually carries the ask —
   * the last one before the target. Scoring it first would let a well-connected name
   * promote a path a restriction excludes.
   */
  const carriers = [...new Set(
    routes.map((r) => r.connectorIds[r.connectorIds.length - 1]).filter(Boolean) as string[],
  )];
  if (!structuralOnly && carriers.length > 0) {
    const influence = await influenceFor(carriers, targetId, vehicleKind);
    for (const r of routes) {
      const carrier = r.connectorIds[r.connectorIds.length - 1];
      r.influence = carrier ? influence.get(carrier) ?? null : null;
    }
  }

  const [roles, exposures] = await Promise.all([sourceEdges([...sourceIds], carriers), structuralOnly ? Promise.resolve([]) : listExposures(null)]);
  const roleOf = new Map<string, RouteScoreContext>();
  const edgesForCarrier = new Map<string, Edge[]>();
  for (const edge of roles) for (const id of new Set([edge.fromEntity, edge.toEntity])) {
    const list = edgesForCarrier.get(id) ?? []; list.push(edge); edgesForCarrier.set(id, list);
  }
  const hardForCarrier = new Map<string, typeof exposures>();
  for (const exposure of exposures) if (exposure.track === 'hard' && exposure.amount > 0) {
    const list = hardForCarrier.get(exposure.entityId) ?? []; list.push(exposure); hardForCarrier.set(exposure.entityId, list);
  }
  for (const [index, id] of carriers.entries()) {
    if (index % 128 === 0) await checkpoint(index);
    const evidence = edgesForCarrier.get(id) ?? [];
    const investorEdges = evidence.filter((e) => investmentTie(e) || e.evidence.some((x) => x.tie?.withUs === 'investor' && !tieDetailsProblems(x.tie).length));
    const founderEdges = evidence.filter((e) => e.evidence.some((x) => x.tie?.withUs === 'pl_founder' && !tieDetailsProblems(x.tie).length));
    const hard = hardForCarrier.get(id) ?? [];
    roleOf.set(id, { investor: investorEdges.length > 0 || hard.length > 0,
      plFounder: founderEdges.length > 0, roleEdgeIds: [...investorEdges, ...founderEdges].map((e) => e.edgeId),
      roleEvidenceRefs: hard.map((e) => e.evidenceRef ?? `pipeline.exposure:${e.exposureId}`) });
  }
  const readWarmth = warmthReader(at);
  for (const [index, route] of routes.entries()) {
    route.score = scoreRoute(route, at, roleOf.get(route.connectorIds.at(-1) ?? ''), readWarmth);
    if (index % 128 === 0) await checkpoint(index);
  }
  const selected = selectTopRoutes(await sortRouteCandidates(routes));

  const search: RouteSearch = {
    targetId,
    targetName,
    fromName: scope === 'team' ? 'Team / PL' : me!.name,
    routes: selected,
    topRoutes: selected.filter((r) => r.foldedUnder == null && r.verdict === 'recommend'),
    graph: routeGraph(selected, targetId, true),
    stats: summarizeRoutes(selected),
    ...(structuralOnly ? {} : { promotedBasisHashes: promotedBasisHashes(selected),
      candidateCounts: { total: selected.length, unavailable: selected.filter((r) => r.verdict !== 'recommend').length } }),
    coverage: {
      edges: coverage.edges,
      maxHops,
      from: coverage.from,
      to: coverage.to,
      notInspected: [
        ...sources.filter((s) => s.status === 'not_connected')
          .map((s) => ({ source: s.label, why: s.detail ?? 'not connected' })),
        { source: 'Longer and overflow paths', why: `Search inspects up to ${maxHops} hops and 300 candidate paths per source; best means best among inspected routes.` },
      ],
    },
    restrictions: restrictions.map((r) => ({
      instruction: r.instruction,
      connectorName: r.connectorName,
      source: r.source,
    })),
  };
  return structuralOnly ? compactStructuralRoutes(search, roleOf) : search;
}

export { CLUE_KINDS };


const chainKey = (r: Route) => [r.fromEntity ?? '', ...r.hops.map((h) => h.toEntity)].join('|');

/** Input is ranked. Keep up to three prefixes per last intermediary, with no cap on
 * distinct intermediaries or direct sources. Every evidence alternative stays in the data.
 * foldedUnder points to that group's best visible route for show-more consumers.
 */
export function selectTopRoutes(routes: Route[]): Route[] {
  const out = routes.map((r) => ({ ...r, foldedUnder: null as number | null }));
  const first = new Map<string, number>();
  const groups = new Map<string, number[]>();
  for (const [i, route] of out.entries()) {
    const chain = `${route.verdict}:${chainKey(route)}`;
    const prior = first.get(chain);
    if (prior !== undefined) { route.foldedUnder = out[prior]!.foldedUnder ?? prior; continue; }
    first.set(chain, i);
    const carrier = route.hops.length > 1 ? route.hops.at(-2)!.toEntity : null;
    if (!carrier) continue;
    // Preserve action classes separately: a held/restricted route cannot hide a usable route.
    const groupKey = `${route.verdict}:${carrier}`;
    const visible = groups.get(groupKey) ?? [];
    if (visible.length < config.routeScoring.routesPerIntroducer) visible.push(i);
    else route.foldedUnder = visible[0]!;
    groups.set(groupKey, visible);
  }
  return out;
}

/** Graph identity is the entity, independent of how many routes/evidence records reach it. */
export function routeGraph(routes: Route[], targetId: string, visibleOnly = false): RouteGraph {
  const nodes = new Map<string, RouteGraph['nodes'][number]>();
  const links = new Map<string, RouteGraph['links'][number]>();
  for (const [index, route] of routes.entries()) {
    if (visibleOnly && (route.foldedUnder != null || route.verdict !== 'recommend')) continue;
    let from = route.fromEntity;
    if (!from) continue;
    const existing = nodes.get(from);
    nodes.set(from, { entityId: from, name: route.fromName ?? existing?.name ?? 'Unknown', source: true, target: from === targetId });
    for (const hop of route.hops) {
      if (!nodes.has(hop.toEntity)) nodes.set(hop.toEntity, { entityId: hop.toEntity, name: hop.toName, source: false, target: hop.toEntity === targetId });
      const key = `${from}|${hop.toEntity}`;
      const link = links.get(key) ?? { fromEntity: from, toEntity: hop.toEntity, edgeIds: [], routeIndices: [] };
      if (!link.edgeIds.includes(hop.edge.edgeId)) link.edgeIds.push(hop.edge.edgeId);
      if (!link.routeIndices.includes(index)) link.routeIndices.push(index);
      links.set(key, link);
      from = hop.toEntity;
    }
  }
  return { nodes: [...nodes.values()], links: [...links.values()] };
}

/** Counts distinct usable person chains, not parallel evidence or held/restricted approaches. */
export function summarizeRoutes(routes: Route[]): RouteStats {
  return summarizePipelineRoutes([{ targetId: 'target', routes }]);
}

/** Call with all pipeline targets, including empty searches. Repeated vehicle targets count once. */
export function summarizePipelineRoutes(searches: Array<Pick<RouteSearch, 'targetId' | 'routes'>>): RouteStats {
  const targets = new Map<string, Map<string, Route>>();
  for (const search of searches) {
    const routes = targets.get(search.targetId) ?? new Map<string, Route>();
    targets.set(search.targetId, routes);
    for (const route of search.routes) {
      if (route.verdict !== 'recommend' || !route.score) continue;
      const key = chainKey(route), prior = routes.get(key);
      if (!prior || route.score.value > prior.score!.value) routes.set(key, route);
    }
  }
  const counts = { strong: 0, warm: 0, weak: 0 };
  const bestRouteCounts = { strong: 0, warm: 0, weak: 0, unavailable: 0 };
  let bestScore: number | null = null;
  for (const routes of targets.values()) {
    let best: Route | undefined;
    for (const route of routes.values()) {
      counts[route.score!.band]++;
      if (!best || route.score!.value > best.score!.value) best = route;
    }
    if (!best) bestRouteCounts.unavailable++;
    else {
      bestRouteCounts[best.score!.band]++;
      bestScore = Math.max(bestScore ?? 0, best.score!.value);
    }
  }
  const strongTargets = bestRouteCounts.strong;
  return { targetCount: targets.size, routeCount: Object.values(counts).reduce((a, b) => a + b, 0), counts, bestRouteCounts,
    bestScore, strongTargets,
    confidenceStatement: `${strongTargets} ${strongTargets === 1 ? 'target has' : 'targets have'} at least one strong route in the inspected evidence. Scores are uncalibrated estimates; held and restricted routes are excluded.` };
}
