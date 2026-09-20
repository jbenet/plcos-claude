'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { decideTicket, type ApprovalDecision } from '@/modules/governance';
import { adjudicateConflict, type ConflictReason } from '@/modules/coordination';

export async function decide(formData: FormData): Promise<void> {
  const user = await (await auth()).currentUser();
  const ticketId = String(formData.get('ticketId'));
  const decision = String(formData.get('decision')) as ApprovalDecision;
  const note = String(formData.get('note') ?? '').trim() || null;
  await decideTicket(user.id, ticketId, decision, note);
  revalidatePath('/approvals');
  revalidatePath('/today');
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
