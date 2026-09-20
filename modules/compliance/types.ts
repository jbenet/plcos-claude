export type Channel = 'website' | 'deck' | 'email' | 'podcast' | 'conference' | 'social' | 'press';
export type ClaimStatus = 'in_use' | 'needs_review' | 'withdrawn';
export type VerificationMethod =
  | 'income' | 'net_worth' | 'third_party_letter' | 'registered_professional' | 'self_certified' | 'none';
export type VerificationStatus =
  | 'not_started' | 'requested' | 'received' | 'verified' | 'failed' | 'not_required';

export const METHOD_LABEL: Record<VerificationMethod, string> = {
  income: 'Income evidence',
  net_worth: 'Net-worth evidence',
  third_party_letter: 'Third-party letter',
  registered_professional: 'Registered professional',
  self_certified: 'Self-certified',
  none: 'None',
};

export const STATUS_LABEL: Record<VerificationStatus, string> = {
  not_started: 'Not started',
  requested: 'Requested',
  received: 'Received, not checked',
  verified: 'Verified',
  failed: 'Failed',
  not_required: 'Not required',
};

/** Self-certification is a method, and it is never reasonable steps under 506(c). */
export const INSUFFICIENT_FOR_506C: VerificationMethod[] = ['self_certified', 'none'];

export interface PublicClaim {
  claimId: string;
  statement: string;
  channel: Channel;
  assetTitle: string | null;
  vehicleName: string | null;
  firstUsedOn: Date;
  substantiation: string;
  substantiationRef: string | null;
  reviewedByName: string | null;
  reviewedOn: Date | null;
  status: ClaimStatus;
}

export interface AccreditationRecord {
  recordId: string;
  entityId: string;
  entityName: string;
  vehicleId: string;
  vehicleName: string;
  exemption: string;
  method: VerificationMethod;
  status: VerificationStatus;
  evidenceRef: string | null;
  verifiedByName: string | null;
  verifiedOn: Date | null;
  expiresOn: Date | null;
  note: string | null;
  /** True when this record satisfies the vehicle's exemption. */
  sufficient: boolean;
  why: string;
}

export interface SolicitationEvent {
  eventId: string;
  vehicleName: string;
  exemption: string;
  channel: Channel;
  audience: string;
  occurredOn: Date;
  assetTitle: string | null;
  recordedByName: string;
  note: string | null;
  /** A 506(b) vehicle appearing in this log at all is an incident. */
  incident: boolean;
}

export interface SideLetter {
  letterId: string;
  entityName: string;
  vehicleName: string;
  provision: string;
  mfn: boolean;
  risk: string;
  signedOn: Date | null;
  reviewedByName: string | null;
}

export interface AccreditationGate {
  ok: boolean;
  reason: string | null;
}
