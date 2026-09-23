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
  target_opted_in: 'LP opted in',
  meeting_held: 'Meeting held',
  indication_given: 'Indication given',
  commitment_accepted: 'Commitment accepted',
  cash_received: 'Cash received',
};

/** What evidence a rung requires. Stated so nobody has to infer it from a screenshot. */
export const RUNG_REQUIRES: Record<LadderRung, string> = {
  connector_willing: 'A record of the connector agreeing to ask. This says nothing about the target.',
  target_opted_in: 'A reply from the LP, or from someone speaking for them. Not a connector relaying optimism.',
  meeting_held: 'A meeting that happened, with a date and who was in it.',
  indication_given: 'A number or a range, from them. An expression of enthusiasm is not an indication.',
  commitment_accepted: 'Signed and countersigned. This is the only step that moves a number from soft to hard.',
  cash_received: 'The wire landed. A separate state from the commitment, always.',
};

/**
 * The pipeline status (N50, docs/17): where our effort is with an LP, on one vehicle. Six
 * values, set by a person, able to move in any direction — the history is in the audit log.
 * What happened lives elsewhere: the dated touchpoints, the close track, and the ladder, which
 * is still the only place a claim about the LP is made. A status claims nothing, so it moves
 * the ladder never and needs no ticket.
 */
export type PursuitStatus = 'new' | 'sourcing' | 'selected' | 'discussing' | 'committed' | 'passed';

export interface StatusInfo {
  id: PursuitStatus;
  label: string;
  means: string;
}

export const STATUSES: StatusInfo[] = [
  { id: 'new', label: 'New', means: 'On the list. Nobody has researched them or reached out.' },
  { id: 'sourcing', label: 'Sourcing', means: 'Picked to research, enrich, or find a way in. Research can happen at any status; this one says it is the work right now.' },
  { id: 'selected', label: 'Selected', means: 'We have decided to approach. Outreach is next, or under way with no reply yet.' },
  { id: 'discussing', label: 'Discussing', means: 'They have engaged: a reply, a call being set, any number of meetings.' },
  { id: 'committed', label: 'Committed', means: 'They said yes, with an amount. How far the money has got is the close track, not this.' },
  { id: 'passed', label: 'Passed', means: 'Off, for now. Who ended it and why are kept, and it can reopen.' },
];

export const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.id, s.label])) as Record<PursuitStatus, string>;

/**
 * Who ended it: they declined, or we stopped. Silence is not an ending (N53, Juan, 23 Sep): an
 * LP who never replied is still Selected, and the log says how long we have been waiting.
 * 'quiet' is still read, for a pursuit that was set that way before; it is no longer offered.
 */
export type PassedBy = 'them' | 'us' | 'quiet';
export const PASSED_BY_LABEL: Record<PassedBy, string> = {
  them: 'They declined', us: 'We stopped', quiet: 'It went quiet',
};
export const PASSED_BY_CHOICES: PassedBy[] = ['them', 'us'];

/** Why, when it passed. Words from the lists, normalized so they can be counted. */
export const REASONS = [
  'thesis', 'timing', 'valuation', 'structure', 'concentration', 'diligence', 'mandate', 'no_response',
  'do_not_contact', 'other',
] as const;
export type OutcomeReason = (typeof REASONS)[number];

/**
 * What a source's status word says happened, with no date: "Two meetings held" is met_twice.
 * Kept beside the log and the ladder as a claim — the rung it would be evidence for, if it
 * were evidence — and never written into either (docs/17).
 */
export type Implied =
  | 'reached_out' | 'replied' | 'meeting_agreed' | 'met' | 'met_twice' | 'diligence'
  | 'docs_sent' | 'soft' | 'signed' | 'wired';

export const IMPLIED: Array<{ id: Implied; label: string; claims: LadderRung | null }> = [
  { id: 'reached_out', label: 'we reached out', claims: null },
  { id: 'replied', label: 'they replied', claims: 'target_opted_in' },
  { id: 'meeting_agreed', label: 'a meeting was agreed', claims: 'target_opted_in' },
  { id: 'met', label: 'a meeting was held', claims: 'meeting_held' },
  { id: 'met_twice', label: 'two or more meetings', claims: 'meeting_held' },
  { id: 'diligence', label: 'in diligence', claims: 'meeting_held' },
  { id: 'docs_sent', label: 'documents sent', claims: 'meeting_held' },
  { id: 'soft', label: 'a soft commitment', claims: 'indication_given' },
  { id: 'signed', label: 'signed', claims: 'commitment_accepted' },
  { id: 'wired', label: 'wired', claims: 'cash_received' },
];
export const IMPLIED_LABEL = Object.fromEntries(IMPLIED.map((x) => [x.id, x.label])) as Record<Implied, string>;

/** The highest rung a set of implied facts would claim, if any of them were evidence. */
export function impliedRung(implied: readonly string[]): LadderRung | null {
  let best: LadderRung | null = null;
  for (const x of IMPLIED) if (implied.includes(x.id) && x.claims && rungIndex(x.claims) > rungIndex(best)) best = x.claims;
  return best;
}

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
  /** Where our effort is (N50). Set by a person, or read from a source until one does. */
  status: PursuitStatus;
  /** Why it passed, or a line about the status. */
  statusReason: string | null;
  passedBy: PassedBy | null;
  /** 'us' once a person set it here; otherwise the source it was read from. */
  statusSource: string;
  /** What the source's word reads as, kept after a person sets the status — so they can differ. */
  statusSaid: PursuitStatus | null;
  statusSetAt: Date | null;
  statusSetByName: string | null;
  /** What the source's word says happened, undated — claims, never evidence. */
  implied: Implied[];
  nextStep: string | null;
  nextStepOn: Date | null;
  /** 'us', or the system the pursuit was read from — 'affinity' — with what it said and when. */
  source: string;
  sourceAsOf: Date | null;
  /** The source's own word for where they are ("Two meetings held"). */
  stageSaid: string | null;
  /** The owner as the source names them, when that person is not on the team. */
  ownerSaid: string | null;
  /** On a vehicle kept for its history. */
  historical: boolean;
}

export function rungIndex(rung: LadderRung | null): number {
  return rung === null ? -1 : RUNGS.indexOf(rung);
}
