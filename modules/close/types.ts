export type ConditionStatus = 'open' | 'satisfied' | 'waived' | 'failed';
export type PackStatus = 'not_sent' | 'sent' | 'returned' | 'countersigned';
export type SpvStage = 'invited' | 'ioi' | 'allocated' | 'wired' | 'passed';

export const SPV_STAGES: SpvStage[] = ['invited', 'ioi', 'allocated', 'wired'];

export const SPV_STAGE_LABEL: Record<SpvStage, string> = {
  invited: 'Invited',
  ioi: 'IOI given',
  allocated: 'Allocated',
  wired: 'Wired',
  passed: 'Passed',
};

export const PACK_LABEL: Record<PackStatus, string> = {
  not_sent: 'Not sent',
  sent: 'Sent',
  returned: 'Returned',
  countersigned: 'Countersigned',
};

export interface Cycle {
  cycleId: string;
  vehicleId: string;
  vehicleName: string;
  exemption: string;
  label: string;
  targetDate: Date;
  targetAmount: number | null;
  status: string;
  /** Working days left before the target date, holiday overlay applied. */
  workingDaysLeft: number | null;
}

export interface Condition {
  conditionId: string;
  cycleId: string;
  entityName: string | null;
  label: string;
  detail: string | null;
  ownerName: string | null;
  dueOn: Date | null;
  status: ConditionStatus;
  evidenceRef: string | null;
  compliance: boolean;
  overdue: boolean;
}

export interface PackItem {
  itemId: string;
  entityId: string;
  entityName: string;
  document: string;
  status: PackStatus;
  sentAt: Date | null;
  returnedAt: Date | null;
  countersignedAt: Date | null;
  note: string | null;
}

export interface SpvSeat {
  seatId: string;
  vehicleId: string;
  vehicleName: string;
  entityId: string;
  entityName: string;
  stage: SpvStage;
  amount: number | null;
  ownerName: string;
  invitedAt: Date;
  ioiAt: Date | null;
  allocatedAt: Date | null;
  wiredAt: Date | null;
  note: string | null;
  /** Days from invite to wire, or days elapsed so far if it has not wired. */
  days: number;
  wired: boolean;
}

export interface SpvRoom {
  vehicleId: string;
  vehicleName: string;
  target: number | null;
  seats: SpvSeat[];
  allocated: number;
  wired: number;
  /** The headline. Median days from invite to wire, over seats that actually wired. */
  daysToWire: number | null;
  oldestOpenDays: number;
}

/** Someone whose attention is split between an SPV clock and a fund close. */
export interface BandwidthAlert {
  kind: 'owner' | 'investor';
  name: string;
  detail: string;
}
