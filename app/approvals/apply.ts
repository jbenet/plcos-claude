import { harden } from '@/modules/pipeline';
import { recordSend } from '@/modules/content';
import { recordAdvance, type LadderRung } from '@/modules/strategy';
import type { ApprovalTicket } from '@/modules/governance';

/**
 * Approving a ticket runs the bounded action written in its scope, and nothing else.
 *
 * The wiring lives in the app layer on purpose: it is the only place that is allowed to
 * know about more than one module, which keeps the modules themselves from growing
 * references to each other.
 */
export async function applyApprovedTicket(
  actorId: string, ticket: ApprovalTicket,
): Promise<{ ran: string } | null> {
  const apply = ticket.scope.apply;
  if (!apply) return null;

  switch (apply.command) {
    case 'pipeline.harden': {
      await harden(actorId, {
        exposureId: String(apply.args['exposureId']),
        evidenceRef: String(apply.args['evidenceRef']),
        ticketId: ticket.id,
      });
      return { ran: 'pipeline.harden' };
    }
    case 'strategy.recordAdvance': {
      await recordAdvance(actorId, {
        pursuitId: String(apply.args['pursuitId']),
        rung: String(apply.args['rung']) as LadderRung,
        ticketId: ticket.id,
        evidenceKind: String(apply.args['evidenceKind']),
        evidenceRef: String(apply.args['evidenceRef']),
        evidenceNote: String(apply.args['evidenceNote']),
        occurredAt: new Date(),
      });
      return { ran: 'strategy.recordAdvance' };
    }
    case 'content.recordSend': {
      await recordSend(actorId, String(apply.args['sendId']), ticket.id);
      return { ran: 'content.recordSend' };
    }
    default:
      throw new Error(
        `Ticket ${ticket.id} names an unknown command "${apply.command}". Nothing was run — ` +
        'an approval that cannot be executed exactly is not executed approximately.',
      );
  }
}
