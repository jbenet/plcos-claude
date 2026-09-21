export type EdgeKind =
  | 'connector' | 'colleague' | 'advisor' | 'board' | 'coinvestor' | 'family'
  | 'event_coattendee' | 'social_public' | 'podcast_guest';

export type EvidenceTier = 'A' | 'B' | 'C' | 'D';

/**
 * What each tier is allowed to mean. v3 said "tier it"; v4 said what the tiers mean.
 * This is the text the UI shows, so the meaning cannot drift from the enum.
 */
export const TIER_MEANING: Record<EvidenceTier, { label: string; means: string; routable: string }> = {
  A: {
    label: 'Documented working relationship',
    means: 'They have demonstrably worked together, with evidence of interaction on file.',
    routable: 'Routable.',
  },
  B: {
    label: 'Documented association',
    means: 'One strong source places them in a real relationship, with some interaction.',
    routable: 'Routable.',
  },
  C: {
    label: 'Shared affiliation only',
    means: 'Same board, same firm, same programme — and no evidence they ever spoke.',
    routable: 'Needs a human before it can carry a route.',
  },
  D: {
    label: 'Proximity only',
    means: 'Co-attendance, or a public social connection. A discovery clue, not a relationship.',
    routable: 'Needs a human before it can carry a route.',
  },
};

/** The named failure modes. Proximity evidence must not be upgraded into a claim. */
export const CLUE_KINDS: EdgeKind[] = ['event_coattendee', 'social_public', 'podcast_guest'];

export interface Edge {
  edgeId: string;
  fromEntity: string;
  toEntity: string;
  fromName: string;
  toName: string;
  kind: EdgeKind;
  tier: EvidenceTier;
  strength: number | null;
  tieBand: string | null;
  evidence: Array<{ doc?: string; note: string }>;
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

export interface Route {
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
   * promote a restricted or unreviewed one. The scorer runs after the rules, not instead
   * of them.
   */
  influence: import('./influence').Influence | null;
}

export interface RouteSearch {
  targetId: string;
  targetName: string;
  fromName: string;
  routes: Route[];
  /** What was inspected. Rendered, never only logged. */
  coverage: {
    edges: number;
    maxHops: number;
    from: Date | null;
    to: Date | null;
    notInspected: Array<{ source: string; why: string }>;
  };
  restrictions: Array<{ instruction: string; connectorName: string | null; source: string | null }>;
}
