import { getDb, type Queryable } from '@/lib/db';
import { requireTicketDecision } from '@/lib/authz/tickets';
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
    const row = await requireTicketDecision(tx, actorId, ticketId, decision);
    if (row.decision !== null) {
      // Idempotent by intent: a double click must not re-decide something already decided.
      return;
    }
    // An expired ticket is asked again, not approved late (red team, 17 Oct 2026).
    if (decision === 'approve' && row.expired) throw new Error('This ticket has expired; ask for it again.');
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

/**
 * A do-not-contact restriction recorded on someone ends their open SEND and INTRO_ASK tickets at once, and SEND tickets that
 * would mail them: an approval given before it would otherwise still let an agent send until it expired (rule 8; red-team
 * pass, 14 Oct 2026). "Would mail them" is what barredRecipients (lib/outreach/addresses.ts) refuses at send time (red team,
 * 17 Oct 2026): an address of theirs on record (a claim, Affinity's person record, their send-to), and for a firm the
 * addresses of the people whose current primary firm it is; and an intro ask that would email them as its connector.
 * Unused tickets only; the number ended. It may end a little more than barredRecipients would refuse (Dakota addresses
 * count here), never less.
 */
export async function expireOutreachTicketsFor(q: Queryable, entityId: string): Promise<number> {
  const rows = await q.query<{ id: string }>(`with x as (select identity.canonical_entity_id($1::uuid) id),
     them as (select id from x
       union select identity.canonical_entity_id(a.person_entity) from identity.affiliation a, x
        where a.ended_on is null and a.is_primary and coalesce(a.source, '') !~* '^dakota' and identity.canonical_entity_id(a.org_entity) = x.id),
     addr as (
       select lower(btrim(c.value)) a from research.claim c
        where c.superseded_by is null and c.field ~ '(^|\\.)email$' and identity.canonical_entity_id(c.entity_id) in (select id from them)
       union select lower(btrim(s.email)) from identity.send_to s where identity.canonical_entity_id(s.entity_id) in (select id from them)
       union select lower(btrim(e.v)) from sources.raw_record r
         join identity.source_record sr on sr.source = 'affinity' and sr.source_id = 'person:' || r.source_id
         cross join lateral (select r.payload->>'primaryEmailAddress' v
           union all select jsonb_array_elements_text(case when jsonb_typeof(r.payload->'emailAddresses') = 'array' then r.payload->'emailAddresses' else '[]'::jsonb end)) e
        where r.source = 'affinity' and r.kind = 'person' and e.v is not null and identity.canonical_entity_id(sr.entity_id) in (select id from them))
   update governance.approval_ticket t set expires_at = now()
     where t.kind in ('SEND', 'INTRO_ASK') and (t.expires_at is null or t.expires_at > now())
       and (t.id in (select o.ticket_id from email.outreach_send o where o.sent_at is null and o.ticket_id is not null
                      and identity.canonical_entity_id(o.entity_id) = (select id from x))
         or t.id in (select o.ticket_id from email.outreach_send o where o.sent_at is null and o.ticket_id is not null
                      and exists (select 1 from unnest(o.recipients) r where lower(btrim(r)) in (select a from addr)))
         or (t.subject_type = 'ask' and t.subject_id in (select a.ask_id from coordination.ask a
                      where identity.canonical_entity_id(a.entity_id) = (select id from x)
                         or identity.canonical_entity_id(a.connector_id) = (select id from x))))
     returning t.id::text id`, [entityId]);
  return rows.length;
}
