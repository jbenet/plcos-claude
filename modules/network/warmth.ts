import { config } from '@/config/deployment';
import type { Edge, EvidenceTier, Route, RouteScore, RouteScoreFactor, RouteStrength } from './types';

export type WarmthKind = keyof typeof config.routeWarmth.priors;
/** Stored in existing evidence JSONB. Dates describe contact, never retrieval or mapping. */
export interface TieDetails {
  kind: WarmthKind;
  /** Sourced direct conversation, independent of its age or unknown contact date. */
  directInteraction?: boolean;
  /** PL affiliation is a policy-based tie, not a claimed dated interaction. */
  basis?: 'pl_affiliation' | 'pl_network';
  lastInteraction?: string | null;
  /** Each deal must attribute both people. Firm logos are insufficient. */
  jointInvestments?: Array<{ dealId: string; on: string }>;
  investmentRelevant?: boolean;
  /** A sourced personal investment with this founder; never inferred from a firm's logo. */
  raisedFrom?: boolean;
  /** Describes the non-team endpoint of a team/PL tie, never arbitrary graph endpoints. */
  withUs?: 'investor' | 'pl_founder';
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

export const WARMTH_LABEL: Record<WarmthKind, string> = {
  proximity: 'Affiliation or proximity only', acquaintance: 'Acquaintance',
  repeated_contact: 'Repeated direct contact', worked_together: 'Worked together',
  joint_investment: 'Joint investment', cofounder: 'Co-founded together',
  family: 'Family', close_friend: 'Close friends', recent_contact: 'Recent direct contact',
  frequent_coinvestment: 'Frequent personal co-investment', investor_founder: 'Personal investor–founder relationship',
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
  if (t.directInteraction !== undefined && typeof t.directInteraction !== 'boolean') problems.push('directInteraction must be boolean');
  if (!Object.hasOwn(config.routeWarmth.priors, t.kind)) problems.push('unknown warmth kind');
  if (t.basis !== undefined && !['pl_affiliation', 'pl_network'].includes(t.basis)) problems.push('unknown tie basis');
  if (t.lastInteraction != null && !Number.isFinite(dateOf(t.lastInteraction))) problems.push('lastInteraction must be an actual YYYY-MM-DD contact date');
  if (t.raisedFrom !== undefined && typeof t.raisedFrom !== 'boolean') problems.push('raisedFrom must be boolean');
  if (t.withUs !== undefined && !['investor', 'pl_founder'].includes(t.withUs)) problems.push('unknown withUs role');
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
    coinvestor: 'joint_investment', cofounder: 'cofounder', family: 'family',
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
  const prior = c.priors[k]; // GUESS — ordinal relationship prior, not calibrated probability.
  const penalty = details?.basis ? 0 : c.agePenalty[recency];
  const score = Math.max(0, prior - penalty);
  return { version: c.version, evaluatedAt: at.toISOString(), kind: k, prior, score, recency,
    basis: `${details?.basis === 'pl_affiliation' ? 'PL colleagues by affiliation policy' : details?.basis === 'pl_network' ? 'PL network tie by affiliation policy' : WARMTH_LABEL[k]}: prior ${prior}/5; ${recency === 'unknown' ? 'contact date unknown' : recency}, −${penalty}. Estimate — guess; not evidence confidence or intro consent.` };
}

/** Compatibility with already-imported W3 evidence. Only explicit personal investor/founder
 * statements count; generic investment mentions, firm ties and missing sources do not.
 * New W3 output writes structured metadata. No person names participate in this rule.
 */
function investmentDetails(e: Edge['evidence'][number]): TieDetails | null {
  if (e.tie && tieDetailsProblems(e.tie).length) return null;
  if (e.tie?.kind === 'investor_founder') return e.tie;
  // The known W3 disclaimer denies willingness, not the preceding investment claim.
  const claim = e.note.replace(/; willingness is not recorded\.?$/i, '');
  if (!e.source || /\b(?:not|never|no|firm[’']?s)\b/i.test(claim)) return null;
  if (!/personal angel\/backer.*documented founder.*Direct investor[–-]founder tie/i.test(claim)
    && !/angel investor in Protocol Labs.*knows (?:them |him |her )?directly/i.test(claim)) return null;
  return { kind: 'investor_founder', lastInteraction: e.tie?.lastInteraction };
}

export function investmentTie(edge: Pick<Edge, 'evidence'>): boolean {
  return edge.evidence.some((e) => investmentDetails(e) !== null);
}

export function edgeWarmth(edge: Pick<Edge, 'kind' | 'evidence'>, at = new Date()): Warmth {
  const ties = edge.evidence.flatMap((e) => {
    const investment = investmentDetails(e);
    return [e.tie, investment].flatMap((tie) => tie ? [tieWarmth(edge.kind, tie, at)] : []);
  });
  return ties.sort((a, b) => b.score - a.score || b.prior - a.prior || a.kind.localeCompare(b.kind))[0]
    ?? tieWarmth(edge.kind, undefined, at);
}

/** GUESS — qualitative warmth grades, derived from the relationship evidence, never a source's proposed letter alone.
 * PL staff affiliation is the explicit own-network policy exception. Generic membership stays C.
 */
export function edgeGrade(edge: Pick<Edge, 'kind' | 'evidence'>, at = new Date()): EvidenceTier {
  if (edge.kind === 'possible_identity') return 'D';
  const warmth = edgeWarmth(edge, at);
  if (edge.evidence.some(e => e.tie?.basis === 'pl_affiliation')) return 'B';
  if (['cofounder', 'family', 'close_friend', 'frequent_coinvestment'].includes(warmth.kind)) return 'A';
  if (edge.evidence.some(e => e.source && e.tie?.directInteraction === true
    && !tieDetailsProblems(e.tie).length && !e.tie.basis
    && ['recent_contact', 'repeated_contact', 'acquaintance'].includes(e.tie.kind))) return 'B';
  if (['worked_together', 'joint_investment', 'investor_founder'].includes(warmth.kind)
      && !edge.evidence.some(e => e.tie?.basis === 'pl_network')) return 'B';
  if (['recent_contact', 'repeated_contact', 'acquaintance'].includes(warmth.kind) && warmth.recency === 'current') return 'B';
  if (warmth.kind !== 'proximity' || ['colleague', 'advisor', 'board', 'portfolio', 'alumni'].includes(edge.kind)) return 'C';
  return 'D';
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


export function routeStrength(value: number): RouteStrength {
  return value >= config.routeScoring.bands.strong ? 'strong' : value >= config.routeScoring.bands.warm ? 'warm' : 'weak';
}

export interface RouteScoreContext {
  /** Sourced role of the final introducer, loaded once for the request. */
  investor?: boolean;
  plFounder?: boolean;
  roleEdgeIds?: string[];
  roleEvidenceRefs?: string[];
}

/** Deterministic relative strength. Tier discounts confidence; the strongest final relationship
 * supplies most points. Neither score nor a role changes verdict, evidence tier or consent.
 */
export function scoreRoute(route: Pick<Route, 'hops'>, at = new Date(), context: RouteScoreContext = {},
  readWarmth = warmthReader(at)): RouteScore {
  const c = config.routeScoring, w = c.weights;
  const final = route.hops.at(-1)?.edge;
  const last = final ? readWarmth(final) : null;
  const maxWarmth = Math.max(...Object.values(config.routeWarmth.priors));
  const factors: RouteScoreFactor[] = [];
  const add = (key: RouteScoreFactor['key'], label: string, points: number, basis: string, edgeIds: string[] = []) =>
    factors.push({ key, label, points, basis, edgeIds });
  add('lastHop', 'Relationship to target', (last?.prior ?? 0) / maxWarmth * w.lastHop,
    last?.basis ?? 'No final relationship on file.', final ? [final.edgeId] : []);
  // Recency belongs to contact evidence, never valid_from/as_of (import and retrieval dates).
  add('recency', 'Contact recency', ((last?.score ?? 0) - (last?.prior ?? 0)) / maxWarmth * w.lastHop,
    last ? `Final relationship: ${last.recency}. Policy affiliation has no inferred contact date.` : 'Unknown.', final ? [final.edgeId] : []);
  const coinvestor = final && (last?.kind === 'joint_investment' || last?.kind === 'frequent_coinvestment');
  const role = Math.max(context.investor ? c.introducer.investor : 0,
    context.plFounder ? c.introducer.plFounder : 0, coinvestor ? c.introducer.coinvestor : 0);
  add('introducer', 'Introducer standing', route.hops.length > 1 ? role * w.introducer : 0,
    route.hops.length === 1 ? 'Direct route; no introducer required.' :
      [context.investor ? 'Our personal investor or evidenced LP' : '', context.plFounder ? 'PL network founder' : '',
        coinvestor ? 'Personal co-investment with target' : ''].filter(Boolean).join('; ') || 'No qualifying introducer role on file.',
    [...(context.roleEdgeIds ?? []), ...(coinvestor && final ? [final.edgeId] : [])]);
  factors[factors.length - 1]!.evidenceRefs = context.roleEvidenceRefs ?? [];
  const raised = final?.evidence.some((e) => e.tie?.raisedFrom === true && !tieDetailsProblems(e.tie).length);
  const repeated = final?.evidence.some((e) => e.tie?.kind === 'repeated_contact' && !tieDetailsProblems(e.tie).length);
  const history = raised ? c.history.raisedFrom : final && investmentTie(final) ? c.history.investorFounder
    : repeated ? c.history.repeatedContact : 0;
  add('history', 'Direct investment and interaction history', history * w.history,
    raised ? 'Explicit direct fundraising history.' : final && investmentTie(final) ? 'Sourced personal investor–founder history.'
      : repeated ? 'Repeated dated direct interactions.' : 'No additional direct history on file.', final ? [final.edgeId] : []);
  const prefix = route.hops.slice(0, -1);
  const access = final ? prefix.length ? Math.min(...prefix.map((h) => readWarmth(h.edge).score)) / maxWarmth : 1 : 0;
  add('access', 'Access to introducer', access * w.access,
    prefix.length ? 'Weakest access hop to the introducer; the final relationship remains dominant.' : 'Direct access.', prefix.map((h) => h.edge.edgeId));
  const confidence = route.hops.length ? Math.min(...route.hops.map((h) => c.tierConfidence[h.edge.tier])) : 0;
  const subtotal = factors.reduce((n, f) => n + f.points, 0);
  add('confidence', 'Evidence confidence', -subtotal * (1 - c.confidenceFloor) * (1 - confidence),
    `Weakest evidence tier confidence ${confidence}; uncalibrated estimate, not investment probability or permission.`, route.hops.map((h) => h.edge.edgeId));
  const raw = Math.max(0, factors.reduce((n, f) => n + f.points, 0));
  const ceiling = route.hops.length ? Math.min(...route.hops.map(h => readWarmth(h.edge).score)) * 20 : 0;
  add('weakestHop', 'Weakest hop ceiling', Math.min(0, ceiling - raw),
    `Route strength cannot exceed its weakest hop: ${ceiling / 20}/5 (${ceiling}/100).`, route.hops.map(h => h.edge.edgeId));
  const value = Math.min(ceiling, Math.round(Math.max(0, Math.min(100, raw)) * 100) / 100);
  return { version: c.version, evaluatedAt: at.toISOString(), value, band: routeStrength(value), confidence, factors };
}
