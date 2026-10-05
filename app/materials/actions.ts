'use server';
import { requireAction } from '@/lib/authz/server';

import { revalidatePath } from 'next/cache';
import { recordSend, requestSend } from '@/modules/content';

export async function proposeSend(
  formData: FormData,
): Promise<{ refusals?: string[]; ticketId?: string; sendId?: string }> {
  const authorizedUser = await requireAction('app/materials/actions.ts#proposeSend', formData);
  const user = authorizedUser;
  const { sendId, ticketId, check } = await requestSend(user.id, {
    assetId: String(formData.get('assetId')),
    entityId: String(formData.get('entityId')),
    vehicleId: String(formData.get('vehicleId')),
    instrument: String(formData.get('instrument')),
  });
  revalidatePath('/materials');
  revalidatePath('/approvals');
  // A person needs no SEND ticket (Juan, 5 Oct 2026): a cleared send is theirs to send and mark sent.
  return check.allowed ? { ticketId: ticketId ?? undefined, sendId } : { refusals: check.refusals };
}

/**
 * The person sent the cleared material themselves: mark it sent. The wrap is checked again now (rule
 * 11), so a material whose wrap or claims changed since it was cleared is refused and nothing is marked.
 */
export async function markSentAction(formData: FormData): Promise<{ error?: string; sent?: boolean }> {
  const user = await requireAction('app/materials/actions.ts#markSentAction', formData);
  try {
    await recordSend(user.id, String(formData.get('sendId')), null);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath('/materials');
  return { sent: true };
}
