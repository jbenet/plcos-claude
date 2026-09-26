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

/** Request-local evaluation: the same edge gets the same date and warmth everywhere. */
export function warmthReader(at = new Date()) {
  const cache = new Map<Edge, Warmth>();
  return (edge: Edge): Warmth => {
    let value = cache.get(edge);
    if (!value) { value = edgeWarmth(edge, at); cache.set(edge, value); }
    return value;
  };
}

/** Keep every route. Fold dominated parallel evidence and extra prefixes into the same destination chain.
 * A different suffix, weaker first hop, held route or restriction remains independently visible.
 */
export function foldRoutes(routes: Route[], at = new Date(), readWarmth = warmthReader(at)): Route[] {
  const out = routes.map((r) => ({ ...r, foldedUnder: null as number | null }));
  const prepared = routes.map((route) => {
    const scores = route.hops.map((h) => readWarmth(h.edge).score);
    const prefixWarmth: number[] = [], prefixTier: Edge['tier'][] = [];
    for (const [i, h] of route.hops.entries()) {
      prefixWarmth.push(Math.min(prefixWarmth[i - 1] ?? Infinity, scores[i]!));
      prefixTier.push(h.edge.tier > (prefixTier[i - 1] ?? 'A') ? h.edge.tier : prefixTier[i - 1] ?? 'A');
    }
    return { scores, prefixWarmth, prefixTier };
  });
  const key = (route: Route, offset = 0) => JSON.stringify([route.fromEntity, ...route.hops.slice(offset).map((h) => h.toEntity)]);
  const chains = new Map<string, number[]>();
  for (const [i, route] of routes.entries()) {
    if (route.verdict !== 'recommend' || !route.hops.length) continue;
    const chain = key(route);
    const group = chains.get(chain) ?? [];
    group.push(i);
    chains.set(chain, group);
  }
  for (const [i, longer] of out.entries()) {
    if (longer.verdict !== 'recommend') continue;
    let parent = Infinity;
    const details = prepared[i]!;
    // Only routes to the same suffix can dominate. Preserve the original first
    // matching index, even if the shorter route occurs later in the ranked list.
    for (let offset = 0; offset < longer.hops.length; offset++) {
      for (const j of chains.get(key(longer, offset)) ?? []) {
        if (j >= parent || (offset === 0 && j >= i)) break;
        const shorter = routes[j]!, first = shorter.hops[0]!;
        const scores = prepared[j]!.scores;
        if (offset > 0) {
          const tier = details.prefixTier[offset]!, warmth = details.prefixWarmth[offset]!;
          if (first.edge.tier > 'B' || first.edge.tier > tier || scores[0]! < warmth) continue;
          if (scores[0]! < config.routeWarmth.strongFirstHop && !(first.edge.tier < tier && scores[0]! > warmth)) continue;
        }
        if (!shorter.hops.every((h, k) => (offset > 0 && k === 0) ||
          (h.edge.tier <= longer.hops[offset + k]!.edge.tier && scores[k]! >= details.scores[offset + k]!))) continue;
        parent = j;
        break;
      }
    }
    if (Number.isFinite(parent)) longer.foldedUnder = parent;
  }
  // Compress ancestor chains. Shorter paths, or earlier equal-length paths,
  // make this acyclic; every alternative still points to its visible ancestor.
  for (const route of out) {
    const trail: Route[] = [];
    let ancestor = route.foldedUnder;
    while (ancestor !== null && out[ancestor]!.foldedUnder !== null) {
      trail.push(out[ancestor]!);
      ancestor = out[ancestor]!.foldedUnder;
    }
    if (ancestor !== null) {
      route.foldedUnder = ancestor;
      for (const step of trail) step.foldedUnder = ancestor;
    }
  }
  return out;
}
