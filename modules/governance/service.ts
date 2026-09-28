import { getDb, type Queryable } from '@/lib/db';
import { appendAudit } from '@/modules/platform';
import { insertTicket } from './repo';
import type { ApprovalDecision, ApprovalKind, TicketScope } from './types';

/**
 * Thrown by every mutating command in the five families when there is no approved,
 * unexpired ticket. It carries the reason so the UI can say *which* condition failed —
 * "no ticket", "not approved yet" and "approved but expired" are three different
 * situations with three different next steps.
 */
export class TicketRequired extends Error {
  constructor(
    readonly kind: ApprovalKind,
    readonly subjectLabel: string,
    readonly reason: 'missing' | 'wrong_subject' | 'undecided' | 'rejected' | 'expired',
    message: string,
  ) {
    super(message);
    this.name = 'TicketRequired';
  }
}

type TicketRow = {
  id: string; kind: ApprovalKind; subject_type: string; subject_id: string;
  subject_label: string; decision: ApprovalDecision | null; expires_at: Date | string | null;
};

/**
 * The gate. Fails closed: every path that does not end in an approved, unexpired ticket
 * for exactly this subject throws.
 */
export async function requireApprovedTicket(
  tx: Queryable,
  args: { kind: ApprovalKind; subjectType: string; subjectId: string; ticketId: string | null },
): Promise<string> {
  const { kind, subjectType, subjectId, ticketId } = args;

  if (!ticketId) {
    throw new TicketRequired(kind, subjectId, 'missing',
      `A ${kind} ticket is required and none was supplied. The command did not run.`);
  }

  const row = await tx.one<TicketRow>(
    `select id, kind, subject_type, subject_id, subject_label, decision, expires_at
       from governance.approval_ticket where id = $1`,
    [ticketId],
  );

  if (!row) {
    throw new TicketRequired(kind, subjectId, 'missing', `No ticket ${ticketId} exists.`);
  }
  if (row.kind !== kind || row.subject_type !== subjectType || row.subject_id !== subjectId) {
    throw new TicketRequired(kind, row.subject_label, 'wrong_subject',
      `Ticket ${ticketId} authorizes ${row.kind} on ${row.subject_label}, not ${kind} on this subject. ` +
      'An approval is for a specific bounded action.');
  }
  if (row.decision === null) {
    throw new TicketRequired(kind, row.subject_label, 'undecided',
      `Ticket for ${row.subject_label} has not been decided yet.`);
  }
  if (row.decision !== 'approve') {
    throw new TicketRequired(kind, row.subject_label, 'rejected',
      `Ticket for ${row.subject_label} was ${row.decision}, not approved.`);
  }
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    throw new TicketRequired(kind, row.subject_label, 'expired',
      `The approval for ${row.subject_label} expired. Approvals do not survive their window; ` +
      'ask again rather than acting on a stale one.');
  }
  return row.id;
}

export interface OpenTicketCommand {
  kind: ApprovalKind;
  subjectType: string;
  subjectId: string;
  subjectLabel: string;
  scope: TicketScope;
  vehicleId: string | null;
  /** Approvals expire. The default window is a week; a SEND is shorter in practice. */
  expiresInDays?: number;
}

export async function openTicket(
  actorId: string, cmd: OpenTicketCommand, tx?: Queryable,
): Promise<string> {
  const run = async (q: Queryable) => {
    const expiresAt = new Date(Date.now() + (cmd.expiresInDays ?? 7) * 86400_000);
    const id = await insertTicket(q, {
      kind: cmd.kind, subjectType: cmd.subjectType, subjectId: cmd.subjectId,
      subjectLabel: cmd.subjectLabel, scope: cmd.scope, vehicleId: cmd.vehicleId,
      requestedBy: actorId, expiresAt,
    });
    await q.query(
      `insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
       values ($1, 'ticket.opened', $2, $3, $4)`,
      [actorId, cmd.subjectType, id, JSON.stringify({ kind: cmd.kind, label: cmd.subjectLabel })],
    );
    return id;
  };
  if (tx) return run(tx);
  const db = await getDb();
  return db.transaction(run);
}

export async function decideTicket(
  actorId: string,
  ticketId: string,
  decision: ApprovalDecision,
  note: string | null,
): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    const actor = await tx.one<{ id: string }>('select id from platform.app_user where id = $1 and active', [actorId]);
    if (!actor) throw new Error('An active app user must decide a ticket.');
    const row = await tx.one<{ decision: ApprovalDecision | null; subject_label: string; kind: ApprovalKind;
      requested_by: string; subject_type: string; subject_id: string; vehicle_id: string | null }>(
      `select decision, subject_label, kind, requested_by, subject_type, subject_id, vehicle_id
         from governance.approval_ticket where id = $1 for update`,
      [ticketId],
    );
    if (!row) throw new Error(`No ticket ${ticketId}`);
    if (row.decision !== null) {
      // Idempotent by intent: a double click must not re-decide something already decided.
      return;
    }
    if (decision === 'approve' && row.requested_by === actorId) {
      // The sole exception is STAGE on the requester's own pursuit. Never infer
      // ownership from ticket scope supplied by the requester.
      const owned = row.kind === 'STAGE' && row.subject_type === 'pursuit'
        ? await tx.one<{ pursuit_id: string }>(
          `select pursuit_id from strategy.pursuit
            where pursuit_id = $1 and owner_id = $2 and vehicle_id = $3 for update`,
          [row.subject_id, actorId, row.vehicle_id]) : null;
      if (!owned) throw new Error('You cannot approve your own ticket; STAGE on a pursuit you own is the only exception.');
    }
    await tx.query(
      `update governance.approval_ticket
          set decision = $2::governance.approval_decision, decided_by = $3,
              decision_note = $4, decided_at = now()
        where id = $1 and decision is null`,
      [ticketId, decision, actorId, note],
    );
    await tx.query(
      `insert into platform.audit_log (actor_id, action, subject_type, subject_id, detail)
       values ($1, $2, 'approval_ticket', $3, $4)`,
      [actorId, `ticket.${decision}`, ticketId, JSON.stringify({ kind: row.kind, label: row.subject_label })],
    );
  });
}

export { appendAudit };
