'use server';
import { requireAction } from '@/lib/authz/server';

import { revalidatePath } from 'next/cache';
import { recordSend, requestSend, setAssetLink } from '@/modules/content';
import { sendGate } from './gate';

export async function proposeSend(
  formData: FormData,
): Promise<{ refusals?: string[]; ticketId?: string; sendId?: string }> {
  const authorizedUser = await requireAction('app/materials/actions.ts#proposeSend', formData);
  const user = authorizedUser;
  const entityId = String(formData.get('entityId')), vehicleId = String(formData.get('vehicleId'));
  // Rules 8, 11 and 12 hold for everyone (red team, 17 Oct 2026): the instrument is the target's on that vehicle, not a
  // choice, and a restriction that bars email or a grants funder with no invitation refuses before anything is recorded.
  const gate = await sendGate(entityId, vehicleId);
  const chosen = String(formData.get('instrument') ?? '');
  if (gate.refusals.length) return { refusals: gate.refusals };
  if (chosen && chosen !== gate.instrument) {
    return { refusals: [`The instrument for this LP on this vehicle is ${gate.instrument.replace('_', ' ')}, not ${chosen.replace('_', ' ')}: the wrap is checked against what they would actually hold.`] };
  }
  const { sendId, ticketId, check } = await requestSend(user.id, {
    assetId: String(formData.get('assetId')),
    entityId,
    vehicleId,
    instrument: gate.instrument,
  });
  revalidatePath('/materials');
  revalidatePath('/approvals');
  // A person needs no SEND ticket (Juan, 5 Oct 2026): a cleared send is theirs to send and mark sent.
  return check.allowed ? { ticketId: ticketId ?? undefined, sendId } : { refusals: check.refusals };
}

/**
 * The person sent the cleared material themselves: mark it sent. The wrap is checked again now (rule
 * 11), so a material whose wrap or claims changed since it was cleared is refused and nothing is marked.
 */
export async function markSentAction(formData: FormData): Promise<{ error?: string; sent?: boolean }> {
  const user = await requireAction('app/materials/actions.ts#markSentAction', formData);
  try {
    await recordSend(user.id, String(formData.get('sendId')), null);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  revalidatePath('/materials');
  return { sent: true };
}

/** Paste or clear a material's link (a DocSend or file link). Stored only; nothing here opens it. */
export async function setLinkAction(formData: FormData): Promise<{ error?: string; link?: string | null }> {
  const user = await requireAction('app/materials/actions.ts#setLinkAction', formData);
  try {
    const { link } = await setAssetLink(user.id, String(formData.get('assetId')), String(formData.get('link') ?? ''));
    revalidatePath('/materials');
    return { link };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
