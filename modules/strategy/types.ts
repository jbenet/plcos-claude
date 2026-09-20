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
