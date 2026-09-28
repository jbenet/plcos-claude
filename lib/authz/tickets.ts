import type { Queryable } from '@/lib/db';
import { AuthorizationError, requireCan, type Principal } from './index';

export interface DecisionTicket {
  kind: string;
  vehicle_id: string | null;
  requested_by: string;
  subject_type: string;
  subject_id: string;
  subject_label: string;
  decision: string | null;
}

/** Called inside the deciding transaction: service/agent callers receive the same gate as HTTP. */
export async function requireTicketDecision(q: Queryable, actorId: string, ticketId: string, decision: string): Promise<DecisionTicket> {
  const user = await q.one<Principal>(`select access::text, vehicles, approves from platform.app_user
    where id=$1 and active for share`, [actorId]);
  if (!user) throw new AuthorizationError();
  const ticket = await q.one<DecisionTicket>(`select kind::text, vehicle_id::text, requested_by::text,
    subject_type, subject_id, subject_label, decision::text from governance.approval_ticket
    where id=$1 for update`, [ticketId]);
  if (!ticket) throw new AuthorizationError();
  // Named per-vehicle money/allocation approvers are not configured yet: Admin only.
  requireCan(user, ['MONEY', 'ALLOCATION_EXCEPTION'].includes(ticket.kind) ? 'admin' : 'approve',
    { vehicle: ticket.vehicle_id, ticketKind: ticket.kind });
  if (decision === 'approve' && ticket.requested_by === actorId) {
    if (ticket.kind !== 'STAGE' || ticket.subject_type !== 'pursuit') throw new AuthorizationError();
    const pursuit = await q.one<{ owner_id: string }>(`select owner_id::text from strategy.pursuit
      where pursuit_id=strategy.canonical_pursuit_id($1::uuid) for share`, [ticket.subject_id]);
    if (pursuit?.owner_id !== actorId) throw new AuthorizationError();
  }
  return ticket;
}
