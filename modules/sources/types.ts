export type RequestOutcome = 'sent' | 'refused' | 'network_error' | 'rate_limited';

export interface RequestLogEntry {
  source: string;
  endpoint: string;
  path: string;
  outcome: RequestOutcome;
  status: number | null;
  durationMs: number | null;
  userRemaining: number | null;
  orgRemaining: number | null;
  note: string | null;
}

export interface LoggedRequest extends RequestLogEntry {
  id: number;
  at: Date;
}

export interface RateWindow {
  limit: number;
  remaining: number;
  /** Seconds until the window resets, as the source reported it when it was read. */
  reset: number;
  used: number;
}

export interface ConnectionTest {
  id: number;
  at: Date;
  source: string;
  ok: boolean;
  testedByName: string | null;
  tenant: { id: number; name: string; subdomain: string } | null;
  keyUser: { id: number; firstName: string; lastName: string | null; emailAddress: string } | null;
  grant: { type: string; scopes: string[]; createdAt: string } | null;
  perMinute: RateWindow | null;
  /** Null when the account has no monthly cap. */
  perMonth: RateWindow | null;
  tier: string | null;
  error: string | null;
}

export interface RawRecordInput {
  source: string;
  kind: string;
  sourceId: string;
  sourceUpdatedAt: Date | null;
  payload: unknown;
}

export interface SyncRun {
  id: number;
  source: string;
  kind: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: 'running' | 'ok' | 'failed' | 'held';
  runByName: string | null;
  requests: number;
  records: number;
  newRecords: number;
  note: string | null;
  detail: Record<string, unknown>;
}
