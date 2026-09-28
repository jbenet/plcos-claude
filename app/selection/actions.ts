'use server';
import { requireAction } from '@/lib/authz/server';

import { revalidatePath } from 'next/cache';
import { setActiveWeights } from '@/modules/scoring';
import { scoreDetail, type ScoreDetail } from '@/lib/pipeline-data';

/** Why one LP scores what it does (issue 0089): read-only, for the detail beside the ranked list. */
export async function scoreDetailAction(vehicleId: string, pursuitId: string): Promise<ScoreDetail | null> {
  const authorizedUser = await requireAction('app/selection/actions.ts#scoreDetailAction', vehicleId, pursuitId);
  if (typeof vehicleId !== 'string' || typeof pursuitId !== 'string') return null;
  return scoreDetail(vehicleId, pursuitId);
}

export async function saveWeights(formData: FormData): Promise<{ error?: string } | void> {
  const authorizedUser = await requireAction('app/selection/actions.ts#saveWeights', formData);
  const user = authorizedUser;
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
