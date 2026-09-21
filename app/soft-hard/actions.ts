'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { recordCash, requestHardening } from '@/modules/pipeline';

export async function requestHarden(formData: FormData): Promise<{ error?: string; ticketId?: string }> {
  const user = await (await auth()).currentUser();
  try {
    const ticketId = await requestHardening(user.id, {
      exposureId: String(formData.get('exposureId')),
      evidenceRef: String(formData.get('evidenceRef') ?? '').trim(),
      note: String(formData.get('note') ?? '').trim() || 'Countersigned',
    });
    revalidatePath('/soft-hard');
    revalidatePath('/approvals');
    return { ticketId };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Record that the wire landed (issue 0005).
 *
 * Not ticket-gated, and that is a decision rather than an omission: the five approval kinds
 * authorise things we are about to do, and this is a thing that has already been done to us.
 * The evidence requirement is the bank reference — the receipt, not the recollection.
 */
export async function recordWire(formData: FormData): Promise<{ error?: string; ok?: boolean }> {
  const user = await (await auth()).currentUser();
  const raw = String(formData.get('receivedAt') ?? '');
  const reference = String(formData.get('reference') ?? '').trim();
  if (!reference) return { error: 'A wire needs its bank reference. Without one this is a recollection.' };
  const receivedAt = raw ? new Date(`${raw}T12:00:00Z`) : new Date();
  if (Number.isNaN(receivedAt.getTime())) return { error: 'That is not a date.' };
  if (receivedAt.getTime() > Date.now() + 86_400_000) {
    return { error: 'Cash cannot have arrived in the future. Record it when it lands.' };
  }
  try {
    await recordCash(user.id, { exposureId: String(formData.get('exposureId')), receivedAt, reference });
    revalidatePath('/soft-hard');
    revalidatePath('/close');
    revalidatePath('/all/visualizations');
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
