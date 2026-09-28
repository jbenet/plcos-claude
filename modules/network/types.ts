export type EdgeKind =
  | 'connector' | 'employment' | 'colleague' | 'advisor' | 'board' | 'coinvestor' | 'family'
  | 'event_coattendee' | 'social_public' | 'podcast_guest'
  // N82: from the team's own records, and from the research's paths.
  | 'possible_identity' | 'met' | 'corresponded' | 'alumni' | 'portfolio' | 'other';

export type EvidenceTier = 'A' | 'B' | 'C' | 'D';

/**
 * What each tier is allowed to mean. v3 said "tier it"; v4 said what the tiers mean.
 * This is the text the UI shows, so the meaning cannot drift from the enum.
 */
export const TIER_MEANING: Record<EvidenceTier, { label: string; means: string; routable: string }> = {
  A: {
    label: 'Close, enduring relationship',
    means: 'Co-founders, family, close friends, or frequent personal co-investment, evidenced on file.',
    routable: 'Routable.',
  },
  B: {
    label: 'Warm working or direct relationship',
    means: 'Worked or invested together, served on a board together, recent direct contact, or PL colleagues under the own-network rule.',
    routable: 'Routable.',
  },
  C: {
    label: 'Acquaintance or affiliation',
    means: 'Older or undated contact, generic network membership or a shared affiliation; a warm personal tie is not established.',
    routable: 'Routes with uncertainty; ranked below A and B.',
  },
  D: {
    label: 'Proximity only',
    means: 'Co-attendance, or a public social connection. A discovery clue, not a relationship.',
    routable: 'Routes with uncertainty; ranked below A and B.',
  },
};

/** The named failure modes. Proximity evidence must not be upgraded into a claim. */
export const CLUE_KINDS: EdgeKind[] = ['event_coattendee', 'social_public', 'podcast_guest'];

export interface Edge {
  /** Compact server-evaluated hop warmth for the graph. */
  warmthScore?: number;
  edgeId: string;
  fromEntity: string;
  toEntity: string;
  fromName: string;
  toName: string;
  kind: EdgeKind;
  tier: EvidenceTier;
  strength: number | null;
  tieBand: string | null;
  evidence: Array<{ doc?: string; note: string; source?: string; as_of?: string; tie?: import('./warmth').TieDetails }>;
  reviewedByName: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  validFrom: Date;
  validTo: Date | null;
}

export type RouteVerdict = 'recommend' | 'hold' | 'not_a_route' | 'excluded';

export const VERDICT_LABEL: Record<RouteVerdict, string> = {
  recommend: 'Recommend',
  hold: 'Hold',
  not_a_route: 'Not a route',
  excluded: 'Excluded',
};

export interface RouteHop {
  edge: Edge;
  /** The person this hop reaches. */
  toName: string;
  toEntity: string;
}

export type RouteStrength = 'strong' | 'warm' | 'weak';
export interface RouteScoreFactor {
  key: 'lastHop' | 'introducer' | 'history' | 'access' | 'recency' | 'confidence' | 'weakestHop' | 'organizationSize';
  label: string;
  /** Signed points; factors sum to the route score before rounding. */
  points: number;
  basis: string;
  edgeIds: string[];
  /** Non-edge support, such as an evidenced LP commitment. */
  evidenceRefs?: string[];
}
export interface RouteScore {
  version: string;
  evaluatedAt: string;
  /** Relative strength 0–100, an uncalibrated estimate, never an investment probability. */
  value: number;
  band: RouteStrength;
  confidence: number;
  factors: RouteScoreFactor[];
}
export interface RouteStats {
  targetCount: number;
  routeCount: number;
  counts: Record<RouteStrength, number>;
  /** Distinct targets by their best usable route; unavailable includes held/restricted-only. */
  bestRouteCounts: Record<RouteStrength | 'unavailable', number>;
  bestScore: number | null;
  strongTargets: number;
  confidenceStatement: string;
}
export interface RouteGraph {
  nodes: Array<{ entityId: string; name: string; source: boolean; target: boolean }>;
  /** Route indices always refer to the full routes array, even for the visible graph. */
  links: Array<{ fromEntity: string; toEntity: string; edgeIds: string[]; routeIndices: number[] }>;
}

export interface Route {
  /** Capacity of the terminal person for an organisation LP; never an additional relationship hop. */
  viaContact?: { entityId: string; name: string; role: string };
  /** Presentation-only safety groups for unmerged possible identities. Evidence IDs stay intact. */
  identityGroups?: Record<string, string>;
  /** Present on every planned route; optional only for legacy fixture callers. */
  score?: RouteScore;
  fromEntity?: string;
  fromName?: string;
  /** Index of the visible route this alternative is folded beneath; data is retained. */
  foldedUnder?: number | null;
  hops: RouteHop[];
  /** Everyone between us and the target. The people whose goodwill this spends. */
  connectorNames: string[];
  connectorIds: string[];
  verdict: RouteVerdict;
  /** Why, in order of severity. Always populated, including for a recommendation. */
  reasons: string[];
  /** The weakest tier along the path — a route is only as good as its worst hop. */
  weakestTier: EvidenceTier;
  askLoad: { connector: string; used: number; cap: number } | null;
  /**
   * How much weight this route carries, once it has passed the safety rules above.
   *
   * Deliberately separate from `verdict`: influence orders the usable routes and can never
   * promote a restricted one. The scorer runs after the rules, not instead
   * of them.
   */
  influence: import('./influence').Influence | null;
}

export interface RouteRuleCounts {
  inspected: number;
  sourcePrefixes: number;
  duplicates: number;
  repeatedPeople: number;
  plFallbacks: number;
  restricted: number;
  largeOrganizations: number;
  organizationPenalties: number;
}
export interface RemovedRoute {
  fromName: string;
  names: string[];
  reason: 'restricted' | 'large_organization';
}

export interface RouteSearch {
  ruleCounts?: RouteRuleCounts;
  removedRoutes?: RemovedRoute[];
  targetId: string;
  targetName: string;
  fromName: string;
  routes: Route[];
  /** Best one to three prefixes per last intermediary, plus direct sources; every alternative remains in routes. */
  topRoutes?: Route[];
  graph?: RouteGraph;
  stats?: RouteStats;
  /** Full inspected candidates, before folding and presentation filters. */
  candidateCounts?: { total: number; unavailable: number };
  /** SHA-256 of evidence notes on every usable or held candidate, including hidden paths. */
  promotedBasisHashes?: string[];
  /** What was inspected. Rendered, never only logged. */
  coverage: {
    edges: number;
    maxHops: number;
    from: Date | null;
    to: Date | null;
    notInspected: Array<{ source: string; why: string }>;
  };
  restrictions: Array<{ instruction: string; connectorName: string | null; source: string | null }>;
  /** Compact build snapshot. Candidate descriptors preserve guard alternatives and counts;
   * only routes above carry full evidence. Never send this internal metadata to a client. */
  structural?: StructuralRoutes;
}

export interface StructuralRoutes {
  nodes: Array<{ entityId: string; name: string }>;
  edges: Array<Pick<Edge, 'edgeId' | 'kind' | 'tier' | 'evidence'> & { basisHashes: string[] }>;
  candidates: Array<{ nodes: number[]; edges: number[]; viaContact?: Route['viaContact'] }>;
  roles: Record<string, import('./warmth').RouteScoreContext>;
}
