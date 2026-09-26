import { config } from '@/config/deployment';
import type { Edge, Route } from './types';

export type WarmthKind = keyof typeof config.routeWarmth.priors;
/** Stored in existing evidence JSONB. Dates describe contact, never retrieval or mapping. */
export interface TieDetails {
  kind: WarmthKind;
  /** PL affiliation is a policy-based tie, not a claimed dated interaction. */
  basis?: 'pl_affiliation' | 'pl_network';
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
  if (t.basis !== undefined && !['pl_affiliation', 'pl_network'].includes(t.basis)) problems.push('unknown tie basis');
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
  const penalty = details?.basis ? 0 : c.agePenalty[recency];
  const score = Math.max(0, prior - penalty);
  return { version: c.version, evaluatedAt: at.toISOString(), kind: k, prior, score, recency,
    basis: `${details?.basis === 'pl_affiliation' ? 'PL colleagues by affiliation policy' : details?.basis === 'pl_network' ? 'PL network tie by affiliation policy' : LABEL[k]}: prior ${prior}/5; ${recency === 'unknown' ? 'contact date unknown' : recency}, −${penalty}. Estimate — guess; not evidence confidence or intro consent.` };
}

export function edgeWarmth(edge: Pick<Edge, 'kind' | 'evidence'>, at = new Date()): Warmth {
  const ties = edge.evidence.flatMap((e) => e.tie ? [tieWarmth(edge.kind, e.tie, at)] : []);
  return ties.sort((a, b) => b.score - a.score)[0] ?? tieWarmth(edge.kind, undefined, at);
}

export function routeWarmth(route: Pick<Route, 'hops'>, at = new Date()): number {
  return route.hops.length ? Math.min(...route.hops.map((h) => edgeWarmth(h.edge, at).score)) : 0;
}

/** Keep every route. Fold dominated parallel evidence and extra prefixes into the same destination chain.
 * A different suffix, weaker first hop, held route or restriction remains independently visible.
 */
export function foldRoutes(routes: Route[], at = new Date()): Route[] {
  const out = routes.map((r) => ({ ...r, foldedUnder: null as number | null }));
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
          && edgeWarmth(h.edge, at).score >= edgeWarmth(longer.hops[i]!.edge, at).score);
      const warmth = edgeWarmth(first.edge, at);
      if (first.edge.tier > 'B') return false;
      // A strong A/B prefix dominates a weaker detour even when the shared suffix is C/D.
      // Unknown contact dates reduce warmth; they are not a separate eligibility gate.

      const offset = longer.hops.length - shorter.hops.length;
      const detourWarmth = Math.min(...longer.hops.slice(0, offset + 1).map((h) => edgeWarmth(h.edge, at).score));
      const detourTier = longer.hops.slice(0, offset + 1).map((h) => h.edge.tier).sort().at(-1)!;
      if (first.edge.tier > detourTier || warmth.score < detourWarmth) return false;
      if (warmth.score < config.routeWarmth.strongFirstHop && !(first.edge.tier < detourTier && warmth.score > detourWarmth)) return false;
      return longer.hops[offset]?.toEntity === first.toEntity
        && shorter.hops.slice(1).every((h, i) => h.toEntity === longer.hops[offset + i + 1]?.toEntity
          && h.edge.tier <= longer.hops[offset + i + 1]!.edge.tier
          && edgeWarmth(h.edge, at).score >= edgeWarmth(longer.hops[offset + i + 1]!.edge, at).score);
    });
    if (parent >= 0) longer.foldedUnder = parent;
  }
  // If a parent was itself folded, point at the visible ancestor.
  for (const r of out) while (r.foldedUnder !== null && out[r.foldedUnder]!.foldedUnder !== null) r.foldedUnder = out[r.foldedUnder]!.foldedUnder;
  return out;
}
