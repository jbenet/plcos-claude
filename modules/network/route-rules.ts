import { config } from '@/config/deployment';
import { routeStrength } from './warmth';
import type { Route, RouteRuleCounts, RouteScore } from './types';

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
