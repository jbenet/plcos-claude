import { getDb, type Queryable } from '@/lib/db';
import type { ApprovalDecision, ApprovalKind, ApprovalTicket, TicketScope } from './types';

type Row = {
  id: string; kind: ApprovalKind; subject_type: string; subject_id: string;
  subject_label: string; scope: TicketScope; vehicle_id: string | null;
  vehicle_name: string | null; requested_by: string; requested_by_name: string;
  decided_by_name: string | null; decision: ApprovalDecision | null;
  decision_note: string | null; expires_at: Date | string | null;
  created_at: Date | string; decided_at: Date | string | null;
};

const SELECT = `
  select t.id, t.kind, t.subject_type, t.subject_id, t.subject_label, t.scope, t.vehicle_id,
         v.name as vehicle_name, t.requested_by, r.name as requested_by_name,
         d.name as decided_by_name, t.decision, t.decision_note, t.expires_at,
         t.created_at, t.decided_at
    from governance.approval_ticket t
    join platform.app_user r on r.id = t.requested_by
    left join platform.app_user d on d.id = t.decided_by
    left join platform.vehicle v on v.id = t.vehicle_id`;

const toTicket = (r: Row): ApprovalTicket => ({
  id: r.id, kind: r.kind, subjectType: r.subject_type, subjectId: r.subject_id,
  subjectLabel: r.subject_label, scope: r.scope, vehicleId: r.vehicle_id,
  vehicleName: r.vehicle_name, requestedBy: r.requested_by, requestedByName: r.requested_by_name,
  decidedByName: r.decided_by_name, decision: r.decision, decisionNote: r.decision_note,
  expiresAt: r.expires_at ? new Date(r.expires_at) : null,
  createdAt: new Date(r.created_at),
  decidedAt: r.decided_at ? new Date(r.decided_at) : null,
});

export async function listOpenTickets(): Promise<ApprovalTicket[]> {
  const db = await getDb();
  return (await db.query<Row>(`${SELECT} where t.decision is null order by t.created_at`)).map(toTicket);
}

export async function listDecidedTickets(limit = 20): Promise<ApprovalTicket[]> {
  const db = await getDb();
  return (
    await db.query<Row>(`${SELECT} where t.decision is not null order by t.decided_at desc limit $1`, [limit])
  ).map(toTicket);
}

export async function getTicket(id: string): Promise<ApprovalTicket | null> {
  const db = await getDb();
  const row = await db.one<Row>(`${SELECT} where t.id = $1`, [id]);
  return row ? toTicket(row) : null;
}

export async function findOpenTicket(
  kind: ApprovalKind, subjectType: string, subjectId: string,
): Promise<ApprovalTicket | null> {
  const db = await getDb();
  const row = await db.one<Row>(
    `${SELECT} where t.kind = $1::governance.approval_kind and t.subject_type = $2
       and t.subject_id = $3 and t.decision is null`,
    [kind, subjectType, subjectId],
  );
  return row ? toTicket(row) : null;
}

export async function insertTicket(
  tx: Queryable,
  t: {
    kind: ApprovalKind; subjectType: string; subjectId: string; subjectLabel: string;
    scope: TicketScope; vehicleId: string | null; requestedBy: string; expiresAt: Date | null;
  },
): Promise<string> {
  const rows = await tx.query<{ id: string }>(
    `insert into governance.approval_ticket
       (kind, subject_type, subject_id, subject_label, scope, vehicle_id, requested_by, expires_at)
     values ($1::governance.approval_kind,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [t.kind, t.subjectType, t.subjectId, t.subjectLabel, JSON.stringify(t.scope), t.vehicleId,
     t.requestedBy, t.expiresAt],
  );
  return rows[0]!.id;
}

export async function ticketCounts(): Promise<{ open: number; expired: number }> {
  const db = await getDb();
  const row = await db.one<{ open: string; expired: string }>(
    `select count(*) filter (where decision is null)::text as open,
            count(*) filter (where decision is null and expires_at < now())::text as expired
       from governance.approval_ticket`,
  );
  return { open: Number(row?.open ?? 0), expired: Number(row?.expired ?? 0) };
}
