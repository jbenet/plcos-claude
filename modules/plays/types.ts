export type Lever =
  | 'source' | 'enrich' | 'segment' | 'materials' | 'reach'
  | 'route' | 'convince' | 'validate' | 'convene' | 'process' | 'ask';

export type Horizon = 'now' | 'compounding';
export type PlayStatus = 'proposed' | 'assigned' | 'committed' | 'done' | 'dropped';
export type NeedKind =
  | 'know_domain' | 'know_us' | 'believe_returns' | 'believe_access'
  | 'validation' | 'mechanics' | 'timing' | 'permission';

export const LEVER_LABEL: Record<Lever, string> = {
  source: 'Source', enrich: 'Enrich', segment: 'Segment', materials: 'Materials',
  reach: 'Reach', route: 'Route', convince: 'Convince', validate: 'Validate',
  convene: 'Convene', process: 'Process', ask: 'Ask',
};

/** What each lever is for, so a board full of verbs still says what it means. */
export const LEVER_MEANS: Record<Lever, string> = {
  source: 'Add names to the universe. The only lever that changes the denominator.',
  enrich: 'Learn more about names we already have, so the rest of the board can be aimed.',
  segment: 'Go after a specific better-fitting slice rather than the universe.',
  materials: 'Make what we send clearer or more credible. Fixes the same problem for everyone it reaches.',
  reach: 'Be findable without a route. The slowest lever and the only one that works while you sleep.',
  route: 'Find a warm path to a specific target.',
  convince: 'Answer a stated objection with evidence. Useless before somebody has stated one.',
  validate: 'Third-party proof we cannot supply about ourselves.',
  convene: 'Events, workshops, podcasts. Relationship at low pressure.',
  process: 'Our own machinery: verification, close mechanics, operations.',
  ask: 'Make the ask, advance the rung. The lever that converts and the one that spends goodwill.',
};

export const HORIZON_LABEL: Record<Horizon, string> = {
  now: 'What to do next',
  compounding: 'What compounds',
};

export const STATUS_LABEL: Record<PlayStatus, string> = {
  proposed: 'Proposed', assigned: 'Assigned', committed: 'Committed',
  done: 'Done', dropped: 'Dropped',
};

export const NEED_LABEL: Record<NeedKind, string> = {
  know_domain: 'Understand the field',
  know_us: 'Know who we are',
  believe_returns: 'Believe the returns',
  believe_access: 'Believe we get the deals',
  validation: 'Hear it from someone they trust',
  mechanics: 'Be satisfied on structure',
  timing: 'Be in their own window',
  permission: 'Have permission to do it',
};

/** What each need calls for. This is the bridge from diagnosis to action. */
export const NEED_CALLS_FOR: Record<NeedKind, string> = {
  know_domain: 'Primers, a walkthrough, a podcast episode. Material that teaches rather than sells.',
  know_us: 'Who we are and what we have done. A visit, if the cheque justifies one.',
  believe_returns: 'Evidence about the asset class, not about us. Comparable outcomes and why they happened.',
  believe_access: 'Proof of deal access: what we have been let into, and who let us in.',
  validation: 'A person they already trust, saying it. Nothing we write substitutes.',
  mechanics: 'Terms, fees, valuation policy, verification route. Answers, in writing.',
  timing: 'Patience and a dated return. Pressure here converts nothing and costs goodwill.',
  permission: 'Find out what the mandate actually permits before spending anything else.',
};

export interface Play {
  playId: string;
  vehicleId: string;
  vehicleName: string;
  entityId: string | null;
  entityName: string | null;
  horizon: Horizon;
  lever: Lever;
  title: string;
  detail: string;
  because: string;
  likelihood: number;
  effortDays: number;
  reach: number;
  payoff: string;
  certainty: string;
  suggestedOwner: string | null;
  suggestedOwnerId: string | null;
  status: PlayStatus;
  assignedTo: string | null;
  assignedAt: Date | null;
  gate: string | null;
  /**
   * Derived: (likelihood ÷ 5) × reach ÷ person-days. It is a rate — expected movement per
   * day of somebody's life — and it is shown with its three inputs beside it rather than
   * on its own, because on its own it is a number nobody can argue with.
   */
  leverage: number;
  /** True when this play's lever answers a reading the assessment scored weak. */
  answersWeakness: boolean;
}

export interface Need {
  needId: string;
  entityId: string;
  entityName: string;
  kind: NeedKind;
  statement: string;
  evidence: string;
  met: boolean | null;
  source: string | null;
  asOf: Date;
}

export interface Commitment {
  commitmentId: string;
  vehicleId: string;
  entityId: string | null;
  entityName: string | null;
  body: string;
  writtenByName: string;
  writtenAt: Date;
  parsed: { lines: string[]; owners: string[]; dates: string[] } | null;
  handoff: Handoff | null;
}

export interface Handoff {
  handoffId: string;
  provider: string;
  payload: Record<string, unknown>;
  state: string;
  externalRef: string | null;
  note: string | null;
  createdAt: Date;
}

export type Verdict = 'strong' | 'ok' | 'weak' | 'unknown';

export const VERDICT_LABEL: Record<Verdict, string> = {
  strong: 'Holding', ok: 'Adequate', weak: 'Weak', unknown: 'Not measured',
};

/** One reading in the status assessment. */
export interface Reading {
  key: string;
  group: string;
  label: string;
  value: string;
  verdict: Verdict;
  /** What the number means, and what it does not. */
  detail: string;
  /** The levers that would move this reading. */
  levers: Lever[];
}

export interface Assessment {
  vehicleId: string;
  vehicleName: string;
  exemption: string;
  /** Days to the close target, when there is one. Shapes which horizon is worth reading. */
  daysToClose: number | null;
  readings: Reading[];
  weakLevers: Lever[];
  /** Two or three sentences, composed from the weakest readings. */
  diagnosis: string[];
}
