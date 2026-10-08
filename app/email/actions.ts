'use server';
import { requireAction } from '@/lib/authz/server';

import { revalidatePath } from 'next/cache';

/**
 * Email drafts (docs/25-email-drafts.md). Every action here writes a draft, moves one into the
 * person's own Gmail Drafts through mailguard, or connects their mailguard token. None sends: the
 * mailguard client has no send to call, and only a token that cannot send is accepted.
 *
 * Each answers with a receipt the editor shows — or with the refusal, in words — rather than
 * throwing, so a refused move leaves the person's typing where it was.
 */

type Receipt<T> = { ok: true; value: T } | { ok: false; error: string; blocks?: Array<{ field: string; text: string }> };

async function receipt<T>(work: () => Promise<T>): Promise<Receipt<T>> {
  const { DraftRefused } = await import('@/modules/email');
  try {
    return { ok: true, value: await work() };
  } catch (e) {
    if (e instanceof DraftRefused) return { ok: false, error: e.message, blocks: e.blocks };
    const name = e instanceof Error ? e.name : '';
    if (['DraftOnlyViolation', 'MailguardError', 'KeyRefused', 'NotConnected'].includes(name)) return { ok: false, error: (e as Error).message };
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
    const moved = await moveDraft(user, input.draftId);
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

export type ConnectResult = { ok: boolean; message: string };

/**
 * Connect a mailguard token (docs/25 §12): checked with mailguard's GET /api/v1/me first, and kept only
 * if it can make drafts and cannot send. A refused token is not stored. The token never comes back.
 */
export async function connectMailguardAction(formData: FormData): Promise<ConnectResult> {
  const user = await requireAction('app/email/actions.ts#connectMailguardAction', formData);
  const { connectMailguard } = await import('@/modules/email');
  const r = await receipt(() => connectMailguard(user, String(formData.get('token') ?? '')));
  revalidatePath('/settings');
  return r.ok ? { ok: true, message: `Connected: drafts-only, for ${r.value.mailbox}.` } : { ok: false, message: r.error };
}

/** Test the connection: one harmless read (GET /api/v1/me), no draft. */
export async function testMailguardAction(formData: FormData): Promise<ConnectResult> {
  const user = await requireAction('app/email/actions.ts#testMailguardAction', formData);
  const { testMailguard } = await import('@/modules/email');
  const r = await receipt(() => testMailguard(user));
  revalidatePath('/settings');
  if (!r.ok) return { ok: false, message: r.error };
  const s = r.value;
  return s.ok ? { ok: true, message: `Mailguard answered: ${s.mailbox}, tool “${s.tool}”, drafts-only.` } : { ok: false, message: s.reason ?? s.why ?? 'Refused.' };
}

export async function forgetMailguardAction(formData: FormData): Promise<void> {
  const user = await requireAction('app/email/actions.ts#forgetMailguardAction', formData);
  const { forgetMailguard } = await import('@/modules/email');
  await forgetMailguard(user);
  revalidatePath('/settings');
}

/** The demo only: an invented drafts-only token from the fake mailguard. */
export async function demoMailguardAction(formData: FormData): Promise<void> {
  const user = await requireAction('app/email/actions.ts#demoMailguardAction', formData);
  const { connectDemoMailguard } = await import('@/modules/email');
  await connectDemoMailguard(user);
  revalidatePath('/settings');
}

/** Read calendars now (issue 0021): queue the read-only calendar job. It writes meetings next to LPs, never to a calendar. */
export async function readCalendarsAction(formData: FormData): Promise<void> {
  const user = await requireAction('app/email/actions.ts#readCalendarsAction', formData);
  const { getDb } = await import('@/lib/db');
  const { queueImportJob } = await import('@/lib/import-jobs/server');
  // A read already queued or running answers for this one too.
  await queueImportJob(await getDb(), 'calendar', user.id).catch(() => undefined);
  revalidatePath('/settings');
}
