import { config } from '@/config/deployment';
import { listEntities } from '@/modules/identity';
import { connectorLoad, restrictionsFor } from '@/modules/coordination';
import { listSyncSources } from '@/modules/platform';
import { edgeCoverage, edgesByIds, entityForUser, enumeratePathsFromSources, routeSources } from './repo';
import { influenceFor } from './influence';
import { foldRoutes, warmthReader } from './warmth';
import { CLUE_KINDS, type Edge, type Route, type RouteHop, type RouteSearch, type RouteVerdict } from './types';

const TIER_ORDER = { A: 0, B: 1, C: 2, D: 3 } as const;

const CLUE_REASON: Record<string, string> = {
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
 *  - A route is only as good as its worst hop.
 *  - C and D hops route with their uncertainty labelled and ranked.
 *  - A restriction on the target excludes every path through the restricted party, and
 *    the exclusion is reported rather than silently dropped.
 */
export async function planRoutes(
  fromHandle: string, targetId: string, maxHops = 3, vehicleKind = 'fund', scope: 'current' | 'team' = 'current',
): Promise<RouteSearch | null> {
  const me = await entityForUser(fromHandle);
  const fromSources = scope === 'team' ? await routeSources() : me ? [me] : [];
  if (!fromSources.length) return null;

  const [rawPaths, restrictions, coverage, sources] = await Promise.all([
    enumeratePathsFromSources(fromSources.map((s) => s.entityId).filter((id) => id !== targetId), targetId, maxHops),
    restrictionsFor(targetId),
    edgeCoverage(),
    listSyncSources(),
  ]);
  const sourceOf = new Map(fromSources.map((s) => [s.entityId, s]));
  const paths = rawPaths.map((p) => ({ ...p, source: sourceOf.get(p.nodes[0]!)! }));
  const nodeIds = [...new Set([targetId, ...paths.flatMap((p) => p.nodes)])];
  const allEdgeIds = [...new Set(paths.flatMap((p) => p.edges))];
  const carrierIds = [...new Set(paths.flatMap((p) => p.nodes.slice(1, -1).slice(-1)))];
  const [entities, edgeMap, loads] = await Promise.all([
    listEntities(nodeIds), edgesByIds(allEdgeIds), connectorLoad(carrierIds),
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

  for (const p of paths) {
    const key = p.edges.join('>');
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
      const hit = connectorIds.find((id) => restrictedConnectors.has(id));
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
      reasons.push(`${h.edge.fromName} → ${h.edge.toName}: tier ${h.edge.tier}. ` +
        (CLUE_REASON[h.edge.kind] ?? 'Weak relationship evidence; interaction is not established.') +
        ' Routes with uncertainty; stronger evidence ranks first.');
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
  if (carriers.length > 0) {
    const influence = await influenceFor(carriers, targetId, vehicleKind);
    for (const r of routes) {
      const carrier = r.connectorIds[r.connectorIds.length - 1];
      r.influence = carrier ? influence.get(carrier) ?? null : null;
    }
  }

  const at = new Date();
  const rank: Record<RouteVerdict, number> = { recommend: 0, hold: 1, not_a_route: 2, excluded: 3 };
  const readWarmth = warmthReader(at);
  const warmth = new Map(routes.map((r) => [r, r.hops.length ? Math.min(...r.hops.map((h) => readWarmth(h.edge).score)) : 0]));
  routes.sort(
    (a, b) =>
      Number(a.verdict === 'excluded') - Number(b.verdict === 'excluded') ||
      TIER_ORDER[a.weakestTier] - TIER_ORDER[b.weakestTier] ||
      warmth.get(b)! - warmth.get(a)! ||
      rank[a.verdict] - rank[b.verdict] ||
      (b.influence?.score ?? 0) - (a.influence?.score ?? 0) ||
      a.hops.length - b.hops.length ||
      a.hops.map((h) => h.edge.edgeId).join('|').localeCompare(b.hops.map((h) => h.edge.edgeId).join('|')),
  );

  return {
    targetId,
    targetName,
    fromName: scope === 'team' ? 'Team / PL' : me!.name,
    routes: foldRoutes(routes, at, readWarmth),
    coverage: {
      edges: coverage.edges,
      maxHops,
      from: coverage.from,
      to: coverage.to,
      notInspected: sources
        .filter((s) => s.status === 'not_connected')
        .map((s) => ({ source: s.label, why: s.detail ?? 'not connected' })),
    },
    restrictions: restrictions.map((r) => ({
      instruction: r.instruction,
      connectorName: r.connectorName,
      source: r.source,
    })),
  };
}

export { CLUE_KINDS };
