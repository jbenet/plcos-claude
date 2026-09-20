export interface AppUser {
  id: string;
  handle: string;
  name: string;
  initials: string;
  role: string;
  email: string;
}

export type VehicleKind = 'fund' | 'spv' | 'grant_rail';

export interface Vehicle {
  id: string;
  slug: string;
  name: string;
  kind: VehicleKind;
  /** '506(c)' or '506(b)'. Decides what may be said in public material. */
  exemption: string;
  targetAmount: number | null;
  sortOrder: number;
}

export type SyncStatus = 'ok' | 'stale' | 'failed' | 'not_connected';

export interface SourceSync {
  source: string;
  label: string;
  status: SyncStatus;
  lastSyncAt: Date | null;
  detail: string | null;
}

export type FeedbackKind = 'bug' | 'request' | 'question' | 'chore';
export type FeedbackPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type FeedbackStatus = 'open' | 'triaged' | 'agent-ready' | 'in-progress' | 'review' | 'done';

export interface FeedbackInput {
  title: string;
  body: string;
  kind: FeedbackKind;
  priority: FeedbackPriority;
  reporterId: string;
  page: string;
  labels: string[];
  context: Record<string, unknown>;
}

export interface Feedback extends FeedbackInput {
  id: string;
  issueRef: string | null;
  issuePath: string | null;
  status: FeedbackStatus;
  createdAt: Date;
}

export interface AuditEntry {
  actorId: string | null;
  action: string;
  subjectType: string;
  subjectId?: string | null;
  detail?: Record<string, unknown>;
}
