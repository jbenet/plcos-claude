import { config } from '@/config/deployment';
import type { Edge, Route } from './types';

export type WarmthKind = keyof typeof config.routeWarmth.priors;
/** Stored in existing evidence JSONB. Dates describe contact, never retrieval or mapping. */
export interface TieDetails {
  kind: WarmthKind;
  lastInteraction?: string | null;
  /** Each deal must attribute both people. Firm logos are insufficient. */
  jointInvestments?: Array<{ dealId: string; on: string }>;
  investmentRelevant?: boolean;
}
export interface Warmth {
  version: string;
  evaluatedAt: string;
  kind: WarmthKind;
  prior: number;
  score: number;
  recency: 'current' | 'ageing' | 'historical' | 'unknown';
  basis: string;
}

const LABEL: Record<WarmthKind, string> = {
  proximity: 'Affiliation or proximity only', acquaintance: 'Acquaintance',
  repeated_contact: 'Repeated direct contact', worked_together: 'Worked together',
  joint_investment: 'Joint investment', cofounder: 'Co-founded together',
  frequent_coinvestment: 'Frequent personal co-investment',
};
const monthsAgo = (at: Date, months: number) => {
  const date = new Date(at);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.getTime();
};
const dateOf = (s?: string | null) => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN;
  const n = Date.parse(s);
  return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === s ? n : NaN;
};

export function tieDetailsProblems(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['tie must be an object'];
  const t = value as TieDetails;
  const problems: string[] = [];
  if (!Object.hasOwn(config.routeWarmth.priors, t.kind)) problems.push('unknown warmth kind');
  if (t.lastInteraction != null && !Number.isFinite(dateOf(t.lastInteraction))) problems.push('lastInteraction must be an actual YYYY-MM-DD contact date');
  if (t.investmentRelevant !== undefined && typeof t.investmentRelevant !== 'boolean') problems.push('investmentRelevant must be boolean');
  if (t.jointInvestments !== undefined && (!Array.isArray(t.jointInvestments) || t.jointInvestments.some((d) =>
    !d || typeof d.dealId !== 'string' || !d.dealId.trim() || !Number.isFinite(dateOf(d.on))))) problems.push('jointInvestments need distinct deal IDs and actual YYYY-MM-DD deal dates');
  return problems;
}

/** Pure, deterministic at the supplied date; a high result clears no routing gate. */
export function tieWarmth(kind: string, details?: TieDetails, at = new Date()): Warmth {
  const c = config.routeWarmth;
  // Invalid file metadata cannot confer warmth. The findings checker explains its errors.
  if (details && tieDetailsProblems(details).length) details = { kind: 'proximity' };
  const defaults: Record<string, WarmthKind> = {
    colleague: 'worked_together', advisor: 'worked_together', board: 'worked_together',
    coinvestor: 'joint_investment', cofounder: 'cofounder',
    met: 'acquaintance', corresponded: 'acquaintance', connector: 'acquaintance',
  };
  let k = details?.kind ?? defaults[kind] ?? 'proximity';
  if (!Object.hasOwn(c.priors, k)) k = 'proximity';
  let last = dateOf(details?.lastInteraction);
  if (k === 'frequent_coinvestment') {
    const deals = (details?.jointInvestments ?? []).filter((d) => d.dealId.trim()
      && dateOf(d.on) >= monthsAgo(at, c.frequentDealMonths) && dateOf(d.on) <= at.getTime());
    const distinct = new Set(deals.map((d) => d.dealId));
    if (!details?.investmentRelevant || distinct.size < c.frequentDeals) k = 'joint_investment';
    else last = Math.max(Number.isFinite(last) ? last : -Infinity, ...deals.map((d) => dateOf(d.on)));
  }
  const recency: Warmth['recency'] = !Number.isFinite(last) || last > at.getTime() ? 'unknown'
    : last >= monthsAgo(at, c.currentMonths) ? 'current'
      : last >= monthsAgo(at, c.historicalMonths) ? 'ageing' : 'historical';
  const prior = c.priors[k];
  const score = Math.max(0, prior - c.agePenalty[recency]);
  return { version: c.version, evaluatedAt: at.toISOString(), kind: k, prior, score, recency,
    basis: `${LABEL[k]}: prior ${prior}/5; ${recency === 'unknown' ? 'contact date unknown' : recency}, −${c.agePenalty[recency]}. Estimate — guess; not evidence confidence or intro consent.` };
}

export function edgeWarmth(edge: Pick<Edge, 'kind' | 'evidence'>, at = new Date()): Warmth {
  const ties = edge.evidence.flatMap((e) => e.tie ? [tieWarmth(edge.kind, e.tie, at)] : []);
  return ties.sort((a, b) => b.score - a.score)[0] ?? tieWarmth(edge.kind, undefined, at);
}

export function needsHuman(edge: Pick<Edge, 'tier' | 'reviewedByName' | 'reviewedAt'>): boolean {
  return (edge.tier === 'C' || edge.tier === 'D') && !(edge.reviewedByName && edge.reviewedAt);
}

export function routeWarmth(route: Pick<Route, 'hops'>, at = new Date()): number {
  return route.hops.length ? Math.min(...route.hops.map((h) => edgeWarmth(h.edge, at).score)) : 0;
}

/** Keep every route. Fold only an extra prefix into the same first connector and exact suffix.
 * A different suffix, weaker first hop, held route or restriction remains independently visible.
 */
export function foldRoutes(routes: Route[], at = new Date()): Route[] {
  const out = routes.map((r) => ({ ...r, foldedUnder: null as number | null }));
  for (const longer of out) {
    const parent = out.findIndex((shorter) => {
      const first = shorter.hops[0];
      if (!first || shorter.hops.length < 2 || shorter.hops.length >= longer.hops.length
        || shorter.verdict !== 'recommend' || longer.verdict !== 'recommend' || needsHuman(first.edge)) return false;
      const warmth = edgeWarmth(first.edge, at);
      if (warmth.score < config.routeWarmth.strongFirstHop || warmth.recency === 'unknown' || warmth.recency === 'historical') return false;
      const offset = longer.hops.length - shorter.hops.length;
      const detourWarmth = Math.min(...longer.hops.slice(0, offset + 1).map((h) => edgeWarmth(h.edge, at).score));
      if (warmth.score < detourWarmth) return false;
      return longer.hops[offset]?.toEntity === first.toEntity
        && shorter.hops.slice(1).every((h, i) => h.edge.edgeId === longer.hops[offset + i + 1]?.edge.edgeId
          && h.toEntity === longer.hops[offset + i + 1]?.toEntity);
    });
    if (parent >= 0) longer.foldedUnder = parent;
  }
  // If a parent was itself folded, point at the visible ancestor.
  for (const r of out) while (r.foldedUnder !== null && out[r.foldedUnder]!.foldedUnder !== null) r.foldedUnder = out[r.foldedUnder]!.foldedUnder;
  return out;
}
