'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { requestSend } from '@/modules/content';

export async function proposeSend(
  formData: FormData,
): Promise<{ refusals?: string[]; ticketId?: string }> {
  const user = await (await auth()).currentUser();
  const { ticketId, check } = await requestSend(user.id, {
    assetId: String(formData.get('assetId')),
    entityId: String(formData.get('entityId')),
    vehicleId: String(formData.get('vehicleId')),
    instrument: String(formData.get('instrument')),
  });
  revalidatePath('/materials');
  revalidatePath('/approvals');
  return check.allowed ? { ticketId: ticketId ?? undefined } : { refusals: check.refusals };
}
