'use server';

import { requireServerActionMutation } from '@/lib/mutation-guard';

import { revalidatePath } from 'next/cache';
import { setDisposition, type Disposition } from '@/modules/signals';

export async function disposeSignal(formData: FormData): Promise<void> {
  const user = await requireServerActionMutation();
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
