'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { requestHardening } from '@/modules/pipeline';

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
