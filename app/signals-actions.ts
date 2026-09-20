'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { setDisposition, type Disposition } from '@/modules/signals';

export async function disposeSignal(formData: FormData): Promise<void> {
  const user = await (await auth()).currentUser();
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
