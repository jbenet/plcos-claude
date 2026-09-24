'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { canonicalPath } from '@/lib/paths';
import { vehicleSelection } from '@/lib/session';
import {
  LadderRefused, requestAdvance, setStatus, StatusRefused,
  type LadderRung, type PassedBy, type PursuitStatus,
} from '@/modules/strategy';
import { logTouchpoint, TouchpointRefused, type Channel, type Direction, type Read } from '@/modules/meetings';
import { CloseRefused, recordClosing, recordSignature, recordWire, reviseSoft, withdraw } from '@/modules/pipeline';

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

/**
 * An update on an LP (N61, issue 0004): the words, and what the person ticked — a status, the
 * touchpoint the words describe, a next step. Written together (lib/updates.ts); it waits for
 * the server's answer, since a status and a meeting are records. Nothing is sent.
 */
export async function addUpdateAction(formData: FormData): Promise<{ error?: string; ok?: boolean; created?: boolean; proposed?: boolean }> {
  const { addUpdate } = await import('@/lib/updates');
  const user = await (await auth()).currentUser();
  const text = (k: string) => String(formData.get(k) ?? '').trim();
  const day = (k: string, hour: string) => (text(k) ? new Date(`${text(k)}T${hour}:00:00Z`) : null);
  const pursuitId = text('pursuitId');
  const status = text('status');
  try {
    const touchOn = formData.get('touch') ? day('touchOn', '12') : null;
    if (formData.get('touch') && !touchOn) return { error: 'The touchpoint needs the date it happened, or is set for.' };
    const r = await addUpdate(user.id, {
      pursuitId,
      body: String(formData.get('body') ?? ''),
      idempotencyKey: text('key'),
      status: status ? { to: status as PursuitStatus, passedBy: (text('passedBy') || null) as PassedBy | null, reason: text('reason') || null } : null,
      touch: touchOn ? {
        channel: text('touchChannel') as Channel, direction: (text('touchDirection') || null) as Direction | null,
        on: touchOn, read: (text('touchRead') || null) as Read | null,
      } : null,
      nextStep: formData.get('next') && text('nextStep') ? { step: text('nextStep'), on: day('nextStepOn', '00') } : null,
    });
    revalidatePath('/targets');
    revalidatePath(`/targets/${pursuitId}`);
    if (r.proposed) revalidatePath('/approvals');
    return { ok: true, created: r.created, proposed: r.proposed };
  } catch (err) {
    if (err instanceof StatusRefused || err instanceof TouchpointRefused) return { error: err.message };
    return { error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Context or a correction about an LP, from the team (issue 0016, real): kept as research on them.
 * It moves no status, no rung and no money; the strategy written before it is marked due a re-think.
 */
export async function addContextAction(formData: FormData): Promise<{ error?: string; ok?: boolean }> {
  const { addTeamContext } = await import('@/modules/research');
  const user = await (await auth()).currentUser();
  const text = (k: string) => String(formData.get(k) ?? '').trim();
  const pursuitId = text('pursuitId');
  try {
    await addTeamContext(text('entityId'), user.id, String(formData.get('body') ?? ''), { pursuitId, vehicleId: text('vehicleId') || null });
    revalidatePath(`/targets/${pursuitId}`);
    return { ok: true };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/** Accept or dismiss a suggested strategy (N64). Accepting sets the next step; nothing else moves. */
export async function decideSuggestionAction(formData: FormData): Promise<void> {
  const { decideSuggestion } = await import('@/modules/strategy');
  const user = await (await auth()).currentUser();
  const decision = String(formData.get('decision')) === 'accept' ? 'accept' : 'dismiss';
  await decideSuggestion(user.id, String(formData.get('suggestionId')), decision, String(formData.get('note') ?? '') || null);
  revalidatePath(`/targets/${String(formData.get('pursuitId'))}`);
  revalidatePath('/targets');
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

/**
 * The close track (N52): a signature, a closing, a wire, a revised soft amount, a withdrawal.
 * Hardening is not here — it is a MONEY ticket, on Soft → Hard (rule 1).
 */
export async function closeTrackAction(formData: FormData): Promise<{ error?: string; ok?: boolean }> {
  const user = await (await auth()).currentUser();
  const exposureId = String(formData.get('exposureId'));
  const pursuitId = String(formData.get('pursuitId'));
  const onRaw = String(formData.get('on') ?? '').trim();
  const on = onRaw ? new Date(`${onRaw}T12:00:00Z`) : new Date(NaN);
  const text = (k: string) => String(formData.get(k) ?? '').trim();
  const money = (k: string) => Number(text(k).replace(/[$,\s]/g, '')) * (/m$/i.test(text(k)) ? 1_000_000 : 1);
  try {
    switch (text('op')) {
      case 'sign': await recordSignature(user.id, exposureId, { on, document: text('document'), reason: text('reason') || null }); break;
      case 'close': await recordClosing(user.id, exposureId, { on, closing: text('closing') }); break;
      case 'wire': await recordWire(user.id, exposureId, { on, amount: money('amount'), reference: text('reference') }); break;
      case 'soft': await reviseSoft(user.id, exposureId, { on, amount: money('amount') }); break;
      case 'withdraw': await withdraw(user.id, exposureId, { on, reason: text('reason') }); break;
      default: return { error: 'Nothing to record.' };
    }
    revalidatePath(`/targets/${pursuitId}`);
    revalidatePath('/targets');
    revalidatePath('/soft-hard');
    return { ok: true };
  } catch (err) {
    if (err instanceof CloseRefused) return { error: err.message };
    return { error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/** Confirm a read suggested from a note, or say it is wrong (N55). Either way, a person decided. */
export async function decideReadingAction(formData: FormData): Promise<void> {
  const { decideReading } = await import('@/lib/connectors/affinity/readings');
  const user = await (await auth()).currentUser();
  const decision = String(formData.get('decision')) === 'confirm' ? 'confirm' : 'dismiss';
  await decideReading(user.id, String(formData.get('noteId')), decision);
  revalidatePath(`/targets/${String(formData.get('pursuitId'))}`);
  revalidatePath('/targets');
}

/**
 * Move LPs who have met us, and are still at New, Sourcing or Selected, to Discussing (N57): the
 * log got ahead of the status (docs/18). A person's action, one status change each, each in the
 * audit log; no ticket, since a status claims nothing, and no rung moves. Each LP is checked
 * again here — its status, and a meeting on record — whatever the form says, and keeps its next
 * step.
 */
export async function moveMetToDiscussing(formData: FormData): Promise<void> {
  const { getPursuit } = await import('@/modules/strategy');
  const { summarize, touchpointsFor } = await import('@/modules/meetings');
  const user = await (await auth()).currentUser();
  const ids = [...new Set(formData.getAll('pursuitId').map(String))];
  const note = String(formData.get('note') ?? '').trim();
  for (const id of ids) {
    const p = await getPursuit(id);
    if (!p || !['new', 'sourcing', 'selected', 'connecting'].includes(p.status)) continue;
    const met = summarize(await touchpointsFor(p.entityId, p.vehicleId)).meetingDates.length;
    if (!met) continue;
    await setStatus(user.id, id, {
      status: 'discussing', reason: `Met: ${met} ${met === 1 ? 'meeting' : 'meetings'} on record about this raise${note ? ` · ${note}` : ''}`,
      nextStep: p.nextStep, nextStepOn: p.nextStepOn,
    });
  }
  revalidatePath('/targets');
  // To the pipeline's own address, not the old one the proxy redirects (issues 0027–0028).
  redirect(canonicalPath('/targets?status=discussing', (await vehicleSelection()).current?.slug ?? 'all'));
}
