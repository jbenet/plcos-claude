'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { LadderRefused, requestAdvance, type LadderRung } from '@/modules/strategy';

export async function requestLadderAdvance(
  formData: FormData,
): Promise<{ error?: string; ticketId?: string }> {
  const user = await (await auth()).currentUser();
  try {
    const ticketId = await requestAdvance(user.id, {
      pursuitId: String(formData.get('pursuitId')),
      rung: String(formData.get('rung')) as LadderRung,
      evidenceKind: String(formData.get('evidenceKind') ?? '').trim(),
      evidenceRef: String(formData.get('evidenceRef') ?? '').trim(),
      evidenceNote: String(formData.get('evidenceNote') ?? '').trim(),
    });
    revalidatePath('/targets');
    revalidatePath('/approvals');
    return { ticketId };
  } catch (err) {
    if (err instanceof LadderRefused) return { error: err.message };
    return { error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
