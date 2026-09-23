export type Instrument = 'lp_commitment' | 'spv' | 'grant' | 'pri' | 'mri' | 'direct';
export type Track = 'soft' | 'hard';

export const INSTRUMENT_LABEL: Record<Instrument, string> = {
  lp_commitment: 'LP commitment',
  spv: 'SPV',
  grant: 'Grant',
  pri: 'PRI',
  mri: 'MRI',
  direct: 'Direct',
};

export interface Exposure {
  exposureId: string;
  entityId: string;
  entityName: string;
  vehicleId: string;
  vehicleName: string;
  vehicleSlug: string;
  instrument: Instrument;
  track: Track;
  amount: number;
  probability: number | null;
  ownerName: string;
  evidenceRef: string | null;
  hardenedAt: Date | null;
  cashReceivedAt: Date | null;
  openedAt: Date;
  /** 'us', or the system the amount was read from, with when and what it said (rule 9). */
  source: string;
  sourceAsOf: Date | null;
  claim: string | null;
}

/**
 * Per vehicle. There is deliberately no field on this object that adds soft to hard, and
 * no object anywhere that adds across vehicles.
 */
export interface VehicleTotals {
  vehicleId: string;
  vehicleSlug: string;
  vehicleName: string;
  kind: string;
  exemption: string;
  /** Kept for its history (N45): its numbers are the past, not the raise. */
  historical: boolean;
  target: number | null;
  /** Signed and countersigned. The only number that appears in a headline. */
  hard: number;
  /** Cash actually received. A subset of hard, and a different state. */
  cash: number;
  /** Indications and expressions. Never added to hard. */
  soft: number;
  /** Σ soft × P(commit). Shown, never added. */
  convertibleSoft: number;
  softCount: number;
  hardCount: number;
  /** (hard + soft) ÷ target. A pipeline measure, not a money measure. */
  coverage: number | null;
  gapToTarget: number | null;
}

export interface PoolCheck {
  entityId: string;
  entityName: string;
  budget: number | null;
  budgetSource: string | null;
  budgetVerified: boolean;
  /** Every exposure this actor has, across every vehicle. */
  committed: Array<{ vehicleName: string; track: Track; amount: number }>;
  total: number;
  over: number;
  status: 'ok' | 'over' | 'unverified' | 'no_budget';
}

// ---------------------------------------------------------------- the close track (N52)

export type CommitmentStep = 'soft' | 'signed' | 'resigned' | 'countersigned' | 'closed' | 'wired' | 'withdrawn';

export const STEP_LABEL: Record<CommitmentStep, string> = {
  soft: 'Soft commitment', signed: 'Signed', resigned: 'Signed again', countersigned: 'Countersigned — hard',
  closed: 'Closed', wired: 'Wired', withdrawn: 'Withdrawn',
};

export interface CommitmentEvent {
  eventId: string;
  exposureId: string;
  step: CommitmentStep;
  /** Null when the source did not say. */
  on: Date | null;
  amount: number | null;
  document: string | null;
  reason: string | null;
  reference: string | null;
  /** 'us' when recorded here; otherwise the source whose claim it is. */
  source: string;
  recordedByName: string | null;
  recordedAt: Date;
}

/** Derived from the events, never stored: soft → signed → hard → closed, or withdrawn. */
export type CloseState = 'soft' | 'signed' | 'hard' | 'closed' | 'withdrawn';

export const CLOSE_STATES: CloseState[] = ['soft', 'signed', 'hard', 'closed'];
export const CLOSE_STATE_LABEL: Record<CloseState, string> = {
  soft: 'Soft', signed: 'Signed', hard: 'Hard', closed: 'Closed', withdrawn: 'Withdrawn',
};

export interface CloseTrack {
  exposure: Exposure;
  state: CloseState;
  /** Oldest first. */
  events: CommitmentEvent[];
  /** The latest signature: when (null if undated), and whether it is only a source's claim. */
  signature: { on: Date | null; bySource: string; document: string | null } | null;
  /** Signatures after the first: re-signed documents, each with its reason. */
  resigned: number;
  closedOn: Date | null;
  /** Wires recorded here, and their total. A source's "wired" is a claim, listed apart. */
  wires: Array<{ on: Date | null; amount: number }>;
  wired: number;
  wiredPerSource: boolean;
  /** Commitment less what has wired, once hard. */
  outstanding: number | null;
}
