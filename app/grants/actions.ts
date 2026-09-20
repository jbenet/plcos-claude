'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { recordInvitation } from '@/modules/grants';

export async function saveInvitation(formData: FormData): Promise<{ error?: string } | void> {
  const user = await (await auth()).currentUser();
  try {
    await recordInvitation(user.id, {
      funderId: String(formData.get('funderId')),
      reference: String(formData.get('reference') ?? ''),
      invitedOn: String(formData.get('invitedOn') ?? new Date().toISOString().slice(0, 10)),
      invitedBy: String(formData.get('invitedBy') ?? '').trim() || 'unnamed',
    });
    revalidatePath('/grants');
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
