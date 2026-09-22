import { createHash } from 'node:crypto';
import { getDb } from '@/lib/db';
import type { ConnectionTest, LoggedRequest, RawRecordInput, RequestLogEntry, SyncRun } from './types';

export async function logRequest(e: RequestLogEntry): Promise<void> {
  const db = await getDb();
  await db.query(
    `insert into sources.request_log
       (source, endpoint, path, outcome, status, duration_ms, user_remaining, org_remaining, note)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [e.source, e.endpoint, e.path, e.outcome, e.status, e.durationMs, e.userRemaining, e.orgRemaining, e.note],
  );
}

export async function recentRequests(source: string, limit = 50): Promise<LoggedRequest[]> {
  const db = await getDb();
  const rows = await db.query<{
    id: string; at: Date | string; source: string; endpoint: string; path: string;
    outcome: LoggedRequest['outcome']; status: number | null; duration_ms: number | null;
    user_remaining: number | null; org_remaining: number | null; note: string | null;
  }>(
    `select id::text, at, source, endpoint, path, outcome, status, duration_ms,
            user_remaining, org_remaining, note
       from sources.request_log where source = $1 order by at desc, id desc limit $2`,
    [source, limit],
  );
  return rows.map((r) => ({
    id: Number(r.id), at: new Date(r.at), source: r.source, endpoint: r.endpoint, path: r.path,
    outcome: r.outcome, status: r.status, durationMs: r.duration_ms,
    userRemaining: r.user_remaining, orgRemaining: r.org_remaining, note: r.note,
  }));
}

/** Requests this source has been sent this calendar month (UTC), counted from our own log. */
export async function requestsThisMonth(source: string): Promise<number> {
  const db = await getDb();
  const row = await db.one<{ n: string }>(
    `select count(*)::text as n from sources.request_log
      where source = $1 and outcome in ('sent', 'rate_limited')
        and at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'`,
    [source],
  );
  return Number(row?.n ?? 0);
}

export async function recordConnectionTest(
  t: Omit<ConnectionTest, 'id' | 'at' | 'testedByName'> & { testedBy: string | null },
): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.query(
      `insert into sources.connection_test
         (source, ok, tested_by, tenant, key_user, grant_info, per_minute, per_month, tier, error)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        t.source, t.ok, t.testedBy, json(t.tenant), json(t.keyUser), json(t.grant),
        json(t.perMinute), json(t.perMonth), t.tier, t.error,
      ],
    );
    // Only the description changes. A connection test fetches no records, so it must not
    // mark the source synced — that would turn "nothing imported yet" into a green dot.
    await tx.query(
      `update platform.source_sync set detail = $2 where source = $1`,
      [t.source, t.ok ? `Read-only · connection tested, nothing imported · ${t.tier ?? 'tier unknown'}` : `Read-only · connection test failed: ${t.error ?? 'unknown error'}`],
    );
  });
}

export async function latestConnectionTest(source: string): Promise<ConnectionTest | null> {
  const db = await getDb();
  const r = await db.one<{
    id: string; at: Date | string; source: string; ok: boolean; tested_by_name: string | null;
    tenant: ConnectionTest['tenant']; key_user: ConnectionTest['keyUser']; grant_info: ConnectionTest['grant'];
    per_minute: ConnectionTest['perMinute']; per_month: ConnectionTest['perMonth'];
    tier: string | null; error: string | null;
  }>(
    `select t.id::text, t.at, t.source, t.ok, u.name as tested_by_name, t.tenant, t.key_user,
            t.grant_info, t.per_minute, t.per_month, t.tier, t.error
       from sources.connection_test t left join platform.app_user u on u.id = t.tested_by
      where t.source = $1 order by t.at desc, t.id desc limit 1`,
    [source],
  );
  if (!r) return null;
  return {
    id: Number(r.id), at: new Date(r.at), source: r.source, ok: r.ok, testedByName: r.tested_by_name,
    tenant: r.tenant, keyUser: r.key_user, grant: r.grant_info, perMinute: r.per_minute,
    perMonth: r.per_month, tier: r.tier, error: r.error,
  };
}

/** Land raw, idempotently. Returns true when this exact payload had not been seen before. */
export async function landRaw(r: RawRecordInput): Promise<boolean> {
  const db = await getDb();
  const hash = createHash('sha256').update(JSON.stringify(r.payload)).digest('hex').slice(0, 32);
  const rows = await db.query<{ id: string }>(
    `insert into sources.raw_record (source, kind, source_id, source_updated_at, payload_hash, payload)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (source, kind, source_id, payload_hash) do nothing
     returning id::text`,
    [r.source, r.kind, r.sourceId, r.sourceUpdatedAt, hash, JSON.stringify(r.payload)],
  );
  return rows.length > 0;
}

/** The newest payload of each record of one kind. */
export async function latestRaw<T>(source: string, kind: string): Promise<Array<{ sourceId: string; fetchedAt: Date; payload: T }>> {
  const db = await getDb();
  const rows = await db.query<{ source_id: string; fetched_at: Date | string; payload: T }>(
    `select distinct on (source_id) source_id, fetched_at, payload
       from sources.raw_record where source = $1 and kind = $2
      order by source_id, fetched_at desc, id desc`,
    [source, kind],
  );
  return rows.map((r) => ({ sourceId: r.source_id, fetchedAt: new Date(r.fetched_at), payload: r.payload }));
}

const json = (v: unknown) => (v === null || v === undefined ? null : JSON.stringify(v));

export async function startRun(source: string, kind: string, runBy: string | null): Promise<number> {
  const db = await getDb();
  const row = await db.one<{ id: string }>(
    `insert into sources.sync_run (source, kind, run_by) values ($1,$2,$3) returning id::text`,
    [source, kind, runBy],
  );
  return Number(row!.id);
}

export async function finishRun(
  id: number,
  r: { status: 'ok' | 'failed'; requests: number; records: number; newRecords: number; note: string | null },
): Promise<void> {
  const db = await getDb();
  await db.query(
    `update sources.sync_run set finished_at = now(), status = $2, requests = $3, records = $4,
            new_records = $5, note = $6 where id = $1`,
    [id, r.status, r.requests, r.records, r.newRecords, r.note],
  );
}

export async function latestRun(source: string, kind: string): Promise<SyncRun | null> {
  const db = await getDb();
  const r = await db.one<{
    id: string; source: string; kind: string; started_at: Date | string; finished_at: Date | string | null;
    status: SyncRun['status']; run_by_name: string | null; requests: number; records: number;
    new_records: number; note: string | null;
  }>(
    `select r.id::text, r.source, r.kind, r.started_at, r.finished_at, r.status, u.name as run_by_name,
            r.requests, r.records, r.new_records, r.note
       from sources.sync_run r left join platform.app_user u on u.id = r.run_by
      where r.source = $1 and r.kind = $2 order by r.started_at desc, r.id desc limit 1`,
    [source, kind],
  );
  if (!r) return null;
  return {
    id: Number(r.id), source: r.source, kind: r.kind, startedAt: new Date(r.started_at),
    finishedAt: r.finished_at ? new Date(r.finished_at) : null, status: r.status,
    runByName: r.run_by_name, requests: r.requests, records: r.records, newRecords: r.new_records, note: r.note,
  };
}
