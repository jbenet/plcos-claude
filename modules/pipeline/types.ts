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
