export type Audience =
  | 'lp_memo' | 'grant_framing' | 'public_primer' | 'seminar_outline'
  | 'social_post' | 'video_script' | 'ddq_response';

export type PermittedUse = 'public' | 'accredited_only' | 'internal';
export type AssetStatus = 'draft' | 'approved' | 'needs_refresh' | 'withdrawn';
export type SendStatus = 'proposed' | 'approved' | 'sent' | 'refused';

export const AUDIENCE_LABEL: Record<Audience, string> = {
  lp_memo: 'LP memo',
  grant_framing: 'Grant framing',
  public_primer: 'Public primer',
  seminar_outline: 'Seminar outline',
  social_post: 'Social post',
  video_script: 'Video script',
  ddq_response: 'DDQ response',
};

export const USE_LABEL: Record<PermittedUse, string> = {
  public: 'Public',
  accredited_only: 'Accredited only',
  internal: 'Internal',
};

/** public ⊃ accredited_only ⊃ internal. A higher number travels further. */
export const USE_RANK: Record<PermittedUse, number> = {
  internal: 0,
  accredited_only: 1,
  public: 2,
};

export interface Asset {
  assetId: string;
  title: string;
  parentId: string | null;
  audience: Audience | null;
  vehicleId: string | null;
  vehicleName: string | null;
  version: number;
  ownerName: string;
  permittedUse: PermittedUse;
  summary: string;
  body: string;
  status: AssetStatus;
  approvedAt: Date | null;
  /** Claims this asset rests on. */
  claims: Array<{ claimId: string; field: string; value: string; source: string; entityName: string }>;
  /** Open refresh flags — a claim underneath it changed. */
  flags: Array<{ flagId: string; reason: string; flaggedAt: Date }>;
}

export interface WrapRule {
  ruleId: string;
  exemption: string;
  instrument: string;
  allowedAudiences: Audience[];
  maxPermittedUse: PermittedUse;
  note: string;
}

export interface WrapCheck {
  allowed: boolean;
  rule: WrapRule | null;
  /** Every reason it failed, not just the first. */
  refusals: string[];
}

export interface Send {
  sendId: string;
  assetTitle: string;
  audience: Audience | null;
  entityName: string;
  vehicleName: string;
  instrument: string;
  status: SendStatus;
  ticketId: string | null;
  requestedByName: string;
  refusal: string | null;
  requestedAt: Date;
  sentAt: Date | null;
}
