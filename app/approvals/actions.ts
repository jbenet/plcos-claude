'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
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

/**
 * Decide several of reconciliation's proposals at once (N57). Each is still its own ticket,
 * decided and applied one at a time, with its own audit line: the batch is only the button. A
 * ticket that is not a reconciliation proposal is not decided here, whatever the form says.
 */
export async function decideMany(formData: FormData): Promise<void> {
  const user = await (await auth()).currentUser();
  const decision = String(formData.get('decision')) === 'approve' ? 'approve' : 'reject';
  const ids = [...new Set(formData.getAll('ticketId').map(String))];
  const note = String(formData.get('note') ?? '').trim();
  let done = 0;
  const failed: string[] = [];
  for (const id of ids) {
    const ticket = await getTicket(id);
    if (!ticket || ticket.kind !== 'STAGE' || ticket.scope.apply?.command !== 'strategy.recordClimb' || ticket.decision) continue;
    await decideTicket(user.id, id, decision, `Decided in a batch of ${ids.length}, from the records on file${note ? `. ${note}` : ''}`);
    if (decision === 'approve') {
      try {
        await applyApprovedTicket(user.id, (await getTicket(id))!);
      } catch (err) {
        failed.push(`${ticket.subjectLabel}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
    }
    done++;
  }
  revalidatePath('/approvals');
  revalidatePath('/today');
  revalidatePath('/targets');
  // Counts only in the address: an LP's name does not belong in a URL or the browser's history.
  const q = new URLSearchParams({ view: 'reconcile', [decision === 'approve' ? 'approved' : 'rejected']: String(done) });
  if (failed.length) {
    q.set('failed', String(failed.length));
    console.warn(`[reconcile] ${failed.length} approved but not recorded:\n  ${failed.join('\n  ')}`);
  }
  redirect(`/approvals?${q.toString()}`);
}
