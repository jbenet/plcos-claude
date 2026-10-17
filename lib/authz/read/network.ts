import { currentUser } from '@/lib/auth';
import * as raw from '@/modules/network';
import { licensedAccess } from './r3';
export * from '@/modules/network';
const LICENSED = /^dakota/i;
const licensedEvidence = (e: raw.Edge['evidence'][number]) => LICENSED.test(e.source ?? '');
function edgeForDisplay(edge: raw.Edge): raw.Edge {
  return { ...edge, evidence: edge.evidence.map(e => licensedEvidence(e)
    ? { source: 'dakota', as_of: e.as_of, note: 'Licensed evidence restricted.' } : e) };
}
/** A tie whose only evidence is licensed (Dakota): without R3 the tie itself is withheld, not just its words (red team, 17 Oct 2026). */
export function licensedOnlyEdge(edge: Pick<raw.Edge, 'evidence'>): boolean {
  return edge.evidence.length > 0 && edge.evidence.every(licensedEvidence);
}
export type RedactedRouteSearch = raw.RouteSearch & { licensedRoutesWithheld?: number };
/**
 * A route search as a reader without licensed (R3) access sees it: a route with any hop resting only on Dakota evidence
 * is dropped, and counted in licensedRoutesWithheld; the rest are refolded and their graph and counts rebuilt from what
 * is left, so no index, node or count points at a withheld route. Licensed evidence on a mixed hop is redacted.
 */
export function redactLicensedRoutes(search: raw.RouteSearch): RedactedRouteSearch {
  const route = (r: raw.Route): raw.Route => ({ ...r,
    viaContact: r.viaContact ? { ...r.viaContact, role: 'contact details restricted' } : undefined,
    hops: r.hops.map(h => ({ ...h, edge: edgeForDisplay(h.edge) })),
  });
  const kept = search.routes.filter(r => !r.hops.some(h => licensedOnlyEdge(h.edge)));
  const withheld = search.routes.length - kept.length;
  // Redacting twice (the facade, then an answer) keeps the first pass's count.
  const before = (search as RedactedRouteSearch).licensedRoutesWithheld ?? 0;
  const { structural: _structural, ...rest } = search;
  if (!withheld) return { ...rest, routes: search.routes.map(route), topRoutes: search.topRoutes?.map(route), licensedRoutesWithheld: before };
  const routes = raw.selectTopRoutes(kept).map(route);
  return { ...rest, routes, licensedRoutesWithheld: before + withheld,
    topRoutes: search.topRoutes ? routes.filter(r => r.foldedUnder == null && r.verdict === 'recommend') : undefined,
    graph: search.graph ? raw.routeGraph(routes, search.targetId, true) : undefined,
    stats: search.stats ? raw.summarizeRoutes(routes) : undefined,
    candidateCounts: search.candidateCounts ? { total: routes.length, unavailable: routes.filter(r => r.verdict !== 'recommend').length } : undefined,
    promotedBasisHashes: undefined,
  };
}
export async function planRoutes(...args: Parameters<typeof raw.planRoutes>): Promise<RedactedRouteSearch | null> {
  const [user, data] = await Promise.all([currentUser(), raw.planRoutes(...args)]);
  return !data || licensedAccess(user) ? data : redactLicensedRoutes(data);
}
/** planRoutes for many targets, redacted exactly as planRoutes redacts each one. */
export async function planRoutesMany(...args: Parameters<typeof raw.planRoutesMany>): Promise<Array<RedactedRouteSearch | null>> {
  const [user, data] = await Promise.all([currentUser(), raw.planRoutesMany(...args)]);
  return licensedAccess(user) ? data : data.map((search) => search && redactLicensedRoutes(search));
}
export async function listEdgesForEntities(...args: Parameters<typeof raw.listEdgesForEntities>) {
  const [user, data] = await Promise.all([currentUser(), raw.listEdgesForEntities(...args)]);
  return licensedAccess(user) ? data : data.map(edgeForDisplay);
}
/**
 * X's onward ties as on route hops: a tie resting only on licensed evidence is withheld and counted
 * (licensedRoutesWithheld), and a tie's tier, sources and warmth are read again from the edges left.
 */
export async function throughNode(...args: Parameters<typeof raw.throughNode>): Promise<raw.ThroughView & { licensedRoutesWithheld?: number }> {
  const [user, data] = await Promise.all([currentUser(), raw.throughNode(...args)]);
  if (licensedAccess(user)) return data;
  const readWarmth = raw.warmthReader();
  const firstTier = data.source ? null : data.bestRoute?.weakestTier;
  let withheld = 0;
  const onward = data.onward.flatMap((t) => {
    const edges = t.edges.filter((e) => !licensedOnlyEdge(e)).map(edgeForDisplay);
    if (!edges.length) { withheld++; return []; }
    if (edges.length === t.edges.length) return [{ ...t, edges }];
    return [{ ...t, edges, sources: [...new Set(edges.flatMap(raw.edgeSourceClasses))],
      combinedTier: firstTier === undefined ? null : raw.weakerTier(firstTier, edges[0]!.tier), warmth: readWarmth(edges[0]!).score }];
  });
  return { ...data, onward: withheld || onward.some((t, i) => t.edges.length !== data.onward[i]?.edges.length) ? raw.rankOnward(onward) : onward, licensedRoutesWithheld: withheld };
}
