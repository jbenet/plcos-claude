'use server';

import { requireServerActionMutation } from '@/lib/mutation-guard';

import { revalidatePath } from 'next/cache';
import { recordInvitation } from '@/modules/grants';

export async function saveInvitation(formData: FormData): Promise<{ error?: string } | void> {
  const user = await requireServerActionMutation();
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
