import { getDb, type Queryable } from '@/lib/db';
import type { PassedBy, PursuitStatus } from './types';
import type { UpdateSuggestion } from './reader';

/**
 * Updates on an LP (N61, issue 0004): a person's words about where things are, and what they
 * chose to do with them. The table is strategy 005; lib/updates.ts writes an update together
 * with what it changes.
 */
export interface UpdateApplied {
  /**
   * `was` is what the status carried before the change, kept so an undo (issue 0104) can put a
   * Passed back with who ended it and why. Older rows have none.
   */
  status?: { from: PursuitStatus; to: PursuitStatus; was?: { passedBy: PassedBy | null; reason: string | null } };
  /** Set on an undo: the request whose status change this one reversed. */
  undoes?: string;
  /** The touchpoint the update logged, and what it was. */
  touchpointId?: string;
  touch?: { channel: string; on: string; ahead: boolean; read: string | null };
  nextStep?: { step: string; on: string | null };
  /** An indicated amount the update recorded (docs/27 §1): never soft money, never summed into it. */
  indicated?: { indicationId: string; low: number; high: number; on: string; touchpointId: string | null };
  /** What the reader suggested and the person left unticked: kept, so a wrong rule can be found. */
  declined?: string[];
}

export interface PursuitUpdate {
  updateId: string;
  pursuitId: string;
  body: string;
  statusFrom: PursuitStatus | null;
  statusTo: PursuitStatus | null;
  suggested: { reader?: string; suggestions?: UpdateSuggestion[] };
  applied: UpdateApplied;
  createdByName: string;
  createdAt: Date;
}

/** One row per form: a second save with the same key finds the first and writes nothing. */
export async function insertUpdate(
  q: Queryable,
  args: { pursuitId: string; body: string; createdBy: string; idempotencyKey: string; suggested: PursuitUpdate['suggested'] },
): Promise<{ updateId: string; created: boolean }> {
  const row = await q.one<{ update_id: string }>(
    `insert into strategy.pursuit_update (pursuit_id, body, suggested, created_by, idempotency_key)
     values ($1, $2, $3, $4, $5)
     on conflict (idempotency_key) do nothing
     returning update_id::text`,
    [args.pursuitId, args.body, JSON.stringify(args.suggested), args.createdBy, args.idempotencyKey],
  );
  if (row) return { updateId: row.update_id, created: true };
  const first = await q.one<{ update_id: string }>(
    'select update_id::text from strategy.pursuit_update where idempotency_key = $1', [args.idempotencyKey],
  );
  return { updateId: first!.update_id, created: false };
}

export async function recordApplied(q: Queryable, updateId: string, applied: UpdateApplied): Promise<void> {
  await q.query(
    `update strategy.pursuit_update
        set applied = $2, status_from = $3::strategy.pursuit_status, status_to = $4::strategy.pursuit_status
      where update_id = $1`,
    [updateId, JSON.stringify(applied), applied.status?.from ?? null, applied.status?.to ?? null],
  );
}

/**
 * insertUpdate for many pursuits in one statement (issue 0139: a move of eleven LPs made a round trip
 * per row to a remote database). Returns only the updates it created: a key already used is left as
 * it was, as insertUpdate leaves it.
 */
export async function insertUpdates(
  q: Queryable, createdBy: string, rows: Array<{ pursuitId: string; body: string; idempotencyKey: string }>,
): Promise<Map<string, string>> {
  if (!rows.length) return new Map();
  const made = await q.query<{ update_id: string; pursuit_id: string }>(
    `insert into strategy.pursuit_update (pursuit_id, body, suggested, created_by, idempotency_key)
     select x.pursuit_id, x.body, '{}'::jsonb, $1, x.key
       from jsonb_to_recordset($2::jsonb) as x(pursuit_id uuid, body text, key text)
     on conflict (idempotency_key) do nothing
     returning update_id::text, pursuit_id::text`,
    [createdBy, JSON.stringify(rows.map((r) => ({ pursuit_id: r.pursuitId, body: r.body, key: r.idempotencyKey })))],
  );
  return new Map(made.map((r) => [r.pursuit_id, r.update_id]));
}

/** recordApplied for many updates in one statement. */
export async function recordAppliedMany(q: Queryable, rows: Array<{ updateId: string; applied: UpdateApplied }>): Promise<void> {
  if (!rows.length) return;
  await q.query(
    `update strategy.pursuit_update u
        set applied = x.applied, status_from = x.status_from::strategy.pursuit_status, status_to = x.status_to::strategy.pursuit_status
       from jsonb_to_recordset($1::jsonb) as x(update_id uuid, applied jsonb, status_from text, status_to text)
      where u.update_id = x.update_id`,
    [JSON.stringify(rows.map((r) => ({ update_id: r.updateId, applied: r.applied,
      status_from: r.applied.status?.from ?? null, status_to: r.applied.status?.to ?? null })))],
  );
}

export async function updatesFor(pursuitId: string): Promise<PursuitUpdate[]> {
  const db = await getDb();
  const rows = await db.query<{
    update_id: string; pursuit_id: string; body: string; status_from: PursuitStatus | null; status_to: PursuitStatus | null;
    suggested: PursuitUpdate['suggested']; applied: UpdateApplied; name: string; created_at: Date | string;
  }>(
    `select u.update_id::text, u.pursuit_id::text, u.body, u.status_from::text as status_from, u.status_to::text as status_to,
            u.suggested, u.applied, a.name, u.created_at
       from strategy.pursuit_update u join platform.app_user a on a.id = u.created_by
      where u.pursuit_id = $1
      order by u.created_at desc`,
    [pursuitId],
  );
  return rows.map((r) => ({
    updateId: r.update_id, pursuitId: r.pursuit_id, body: r.body, statusFrom: r.status_from, statusTo: r.status_to,
    suggested: r.suggested ?? {}, applied: r.applied ?? {}, createdByName: r.name, createdAt: new Date(r.created_at),
  }));
}
