import { getDb, type Queryable } from '@/lib/db';
import type { AppUser, AuditEntry, Feedback, FeedbackInput, SourceSync, Vehicle } from './types';

type UserRow = {
  id: string; handle: string; name: string; initials: string; role: string; email: string;
};
const toUser = (r: UserRow): AppUser => r;

export async function listUsers(): Promise<AppUser[]> {
  const db = await getDb();
  const rows = await db.query<UserRow>(
    'select id, handle, name, initials, role, email from platform.app_user where active order by created_at',
  );
  return rows.map(toUser);
}

/**
 * A person who can act here. Inactive rows — the system's own actor for reconciliation's
 * proposals (N57) — are not found, so nobody can switch to one and approve what it asked.
 */
export async function getUserByHandle(handle: string): Promise<AppUser | null> {
  const db = await getDb();
  const row = await db.one<UserRow>(
    'select id, handle, name, initials, role, email from platform.app_user where handle = $1 and active',
    [handle],
  );
  return row ? toUser(row) : null;
}

type VehicleRow = {
  id: string; slug: string; name: string; kind: Vehicle['kind'];
  exemption: string; target_amount: string | null; sort_order: number; phase: Vehicle['phase'];
};

export async function listVehicles(): Promise<Vehicle[]> {
  const db = await getDb();
  const rows = await db.query<VehicleRow>(
    'select id, slug, name, kind, exemption, target_amount, sort_order, phase from platform.vehicle order by sort_order',
  );
  return rows.map((r) => ({
    id: r.id, slug: r.slug, name: r.name, kind: r.kind, exemption: r.exemption,
    targetAmount: r.target_amount === null ? null : Number(r.target_amount),
    sortOrder: r.sort_order, phase: r.phase,
  }));
}

type SyncRow = {
  source: string; label: string; status: SourceSync['status'];
  last_sync_at: Date | string | null; detail: string | null;
};

export async function listSyncSources(): Promise<SourceSync[]> {
  const db = await getDb();
  const rows = await db.query<SyncRow>(
    'select source, label, status, last_sync_at, detail from platform.source_sync order by label',
  );
  return rows.map((r) => ({
    source: r.source, label: r.label, status: r.status, detail: r.detail,
    lastSyncAt: r.last_sync_at ? new Date(r.last_sync_at) : null,
  }));
}

export async function insertFeedback(input: FeedbackInput): Promise<Feedback> {
  const db = await getDb();
  const row = await db.one<{ id: string; created_at: Date | string }>(
    `insert into platform.feedback (title, body, kind, priority, reporter_id, page, labels, context)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, created_at`,
    [input.title, input.body, input.kind, input.priority, input.reporterId, input.page,
     input.labels, JSON.stringify(input.context)],
  );
  if (!row) throw new Error('feedback insert returned no row');
  return { ...input, id: row.id, issueRef: null, issuePath: null, status: 'open', createdAt: new Date(row.created_at) };
}

export async function attachIssueRef(id: string, ref: string, path: string): Promise<void> {
  const db = await getDb();
  await db.query('update platform.feedback set issue_ref = $2, issue_path = $3 where id = $1', [id, ref, path]);
}

/**
 * Append one audit row.
 *
 * Takes an optional `Queryable` so a caller can write the row inside the same transaction
 * as the thing it describes. An audit entry committed separately from its own event is an
 * audit entry that can survive a rollback, which is the one thing an append-only log must
 * never do.
 */
export async function appendAudit(entry: AuditEntry, q?: Queryable): Promise<void> {
  const db = q ?? (await getDb());
  await db.query(
    `insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
     values ($1,$2,$3,$4,$5)`,
    [entry.actorId, entry.action, entry.subjectType, entry.subjectId ?? null, JSON.stringify(entry.detail ?? {})],
  );
}

export async function recentAudit(limit = 20) {
  const db = await getDb();
  return db.query<{ at: Date | string; action: string; subject_type: string; subject_id: string | null; name: string | null }>(
    `select a.at, a.action, a.subject_type, a.subject_id, u.name
       from platform.audit_log a left join platform.app_user u on u.id = a.actor_id
      order by a.at desc limit $1`,
    [limit],
  );
}

export interface FeedbackRow {
  id: string;
  issueRef: string | null;
  issuePath: string | null;
  title: string;
  body: string;
  kind: string;
  priority: string;
  status: string;
  reporterName: string;
  page: string;
  context: Record<string, unknown>;
  createdAt: Date;
}

/**
 * The feedback rows, which are not the same thing as the issue files.
 *
 * The row is the record that somebody complained, with the context captured at that
 * moment. The file is the tracker. They are written together and can be read apart — the
 * row survives `git checkout`, the file survives `npm run db:reset`.
 */
export async function listFeedback(): Promise<FeedbackRow[]> {
  const db = await getDb();
  const rows = await db.query<{
    id: string; issue_ref: string | null; issue_path: string | null; title: string;
    body: string; kind: string; priority: string; status: string; reporter_name: string;
    page: string; context: Record<string, unknown>; created_at: Date | string;
  }>(
    `select f.id, f.issue_ref, f.issue_path, f.title, f.body, f.kind::text as kind,
            f.priority::text as priority, f.status::text as status, u.name as reporter_name,
            f.page, f.context, f.created_at
       from platform.feedback f join platform.app_user u on u.id = f.reporter_id
      order by f.created_at desc`,
  );
  return rows.map((r) => ({
    id: r.id, issueRef: r.issue_ref, issuePath: r.issue_path, title: r.title, body: r.body,
    kind: r.kind, priority: r.priority, status: r.status, reporterName: r.reporter_name,
    page: r.page, context: r.context ?? {}, createdAt: new Date(r.created_at),
  }));
}

export interface AuditRow {
  at: Date;
  action: string;
  subjectType: string;
  subjectId: string | null;
  actor: string | null;
  detail: Record<string, unknown>;
}

export async function auditLog(limit = 200): Promise<AuditRow[]> {
  const db = await getDb();
  const rows = await db.query<{
    at: Date | string; action: string; subject_type: string; subject_id: string | null;
    name: string | null; detail: Record<string, unknown>;
  }>(
    `select a.at, a.action, a.subject_type, a.subject_id, u.name, a.detail
       from platform.audit_log a left join platform.app_user u on u.id = a.actor_id
      order by a.at desc limit $1`,
    [limit],
  );
  return rows.map((r) => ({
    at: new Date(r.at), action: r.action, subjectType: r.subject_type,
    subjectId: r.subject_id, actor: r.name, detail: r.detail ?? {},
  }));
}
