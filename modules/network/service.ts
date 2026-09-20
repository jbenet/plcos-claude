import { config } from '@/config/deployment';
import { listEntities } from '@/modules/identity';
import { connectorLoad, restrictionsFor } from '@/modules/coordination';
import { listSyncSources } from '@/modules/platform';
import { edgeCoverage, edgesByIds, entityForUser, enumeratePaths } from './repo';
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
 *  - A C or D hop that no human has reviewed cannot carry a route at all.
 *  - A restriction on the target excludes every path through the restricted party, and
 *    the exclusion is reported rather than silently dropped.
 */
export async function planRoutes(
  fromHandle: string, targetId: string, maxHops = 3,
): Promise<RouteSearch | null> {
  const me = await entityForUser(fromHandle);
  if (!me) return null;

  const [paths, entities, restrictions, loads, coverage, sources] = await Promise.all([
    enumeratePaths(me.entityId, targetId, maxHops),
    listEntities(),
    restrictionsFor(targetId),
    connectorLoad(),
    edgeCoverage(),
    listSyncSources(),
  ]);

  const nameOf = new Map(entities.map((e) => [e.entityId, e.displayName]));
  const targetName = nameOf.get(targetId) ?? 'Unknown';
  const allEdgeIds = [...new Set(paths.flatMap((p) => p.edges))];
  const edgeMap = await edgesByIds(allEdgeIds);
  const loadOf = new Map(loads.map((l) => [l.connectorId, l.used]));
  const cap = config.guard.asksPerConnectorPerQuarter;
  const blanket = restrictions.find((r) => r.scope === 'blanket');
  const restrictedConnectors = new Set(
    restrictions.filter((r) => r.connectorId).map((r) => r.connectorId as string),
  );

  const routes: Route[] = [];
  const seen = new Set<string>();

  for (const p of paths) {
    const key = p.nodes.join('>');
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

    // A C or D hop nobody has reviewed cannot carry a route.
    const unreviewed = hops.filter(
      (h) => (h.edge.tier === 'C' || h.edge.tier === 'D') && !h.edge.reviewedByName,
    );
    if (verdict !== 'excluded' && unreviewed.length > 0) {
      verdict = 'not_a_route';
      for (const h of unreviewed) {
        reasons.push(
          `${h.edge.fromName} → ${h.edge.toName} is tier ${h.edge.tier} and no one has confirmed it. ` +
          (CLUE_REASON[h.edge.kind] ?? 'Shared affiliation is not evidence of a relationship.'),
        );
      }
    }

    // A reviewed C or D hop becomes usable, not good. Human review removes the refusal; it
    // does not upgrade the evidence, and a route is only as good as its worst hop.
    if (verdict === 'recommend' && (weakestTier === 'C' || weakestTier === 'D')) {
      verdict = 'hold';
      const weak = hops.find((h) => h.edge.tier === weakestTier);
      reasons.push(
        `The weakest hop is tier ${weakestTier}${weak ? ` (${weak.edge.fromName} → ${weak.edge.toName})` : ''}. ` +
        'A person has confirmed it, which is what makes it usable at all — but confirming a ' +
        'shared affiliation does not turn it into a working relationship.',
      );
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
        `Every hop is tier ${weakestTier} or better, with interaction evidence on file` +
        (reviewed > 0 ? ` and ${reviewed} hop${reviewed === 1 ? '' : 's'} confirmed by a person.` : '.') +
        (askLoad && askLoad.used > 0
          ? ` ${askLoad.connector} has goodwill left: ${cap - askLoad.used} of ${cap} asks unused this quarter.`
          : ''),
      );
    }

    routes.push({ hops, connectorNames, connectorIds, verdict, reasons, weakestTier, askLoad });
  }

  const rank: Record<RouteVerdict, number> = { recommend: 0, hold: 1, not_a_route: 2, excluded: 3 };
  routes.sort(
    (a, b) =>
      rank[a.verdict] - rank[b.verdict] ||
      a.hops.length - b.hops.length ||
      TIER_ORDER[a.weakestTier] - TIER_ORDER[b.weakestTier],
  );

  return {
    targetId,
    targetName,
    fromName: me.name,
    routes,
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
