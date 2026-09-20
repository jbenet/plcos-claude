'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { setActiveWeights } from '@/modules/scoring';

export async function saveWeights(formData: FormData): Promise<{ error?: string } | void> {
  const user = await (await auth()).currentUser();
  const num = (k: string) => Number(formData.get(k) ?? 0) / 100;
  try {
    await setActiveWeights(user.id, {
      label: String(formData.get('label') ?? '').trim() || `Set by ${user.name}`,
      capacity: num('capacity'),
      affinity: num('affinity'),
      propensity: num('propensity'),
      timeToDecision: num('timeToDecision'),
    });
    revalidatePath('/selection');
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
