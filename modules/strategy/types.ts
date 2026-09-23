export type LadderRung =
  | 'connector_willing' | 'target_opted_in' | 'meeting_held'
  | 'indication_given' | 'commitment_accepted' | 'cash_received';

/** In order. The order is the rule: there are no implicit transitions and no skipping. */
export const RUNGS: LadderRung[] = [
  'connector_willing', 'target_opted_in', 'meeting_held',
  'indication_given', 'commitment_accepted', 'cash_received',
];

export const RUNG_LABEL: Record<LadderRung, string> = {
  connector_willing: 'Connector willing',
  target_opted_in: 'Target opted in',
  meeting_held: 'Meeting held',
  indication_given: 'Indication given',
  commitment_accepted: 'Commitment accepted',
  cash_received: 'Cash received',
};

/** What evidence a rung requires. Stated so nobody has to infer it from a screenshot. */
export const RUNG_REQUIRES: Record<LadderRung, string> = {
  connector_willing: 'A record of the connector agreeing to ask. This says nothing about the target.',
  target_opted_in: 'A reply from the target, or from someone speaking for them. Not a connector relaying optimism.',
  meeting_held: 'A meeting that happened, with a date and who was in it.',
  indication_given: 'A number or a range, from them. An expression of enthusiasm is not an indication.',
  commitment_accepted: 'Signed and countersigned. This is the only step that moves a number from soft to hard.',
  cash_received: 'The wire landed. A separate state from the commitment, always.',
};

/**
 * Our pipeline stages (N46). Where the work is, finer than the ladder — adopted from how the
 * team already tracked the LP pipeline in Affinity, where the granularity earned its place.
 * Grouped, because a board wants five columns and a report wants twelve.
 *
 * `claims` is the ladder rung a stage implies. It is a claim: the ladder moves only on
 * evidence (RUNG_REQUIRES), and the stepper shows the two side by side.
 */
export type PursuitStage =
  | 'research' | 'targeted' | 'contacted' | 'responded' | 'scheduling'
  | 'first_meeting' | 'follow_up' | 'diligence' | 'docs_out'
  | 'soft_commit' | 'signed' | 'funded';

export type StageGroup = 'prospecting' | 'outreach' | 'engaged' | 'closing' | 'funded';

export interface StageInfo {
  id: PursuitStage;
  label: string;
  group: StageGroup;
  means: string;
  claims: LadderRung | null;
}

export const STAGES: StageInfo[] = [
  { id: 'research', label: 'To research', group: 'prospecting', means: 'On the list; not looked into yet.', claims: null },
  { id: 'targeted', label: 'Targeted', group: 'prospecting', means: 'Looked into, and worth approaching.', claims: null },
  { id: 'contacted', label: 'Contacted', group: 'outreach', means: 'We reached out. Nothing back from them yet.', claims: null },
  { id: 'responded', label: 'Responded', group: 'outreach', means: 'They wrote back and want to keep talking.', claims: 'target_opted_in' },
  { id: 'scheduling', label: 'Scheduling a first call', group: 'outreach', means: 'They agreed to talk; a time is being found.', claims: 'target_opted_in' },
  { id: 'first_meeting', label: 'First meeting held', group: 'engaged', means: 'One meeting has happened.', claims: 'meeting_held' },
  { id: 'follow_up', label: 'Two or more meetings', group: 'engaged', means: 'The conversation has continued past the first meeting.', claims: 'meeting_held' },
  { id: 'diligence', label: 'In diligence', group: 'engaged', means: 'They are working through the materials.', claims: 'meeting_held' },
  { id: 'docs_out', label: 'Documents sent', group: 'closing', means: 'Subscription documents are with them.', claims: 'meeting_held' },
  { id: 'soft_commit', label: 'Soft commit', group: 'closing', means: 'They named a number or a range. Soft until signed and countersigned.', claims: 'indication_given' },
  { id: 'signed', label: 'Signed', group: 'closing', means: 'They signed. Countersignature is for the close room to confirm; until then the money is soft.', claims: 'commitment_accepted' },
  { id: 'funded', label: 'Funded', group: 'funded', means: 'The wire landed.', claims: 'cash_received' },
];

export const STAGE_GROUP_LABEL: Record<StageGroup, string> = {
  prospecting: 'Prospecting', outreach: 'Outreach', engaged: 'Engaged', closing: 'Closing', funded: 'Funded',
};

/** How it ended, or that it has not. Separate from the stage: a pass can happen at any stage. */
export type PursuitOutcome = 'open' | 'paused' | 'passed' | 'lost';

export const OUTCOME_LABEL: Record<PursuitOutcome, string> = {
  open: 'Open', paused: 'On hold', passed: 'Passed', lost: 'Lost',
};

/** Why, when it ended. Words from the lists, normalized so they can be counted. */
export const REASONS = [
  'thesis', 'timing', 'valuation', 'structure', 'concentration', 'diligence', 'mandate', 'no_response', 'other',
] as const;
export type OutcomeReason = (typeof REASONS)[number];

export interface LadderEvent {
  eventId: string;
  rung: LadderRung;
  evidenceKind: string;
  evidenceRef: string;
  evidenceNote: string;
  recordedByName: string;
  occurredAt: Date;
}

export interface PlanStep {
  move: string;
  because: string;
  blockedBy?: string;
}

export interface Pursuit {
  pursuitId: string;
  entityId: string;
  entityName: string;
  vehicleId: string;
  vehicleName: string;
  ownerName: string;
  headline: string | null;
  plan: PlanStep[];
  openedAt: Date;
  closedAt: Date | null;
  events: LadderEvent[];
  /** Derived, never stored: the highest rung with an evidence record. */
  rung: LadderRung | null;
  /** The next rung up, and what it would need. */
  nextRung: LadderRung | null;
}

export function rungIndex(rung: LadderRung | null): number {
  return rung === null ? -1 : RUNGS.indexOf(rung);
}
