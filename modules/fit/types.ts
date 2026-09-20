export type FirmClass =
  | 'sfo' | 'mfo' | 'ria' | 'foundation' | 'endowment' | 'fof' | 'institution'
  | 'corporate' | 'individual';

export type DecisionArch = 'principal' | 'cio' | 'small_ic' | 'full_ic_consultant';
export type Certainty = 'known' | 'inferred' | 'guess';
export type Grade = 'strong' | 'good' | 'neutral' | 'weak' | 'blocker';
export type Familiarity = 'unaware' | 'heard_of' | 'familiar' | 'deep';
export type Sentiment = 'negative' | 'skeptical' | 'neutral' | 'positive' | 'champion' | 'unknown';
export type LinkKind =
  | 'they_lp_in_us' | 'we_lp_in_them' | 'co_lp' | 'co_investor' | 'portfolio_overlap'
  | 'former_colleague' | 'board' | 'personal' | 'advisor' | 'grantee';

export const FIRM_CLASS_LABEL: Record<FirmClass, string> = {
  sfo: 'Single family office',
  mfo: 'Multi-family office',
  ria: 'RIA / wealth manager',
  foundation: 'Foundation',
  endowment: 'Endowment',
  fof: 'Fund-of-funds / seeder',
  institution: 'Institution',
  corporate: 'Corporate / strategic',
  individual: 'Individual',
};

/** Report 4 §4.2 — the ordinal, with the weeks each band actually takes. */
export const DECISION_LABEL: Record<DecisionArch, string> = {
  principal: 'Principal decides',
  cio: 'CIO decides',
  small_ic: 'Small investment committee',
  full_ic_consultant: 'Full IC, consultant-gated',
};

export const CERTAINTY_LABEL: Record<Certainty, string> = {
  known: 'Known',
  inferred: 'Inferred',
  guess: 'Guess',
};

export const GRADE_LABEL: Record<Grade, string> = {
  strong: 'Strong', good: 'Good', neutral: 'Neutral', weak: 'Weak', blocker: 'Blocker',
};

export const FAMILIARITY_LABEL: Record<Familiarity, string> = {
  unaware: 'Never heard of us',
  heard_of: 'Heard of us',
  familiar: 'Familiar',
  deep: 'Knows us well',
};

export const SENTIMENT_LABEL: Record<Sentiment, string> = {
  negative: 'Against', skeptical: 'Skeptical', neutral: 'Neutral',
  positive: 'Positive', champion: 'Champion', unknown: 'Not known',
};

export const LINK_LABEL: Record<LinkKind, string> = {
  they_lp_in_us: 'They are an LP in us',
  we_lp_in_them: 'We are invested with them',
  co_lp: 'Co-LP in the same fund',
  co_investor: 'Co-invested in a company',
  portfolio_overlap: 'Portfolio overlap',
  former_colleague: 'Former colleagues',
  board: 'Board together',
  personal: 'Personal',
  advisor: 'Adviser relationship',
  grantee: 'Grant relationship',
};

export const GRADE_SCORE: Record<Grade, number> = {
  strong: 1, good: 0.72, neutral: 0.5, weak: 0.25, blocker: 0,
};

/** Certainty does not change a finding; it changes what the finding licenses. */
export const CERTAINTY_WEIGHT: Record<Certainty, number> = {
  known: 1, inferred: 0.75, guess: 0.5,
};

export interface FirmProfile {
  entityId: string;
  entityName: string;
  firmClass: FirmClass;
  iapdRegistered: boolean | null;
  estAum: number | null;
  aumBasis: string | null;
  aumCertainty: Certainty;
  decisionArch: DecisionArch;
  weeksMin: number;
  weeksMax: number;
  whoSigns: string | null;
  whoCanKill: string | null;
  checkBandMin: number | null;
  checkBandMax: number | null;
  priorRelationship: boolean;
  provenanceNote: string | null;
  provenanceSince: Date | null;
}

export interface Gate {
  code: string;
  label: string;
  passed: boolean | null;
  detail: string;
  certainty: Certainty;
  source: string | null;
  asOf: Date;
}

export interface Dimension {
  code: string;
  label: string;
  question: string;
  grade: Grade;
  certainty: Certainty;
  finding: string;
  source: string | null;
  asOf: Date;
  weightUs: number;
  weightThem: number;
}

export interface ValueItem {
  valueId: string;
  theyValue: string;
  ourMatch: string;
  matchGrade: Grade;
  clearToThem: boolean;
  nextAction: string;
  certainty: Certainty;
  source: string | null;
  asOf: Date;
}

export interface Perception {
  perceptionId: string;
  subject: string;
  subjectKind: string;
  familiarity: Familiarity;
  sentiment: Sentiment;
  evidence: string;
  certainty: Certainty;
  source: string | null;
  asOf: Date;
}

export interface Engagement {
  engagementId: string;
  channel: string;
  behaviour: string;
  detail: string;
  observedOn: Date;
  certainty: Certainty;
}

export interface Link {
  linkId: string;
  viaEntityId: string | null;
  viaName: string | null;
  kind: LinkKind;
  statement: string;
  tieBand: string;
  opinionWeight: Grade;
  certainty: Certainty;
  source: string | null;
  asOf: Date;
}

/**
 * What is actually stopping this, computed rather than asserted.
 *
 * The distinction the reports keep making: a prospect who has never heard of us, one who
 * knows us and disagrees, one who likes us but cannot legally participate, and one who
 * would say yes in March, all look identical in a pipeline. They need different work.
 */
export type Blocker =
  | 'gated' | 'conviction' | 'access' | 'evidence' | 'fit' | 'timing' | 'awareness' | 'none';

export const BLOCKER_LABEL: Record<Blocker, string> = {
  gated: 'Excluded by a hard gate',
  access: 'No route in',
  evidence: 'We cannot qualify them yet',
  awareness: 'They do not know us',
  conviction: 'They know us and are not convinced',
  fit: 'The fit itself is weak',
  timing: 'Right firm, wrong window',
  none: 'Nothing is blocking this',
};

/** The same eight states, short enough for a table cell. The long form is the heading. */
export const BLOCKER_SHORT: Record<Blocker, string> = {
  gated: 'Gate fails',
  access: 'No route',
  evidence: 'Unqualified',
  awareness: 'Unaware of us',
  conviction: 'Not convinced',
  fit: 'Weak fit',
  timing: 'Wrong window',
  none: 'Clear',
};

export interface Diagnosis {
  blocker: Blocker;
  statement: string;
  /** What to do about it. One move, not a list. */
  nextMove: string;
}

export interface Assessment {
  assessmentId: string;
  entityId: string;
  entityName: string;
  vehicleId: string;
  vehicleName: string;
  exemption: string;
  ownerName: string | null;
  headline: string;
  updatedAt: Date;
  profile: FirmProfile | null;
  gates: Gate[];
  dimensions: Dimension[];
  values: ValueItem[];
  perceptions: Perception[];
  engagement: Engagement[];
  links: Link[];

  // ---- computed ----
  /** Any gate failed, or any gate unknown. An unknown gate is not a pass. */
  gateStatus: 'clear' | 'failed' | 'unknown';
  failedGates: Gate[];
  unknownGates: Gate[];
  /** A band, with the counts behind it. Deliberately not a single decimal. */
  band: 'strong' | 'workable' | 'weak' | 'blocked';
  strongCount: number;
  gradedCount: number;
  /** Weighted by importance to us, discounted by how much of it we actually know. */
  weightedFit: number;
  /** How much of the assessment rests on things we know rather than guessed. */
  evidenceCover: number;
  diagnosis: Diagnosis;
}
