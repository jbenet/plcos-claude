'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { decideTicket, getTicket, type ApprovalDecision } from '@/modules/governance';
import { applyApprovedTicket } from './apply';
import { adjudicateConflict, type ConflictReason } from '@/modules/coordination';

export async function decide(formData: FormData): Promise<{ error?: string } | void> {
  const user = await (await auth()).currentUser();
  const ticketId = String(formData.get('ticketId'));
  const decision = String(formData.get('decision')) as ApprovalDecision;
  const note = String(formData.get('note') ?? '').trim() || null;

  await decideTicket(user.id, ticketId, decision, note);

  if (decision === 'approve') {
    const ticket = await getTicket(ticketId);
    if (ticket) {
      try {
        await applyApprovedTicket(user.id, ticket);
      } catch (err) {
        // The decision stands and is on the record; the action did not run. Say which.
        return {
          error:
            `Approved, but the action did not run: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
  }

  revalidatePath('/approvals');
  revalidatePath('/today');
  revalidatePath('/soft-hard');
  revalidatePath('/targets');
}

export async function adjudicate(formData: FormData): Promise<{ error: string } | void> {
  const user = await (await auth()).currentUser();
  const followup = String(formData.get('loserFollowupAt') ?? '').trim();
  if (!followup) {
    return { error: 'A dated follow-up for the losing vehicle is required.' };
  }
  await adjudicateConflict(user.id, {
    caseId: String(formData.get('caseId')),
    winnerAskId: String(formData.get('winnerAskId')),
    reasonCode: String(formData.get('reasonCode')) as ConflictReason,
    loserFollowupAt: followup,
    note: String(formData.get('note') ?? '').trim() || null,
  });
  revalidatePath('/approvals');
  revalidatePath('/asks');
}
