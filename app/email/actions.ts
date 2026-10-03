'use server';
import { requireAction } from '@/lib/authz/server';

import { cookies, headers } from 'next/headers';
import { revalidatePath } from 'next/cache';

/**
 * Email drafts (docs/25-email-drafts.md). Every action here writes a draft or moves one into the
 * person's own Gmail Drafts. None sends: the Gmail client has no send to call.
 *
 * Each answers with a receipt the editor shows — or with the refusal, in words — rather than
 * throwing, so a refused move leaves the person's typing where it was.
 */

type Receipt<T> = { ok: true; value: T } | { ok: false; error: string; blocks?: Array<{ field: string; text: string }> };

async function origin(): Promise<string> {
  const h = await headers();
  return h.get('origin') ?? `http://${h.get('host') ?? 'localhost'}`;
}

async function receipt<T>(work: () => Promise<T>): Promise<Receipt<T>> {
  const { DraftRefused } = await import('@/modules/email');
  try {
    return { ok: true, value: await work() };
  } catch (e) {
    if (e instanceof DraftRefused) return { ok: false, error: e.message, blocks: e.blocks };
    const name = e instanceof Error ? e.name : '';
    if (['DraftOnlyViolation', 'GmailError', 'OAuthError'].includes(name)) return { ok: false, error: (e as Error).message };
    throw e;
  }
}

export async function createDraftAction(formData: FormData): Promise<Receipt<{ draftId: string }>> {
  const user = await requireAction('app/email/actions.ts#createDraftAction', formData);
  const { createDraft } = await import('@/modules/email');
  const purpose = String(formData.get('purpose'));
  if (!['first_message', 'intro_ask', 'follow_up'].includes(purpose)) return { ok: false, error: 'Unknown kind of email.' };
  const opt = (k: string) => String(formData.get(k) ?? '') || null;
  return receipt(async () => {
    const draftId = await createDraft(user, {
      purpose: purpose as 'first_message', vehicleId: String(formData.get('vehicleId') ?? ''), pursuitId: opt('pursuitId'),
      entityId: opt('entityId'), connectorId: opt('connectorId'), replyToDraftId: opt('replyToDraftId'),
    });
    if (opt('path')) revalidatePath(opt('path')!);
    return { draftId };
  });
}

export async function saveDraftAction(input: {
  draftId: string; revision: number; to: string; cc: string; bcc: string; subject: string; mode: 'rich' | 'plain'; doc?: unknown; text?: string;
}) {
  const user = await requireAction('app/email/actions.ts#saveDraftAction', input);
  const { saveDraft, draftWithChecks } = await import('@/modules/email');
  return receipt(async () => {
    const saved = await saveDraft(user, input.draftId, {
      revision: Number(input.revision), to: String(input.to ?? ''), cc: String(input.cc ?? ''), bcc: String(input.bcc ?? ''),
      subject: String(input.subject ?? ''), mode: input.mode === 'plain' ? 'plain' : 'rich', doc: input.doc, text: typeof input.text === 'string' ? input.text : undefined,
    });
    const { draft, warnings, blocks } = await draftWithChecks(user, input.draftId);
    return { ...saved, warnings, blocks, to: draft.to, cc: draft.cc, bcc: draft.bcc, doc: draft.doc, status: draft.status, movedRevision: draft.movedRevision };
  });
}

export async function previewDraftAction(input: { draftId: string }) {
  const user = await requireAction('app/email/actions.ts#previewDraftAction', input);
  const { previewDraft } = await import('@/modules/email');
  return receipt(() => previewDraft(user, input.draftId));
}

export async function moveDraftAction(input: { draftId: string }) {
  const user = await requireAction('app/email/actions.ts#moveDraftAction', input);
  const { moveDraft } = await import('@/modules/email');
  return receipt(async () => {
    const moved = await moveDraft(user, input.draftId, await origin());
    return moved;
  });
}

export async function discardDraftAction(input: { draftId: string; path?: string }) {
  const user = await requireAction('app/email/actions.ts#discardDraftAction', input);
  const { discardDraft } = await import('@/modules/email');
  return receipt(async () => {
    await discardDraft(user, input.draftId);
    if (input.path?.startsWith('/')) revalidatePath(input.path);
    return true;
  });
}

export async function removeAttachmentAction(input: { draftId: string; attachmentId: string }) {
  const user = await requireAction('app/email/actions.ts#removeAttachmentAction', input);
  const { removeAttachment, draftWithChecks, DraftRefused } = await import('@/modules/email');
  return receipt(async () => {
    const { draft } = await draftWithChecks(user, input.draftId);
    if (!draft.attachments.some((a) => a.attachmentId === input.attachmentId)) throw new DraftRefused('That file is not on this draft.');
    await removeAttachment(user, input.attachmentId);
    const after = await draftWithChecks(user, input.draftId);
    return { revision: after.draft.revision, attachments: after.draft.attachments, warnings: after.warnings, blocks: after.blocks };
  });
}

export async function disconnectGmailAction(formData: FormData): Promise<void> {
  const user = await requireAction('app/email/actions.ts#disconnectGmailAction', formData);
  const { disconnectGmail } = await import('@/modules/email');
  await disconnectGmail(user, await origin());
  revalidatePath('/settings');
}

/**
 * Finish a connect from another device (docs/25 §Per-user OAuth): Google can only send the browser
 * back to localhost, so on an iPad the last page fails to load — but its address carries the code,
 * and pasting it here finishes the connect with the same checks as the callback.
 */
export async function pasteConsentAction(formData: FormData): Promise<{ ok: boolean; message: string }> {
  const user = await requireAction('app/email/actions.ts#pasteConsentAction', formData);
  const { finishGmailConnect } = await import('@/modules/email');
  const { readPending, PENDING_COOKIE } = await import('@/lib/email/pending');
  let url: URL;
  try { url = new URL(String(formData.get('url') ?? '').trim()); } catch { return { ok: false, message: 'That is not an address. Copy the whole address of the page Google sent you to.' }; }
  const jar = await cookies();
  const pending = readPending(jar.get(PENDING_COOKIE)?.value);
  if (!pending || url.searchParams.get('state') !== pending.state) return { ok: false, message: 'That address does not match the connect you started here. Start again from Connect.' };
  const code = url.searchParams.get('code');
  if (!code) return { ok: false, message: url.searchParams.get('error') === 'access_denied' ? 'Google says the request was declined.' : 'The address has no code in it.' };
  const from = await origin();
  const r = await receipt(() => finishGmailConnect(user, from, code, pending));
  jar.delete(PENDING_COOKIE);
  revalidatePath('/settings');
  return r.ok ? { ok: true, message: `Connected ${r.value}.` } : { ok: false, message: r.error };
}
