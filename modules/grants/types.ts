export type FunderStatus = 'sourced' | 'invited' | 'applied' | 'awarded' | 'declined';

export const FUNDER_STATUS_LABEL: Record<FunderStatus, string> = {
  sourced: 'Sourced', invited: 'Invited', applied: 'Applied',
  awarded: 'Awarded', declined: 'Declined',
};

export interface Funder {
  funderId: string;
  entityId: string;
  entityName: string;
  programme: string;
  cycle: string | null;
  status: FunderStatus;
  invitationRef: string | null;
  invitedOn: Date | null;
  invitedBy: string | null;
  fitNote: string | null;
  ownerName: string | null;
  /** The gate, as a boolean anyone can read. */
  mayApproach: boolean;
}

export interface GrantGate {
  blocked: boolean;
  reason: string | null;
}
