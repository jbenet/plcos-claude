'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import {
  LadderRefused, requestAdvance, setStatus, StatusRefused,
  type LadderRung, type PassedBy, type PursuitStatus,
} from '@/modules/strategy';
import { logTouchpoint, TouchpointRefused, type Channel, type Direction, type Read } from '@/modules/meetings';

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

/**
 * Set where our effort is with an LP (N50). No ticket: a status claims nothing about the LP
 * and moves neither the ladder nor the money. It waits for the server's answer all the same.
 */
export async function setPursuitStatus(formData: FormData): Promise<{ error?: string; ok?: boolean }> {
  const user = await (await auth()).currentUser();
  const pursuitId = String(formData.get('pursuitId'));
  const on = String(formData.get('nextStepOn') ?? '').trim();
  try {
    await setStatus(user.id, pursuitId, {
      status: String(formData.get('status')) as PursuitStatus,
      passedBy: (String(formData.get('passedBy') ?? '') || null) as PassedBy | null,
      reason: String(formData.get('reason') ?? '').trim() || null,
      nextStep: String(formData.get('nextStep') ?? '').trim() || null,
      nextStepOn: on ? new Date(`${on}T00:00:00Z`) : null,
    });
    revalidatePath('/targets');
    revalidatePath(`/targets/${pursuitId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof StatusRefused) return { error: err.message };
    return { error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/** Log a touchpoint on an LP (N51). A record of what happened; nothing is sent, nothing claimed. */
export async function logTouchpointAction(formData: FormData): Promise<{ error?: string; ok?: boolean }> {
  const user = await (await auth()).currentUser();
  const pursuitId = String(formData.get('pursuitId'));
  const on = String(formData.get('on') ?? '').trim();
  const which = String(formData.get('vehicle') ?? 'this');
  try {
    await logTouchpoint(user.id, {
      entityId: String(formData.get('entityId')),
      vehicleId: which === 'this' ? String(formData.get('vehicleId')) : null,
      pursuitId: which === 'this' ? pursuitId : null,
      channel: String(formData.get('channel')) as Channel,
      on: on ? new Date(`${on}T12:00:00Z`) : new Date(NaN),
      direction: (String(formData.get('direction') ?? '') || null) as Direction | null,
      summary: String(formData.get('summary') ?? '').trim() || null,
      read: (String(formData.get('read') ?? '') || null) as Read | null,
    });
    revalidatePath('/targets');
    revalidatePath(`/targets/${pursuitId}`);
    return { ok: true };
  } catch (err) {
    if (err instanceof TouchpointRefused) return { error: err.message };
    return { error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
