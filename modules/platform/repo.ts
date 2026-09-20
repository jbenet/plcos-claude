import { getDb } from '@/lib/db';
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

export async function getUserByHandle(handle: string): Promise<AppUser | null> {
  const db = await getDb();
  const row = await db.one<UserRow>(
    'select id, handle, name, initials, role, email from platform.app_user where handle = $1',
    [handle],
  );
  return row ? toUser(row) : null;
}

type VehicleRow = {
  id: string; slug: string; name: string; kind: Vehicle['kind'];
  exemption: string; target_amount: string | null; sort_order: number;
};

export async function listVehicles(): Promise<Vehicle[]> {
  const db = await getDb();
  const rows = await db.query<VehicleRow>(
    'select id, slug, name, kind, exemption, target_amount, sort_order from platform.vehicle order by sort_order',
  );
  return rows.map((r) => ({
    id: r.id, slug: r.slug, name: r.name, kind: r.kind, exemption: r.exemption,
    targetAmount: r.target_amount === null ? null : Number(r.target_amount),
    sortOrder: r.sort_order,
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

export async function appendAudit(entry: AuditEntry): Promise<void> {
  const db = await getDb();
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
