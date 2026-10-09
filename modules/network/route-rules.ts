import { config } from '@/config/deployment';
import { routeStrength } from './warmth';
import type { Route, RouteRuleCounts, RouteScore } from './types';
import type { RoutePolicyFacts, BadTermsFact } from './route-policy';

export const emptyRuleCounts = (): RouteRuleCounts => ({ inspected: 0, sourcePrefixes: 0, duplicates: 0,
  repeatedPeople: 0, plFallbacks: 0, restricted: 0, largeOrganizations: 0, organizationPenalties: 0 });
export type OrganizationSize = { members: number; headcount: number | null };
export function oversizedOrganization(size: OrganizationSize): boolean {
  return size.members >= config.routePolicy.maxOrganizationMembers
    || (size.headcount !== null && size.headcount >= config.routePolicy.maxOrganizationHeadcount);
}
export function organizationPenalty(score: RouteScore, route: Pick<Route, 'connectorIds' | 'hops'>,
  organizations: Map<string, OrganizationSize>): RouteScore {
  const sizes = route.connectorIds.flatMap(id => organizations.has(id) ? [organizations.get(id)!] : []);
  if (!sizes.length) return score;
  const size = Math.max(...sizes.map(s => Math.max(s.members, s.headcount ?? 0)));
  const value = Math.round(score.value / (1 + size / config.routePolicy.organizationPenaltyScale) * 100) / 100;
  return { ...score, value, band: routeStrength(value), factors: [...score.factors, {
    key: 'organizationSize', label: 'Organization size', points: value - score.value,
    basis: `Largest organization hop: ${size} people (maximum of distinct graph members and recorded public headcount). Size discount is a configurable estimate.`,
    edgeIds: route.hops.map(h => h.edge.edgeId),
  }] };
}

/** The busy-introducer warning (feedback 0124): shown, and refusing nothing unless the ask limit is enforced. */
export function busyReason(connector: string, used: number, cap: number, held: boolean): string {
  return `${connector} is a busy introducer: asked ${used} time${used === 1 ? '' : 's'} this quarter, at or past the guide of ${cap}. ` +
    (held ? 'The route is held because the ask limit is enforced.' : 'Nothing is held; weigh it before asking again.');
}

/** Issue 0143: the first marked pair among everyone on a route (us, each introducer, the contact and the target). */
export function badTermsOn(policy: RoutePolicyFacts, ids: string[]): BadTermsFact | undefined {
  if (!policy.badTerms?.size) return undefined;
  const groups = [...new Set(ids.map((id) => policy.groupOf?.get(id) ?? id))];
  for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
    const hit = policy.badTerms.get([groups[i], groups[j]].sort().join('|'));
    if (hit) return hit;
  }
  return undefined;
}

export function badTermsReason(mark: BadTermsFact): string {
  return `${mark.aName} and ${mark.bName} are on bad terms, marked by ${mark.byName} on ${mark.at}${mark.note ? ` ("${mark.note}")` : ''}. `
    + 'A route that asks one of them about the other is excluded; undo the mark if it no longer holds.';
}
