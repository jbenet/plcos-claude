'use server';
import { requireAction } from '@/lib/authz/server';

import { revalidatePath } from 'next/cache';
import { setDisposition, type Disposition } from '@/modules/signals';

export async function disposeSignal(formData: FormData): Promise<void> {
  const authorizedUser = await requireAction('app/signals-actions.ts#disposeSignal', formData);
  const user = authorizedUser;
  await setDisposition(
    user.id,
    String(formData.get('signalId')),
    String(formData.get('disposition')) as Disposition,
    String(formData.get('note') ?? '').trim() || null,
  );
  revalidatePath('/today');
  revalidatePath('/targets');
  revalidatePath('/system');
}
