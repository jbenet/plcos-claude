export type AskStatus = 'proposed' | 'blocked' | 'approved' | 'made' | 'answered' | 'withdrawn';
export type AskOutcome = 'opted_in' | 'declined' | 'no_reply' | 'deferred';
export type ConflictStatus = 'open' | 'adjudicated' | 'withdrawn';
export type ConflictReason =
  | 'closer_to_close' | 'stronger_fit' | 'owner_relationship' | 'vehicle_priority' | 'target_preference';

export const REASON_LABEL: Record<ConflictReason, string> = {
  closer_to_close: 'Closer to a close',
  stronger_fit: 'Stronger mandate fit',
  owner_relationship: 'Owner holds the relationship',
  vehicle_priority: 'Vehicle priority this quarter',
  target_preference: 'The target asked for it this way',
};

export const RULE_LABEL: Record<GuardBlock['rule'], string> = {
  relationship_frequency: 'Frequency',
  connector_load: 'Connector load',
  cross_vehicle_conflict: 'Cross-vehicle',
  non_circumvention: 'Non-circumvention',
  no_unsolicited_grant: 'No unsolicited grant',
};

export interface Ask {
  askId: string;
  entityId: string;
  entityName: string;
  connectorId: string | null;
  connectorName: string | null;
  vehicleId: string;
  vehicleName: string;
  status: AskStatus;
  ownerName: string;
  ticketId: string | null;
  purpose: string;
  scheduledFor: Date | null;
  madeAt: Date | null;
  channel: string | null;
  outcome: AskOutcome | null;
  outcomeNote: string | null;
  overrideReason: string | null;
  createdAt: Date;
}

export interface ConflictCase {
  caseId: string;
  entityId: string;
  entityName: string;
  windowDays: number;
  status: ConflictStatus;
  openedAt: Date;
  claimantA: Ask;
  claimantB: Ask;
  winnerAskId: string | null;
  loserAskId: string | null;
  reasonCode: ConflictReason | null;
  loserFollowupAt: Date | null;
  adjudicatedByName: string | null;
  adjudicatedAt: Date | null;
  note: string | null;
}

export interface Restriction {
  restrictionId: string;
  entityId: string;
  entityName: string;
  scope: 'connector' | 'channel' | 'blanket';
  connectorId: string | null;
  connectorName: string | null;
  channel: string | null;
  instruction: string;
  source: string | null;
  recordedByName: string | null;
  recordedAt: Date;
}

/** One block per rule that refused, each carrying what it looked at. */
export interface GuardBlock {
  rule:
    | 'relationship_frequency'
    | 'connector_load'
    | 'cross_vehicle_conflict'
    | 'non_circumvention'
    | 'no_unsolicited_grant';
  message: string;
  evidence: string;
  /** A conflict opens a case; the others simply refuse. */
  opensCase: boolean;
  /**
   * Set when this block is the same collision as another one, counted twice (issue 0004).
   * The frequency cap is across vehicles, so every cross-vehicle conflict also trips it —
   * listing both makes one problem look like two and makes the report read as worse than
   * the situation is.
   */
  subsumedBy?: GuardBlock['rule'];
}

export interface GuardReport {
  ok: boolean;
  blocks: GuardBlock[];
  /** What the guard inspected, so an empty block list is not read as "nothing to find". */
  inspected: string;
}
