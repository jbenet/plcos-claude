import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '@/config/deployment';
import { getDb, type Queryable } from '@/lib/db';
import { inlineImages, isEmptyDoc, normalizeDoc, renderHtml, renderText, textToDoc, type DocNode } from '@/lib/email/doc';
import { buildMime, newMessageId, parseAddresses, type Address } from '@/lib/email/mime';
import { elide, outline, type OutlineRow } from '@/lib/email/mime-parse';
import { newThread, replyTo, type ThreadHeaders } from '@/lib/email/threading';
import {
  checkedClient, connection, connectKey, fakeMintKey, FAKE_DOMAIN, forgetKey, isTransient, KeyRefused, MailguardError, mailguardRuntime, NotConnected,
  type DraftFields, type Inspection, type MailguardClient, type MailguardRuntime,
} from '@/lib/connectors/mailguard';
import { appendAudit, listVehicles } from '@/modules/platform';
import { getEntity } from '@/modules/identity';
import { getPursuit, suggestionsFor } from '@/modules/strategy';
import { listAsks, restrictionsFor } from '@/modules/coordination';
import { listWrapRules } from '@/modules/content';
import { grantGate } from '@/modules/grants';
import { claimsFor } from '@/modules/research';
import {
  claimMove, deleteMailguardAccount, draftsFor, getAttachment, getDraft, insertAttachment, insertDraft, mailguardAccountOf, recordMailguardCheck, recordMoved,
  releaseMove, removeAttachmentRow, setStatus, touchMailguardAccount, updateDraftBody,
} from './repo';
import { draftWarnings, prefillDraft } from './rules';
import type { Attachment, Draft, DraftMode, DraftPurpose, DraftWarning, MoveBlock } from './types';

/**
 * Email drafts (docs/25-email-drafts.md). A person writes here and moves the draft into their own
 * Gmail Drafts; they send it from Gmail, or not. Nothing in this module sends. Drafts reach Gmail
 * only through lib/connectors/mailguard (docs/25 §12), whose client cannot send and which accepts
 * only a key that mailguard itself says cannot send.
 */

export class DraftRefused extends Error {
  constructor(message: string, readonly blocks: MoveBlock[] = []) {
    super(message);
    this.name = 'DraftRefused';
  }
}

export interface Actor { id: string; handle: string; name: string; email: string }

const INSTRUMENT: Record<string, string> = { fund: 'lp_commitment', spv: 'spv', grant_rail: 'grant' };

async function ownDraft(actor: Actor, draftId: string, q?: Queryable): Promise<Draft> {
  const d = await getDraft(draftId, q);
  if (!d || d.ownerId !== actor.id) throw new DraftRefused('That draft is not yours, or it does not exist.');
  return d;
}

// ── Create ──────────────────────────────────────────────────────────────────────────────

export interface NewDraft {
  purpose: DraftPurpose;
  vehicleId: string;
  pursuitId?: string | null;
  /** The LP. For an intro ask, the target. */
  entityId?: string | null;
  connectorId?: string | null;
  replyToDraftId?: string | null;
}

/** Start a draft with its first words filled in, and its own Message-ID. */
export async function createDraft(actor: Actor, n: NewDraft): Promise<string> {
  const vehicles = await listVehicles();
  let vehicle = vehicles.find((v) => v.id === n.vehicleId);
  let entityId = n.entityId ?? null;
  let pursuitId = n.pursuitId ?? null;
  if (pursuitId) {
    const p = await getPursuit(pursuitId);
    if (!p) throw new DraftRefused('No such LP.');
    entityId = p.entityId;
    vehicle = vehicles.find((v) => v.id === p.vehicleId);
  }
  if (!vehicle) throw new DraftRefused('No such vehicle.');
  const [lp, connector] = await Promise.all([entityId ? getEntity(entityId) : null, n.connectorId ? getEntity(n.connectorId) : null]);
  if (n.purpose === 'intro_ask' && (!connector || !lp)) throw new DraftRefused('An intro ask needs the connector and the LP.');

  const previous = n.replyToDraftId ? await ownDraft(actor, n.replyToDraftId) : null;
  if (n.purpose === 'follow_up' && (!previous || previous.status !== 'in_gmail')) throw new DraftRefused('A follow-up answers a draft that was moved to Gmail.');

  let strategy: { angle: string; askShape: string; suggestionId: string; madeAt: string } | null = null;
  if (n.purpose === 'first_message' && pursuitId) {
    const s = (await suggestionsFor(pursuitId)).find((x) => x.status !== 'dismissed');
    const data = s?.data as { angle?: unknown; ask?: { shape?: unknown } } | undefined;
    if (s && typeof data?.angle === 'string' && data.angle.trim()) strategy = { angle: data.angle.trim(), askShape: String(data.ask?.shape ?? ''), suggestionId: s.suggestionId, madeAt: s.madeAt.toISOString() };
  }
  const start = prefillDraft({
    purpose: n.purpose, senderName: actor.name, vehicleName: vehicle.name, lpName: lp?.displayName ?? null, lpIsPerson: lp?.entityType === 'person',
    connectorName: connector?.displayName ?? null, connectorIsPerson: connector?.entityType === 'person', strategy, previousSubject: previous?.subject ?? null,
  });
  // The address on record, when the research found one; the person checks it.
  const recipient = n.purpose === 'intro_ask' ? connector : lp;
  const to = n.purpose === 'follow_up' ? previous!.to
    : !recipient ? []
      : (await claimsFor(recipient.entityId).catch(() => []))
        .filter((c) => /(^|\.)email$/.test(c.field) && parseAddresses(c.value).ok.length === 1).map((c) => c.value.trim()).slice(0, 1);
  const thread: ThreadHeaders = previous
    ? replyTo({ messageId: previous.messageId, references: previous.references, subject: previous.subject, threadId: previous.gmailThreadId }, start.subject)
    : newThread(start.subject);
  const domain = actor.email.split('@')[1] ?? null;
  const db = await getDb();
  return db.transaction(async (tx) => {
    const id = await insertDraft({
      ownerId: actor.id, purpose: n.purpose, vehicleId: vehicle!.id, pursuitId, entityId, connectorId: connector?.entityId ?? null,
      to, subject: thread.subject, mode: 'rich', doc: start.doc, bodyText: renderText(start.doc), prefill: start.prefill,
      messageId: newMessageId(domain), replyToDraftId: previous?.draftId ?? null, inReplyTo: thread.inReplyTo, references: thread.references,
      gmailThreadId: thread.threadId,
    }, tx);
    await appendAudit({ actorId: actor.id, action: 'email.draft_created', subjectType: 'email_draft', subjectId: id, detail: { purpose: n.purpose, vehicleId: vehicle!.id, pursuitId, prefill: start.prefill.source } }, tx);
    return id;
  });
}

// ── Edit ────────────────────────────────────────────────────────────────────────────────

export interface DraftEdit {
  revision: number;
  to: string; cc: string; bcc: string;
  subject: string;
  mode: DraftMode;
  /** The editor's JSON, in rich mode. Normalised here whatever it holds. */
  doc?: unknown;
  /** What was typed, in plain mode. */
  text?: string;
}

const MAX_SUBJECT = 300; // GUESS: a subject line, not a paragraph.
const MAX_TEXT = 200_000; // GUESS: a long letter is 20 KB.

export interface Saved { revision: number; stripped: string[]; bad: string[] }

/** Save an edit. Refused when someone saved a newer one first, so neither silently loses work. */
export async function saveDraft(actor: Actor, draftId: string, e: DraftEdit): Promise<Saved> {
  const d = await ownDraft(actor, draftId);
  if (d.status === 'discarded') throw new DraftRefused('This draft was discarded.');
  const lists = [parseAddresses(e.to), parseAddresses(e.cc), parseAddresses(e.bcc)];
  const subject = e.subject.replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_SUBJECT);
  let doc: DocNode | null = null;
  let text: string;
  let stripped: string[] = [];
  if (e.mode === 'plain') {
    text = String(e.text ?? '').replace(/\r\n?/g, '\n').slice(0, MAX_TEXT);
  } else {
    const n = normalizeDoc(e.doc);
    doc = n.doc;
    stripped = n.stripped;
    const live = new Set(d.attachments.map((a) => a.attachmentId));
    // A picture is shown only if it is one of this draft's attachments.
    const drop = inlineImages(doc).filter((id) => !live.has(id));
    if (drop.length) {
      doc = normalizeDoc(JSON.parse(JSON.stringify(doc), (k, v) => (v && typeof v === 'object' && v.type === 'emailImage' && drop.includes(v.attrs?.attachmentId) ? { type: 'paragraph' } : v))).doc;
      stripped.push('image:not-on-this-draft');
    }
    text = renderText(doc, (id) => d.attachments.find((a) => a.attachmentId === id)?.filename ?? null);
    if (text.length > MAX_TEXT) throw new DraftRefused('This draft is too long for an email.');
  }
  const db = await getDb();
  const revision = await db.transaction(async (tx) => updateDraftBody(draftId, e.revision, {
    to: lists[0]!.ok.map(formatAddr), cc: lists[1]!.ok.map(formatAddr), bcc: lists[2]!.ok.map(formatAddr), subject, mode: e.mode, doc, bodyText: text,
  }, tx));
  if (revision === null) throw new DraftRefused('This draft was changed since you opened it — in another tab, or by a move. Reload to see the latest, then make your edit again.');
  return { revision, stripped, bad: lists.flatMap((l) => l.bad) };
}

const formatAddr = (a: Address) => (a.name ? `${a.name} <${a.email}>` : a.email);

export async function discardDraft(actor: Actor, draftId: string): Promise<void> {
  const d = await ownDraft(actor, draftId);
  const db = await getDb();
  await db.transaction(async (tx) => {
    await setStatus(draftId, 'discarded', tx);
    await appendAudit({ actorId: actor.id, action: 'email.draft_discarded', subjectType: 'email_draft', subjectId: draftId, detail: { inGmail: d.status === 'in_gmail' } }, tx);
  });
}

// ── Attachments ─────────────────────────────────────────────────────────────────────────

const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const pathOf = (sha: string) => join(config.email.attachmentsDir, sha.slice(0, 2), sha);

export async function addAttachment(actor: Actor, draftId: string, file: { filename: string; contentType: string; bytes: Uint8Array; inline: boolean }): Promise<Attachment> {
  const d = await ownDraft(actor, draftId);
  if (d.status === 'discarded') throw new DraftRefused('This draft was discarded.');
  const name = file.filename.replace(/[\u0000-\u001f\u007f/\\]/g, '_').trim().slice(0, 200) || 'attachment';
  if (file.bytes.length === 0) throw new DraftRefused(`${name} is empty.`);
  if (file.bytes.length > config.email.maxAttachmentBytes) throw new DraftRefused(`${name} is ${mb(file.bytes.length)}; one file may be at most ${mb(config.email.maxAttachmentBytes)}.`);
  if (d.attachments.length >= config.email.maxAttachments) throw new DraftRefused(`A draft may carry at most ${config.email.maxAttachments} files.`);
  const total = d.attachments.reduce((s, a) => s + a.sizeBytes, 0) + file.bytes.length;
  if (total > config.email.maxTotalBytes) throw new DraftRefused(`With ${name} this draft would carry ${mb(total)}; at most ${mb(config.email.maxTotalBytes)} fits in one Gmail message.`);
  const type = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(file.contentType) ? file.contentType.toLowerCase() : 'application/octet-stream';
  const inline = file.inline && INLINE_TYPES.has(type);
  const sha = createHash('sha256').update(file.bytes).digest('hex');
  const path = pathOf(sha);
  await mkdir(join(config.email.attachmentsDir, sha.slice(0, 2)), { recursive: true, mode: 0o700 });
  await writeFile(`${path}.tmp`, file.bytes, { mode: 0o600 });
  await rename(`${path}.tmp`, path);
  const db = await getDb();
  return db.transaction(async (tx) => {
    const a = await insertAttachment({ draftId, filename: name, contentType: type, sizeBytes: file.bytes.length, sha256: sha, inline, createdBy: actor.id }, tx);
    await appendAudit({ actorId: actor.id, action: 'email.attachment_added', subjectType: 'email_draft', subjectId: draftId, detail: { bytes: file.bytes.length, inline, type } }, tx);
    return a;
  });
}

export async function removeAttachment(actor: Actor, attachmentId: string): Promise<void> {
  const a = await getAttachment(attachmentId);
  if (!a || a.ownerId !== actor.id) throw new DraftRefused('That file is not on a draft of yours.');
  const db = await getDb();
  await db.transaction((tx) => removeAttachmentRow(attachmentId, tx));
}

/** The bytes, for the owner only: the editor's picture, or a download. */
export async function readAttachment(actor: Actor, attachmentId: string): Promise<{ attachment: Attachment; bytes: Buffer }> {
  const a = await getAttachment(attachmentId);
  if (!a || a.ownerId !== actor.id) throw new DraftRefused('That file is not on a draft of yours.');
  return { attachment: a, bytes: await readFile(pathOf(a.sha256)) };
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n < 1024 * 1024 ? 2 : 1)} MB`;

// ── Checks, MIME and the move ───────────────────────────────────────────────────────────

/** The draft-time checks, from the records (rules 3, 8, 11, 12). */
export async function warningsFor(d: Draft): Promise<DraftWarning[]> {
  const vehicles = await listVehicles();
  const vehicle = vehicles.find((v) => v.id === d.vehicleId)!;
  const instrument = INSTRUMENT[vehicle.kind] ?? 'lp_commitment';
  const [lpR, cR, rules, gate, asks] = await Promise.all([
    d.entityId ? restrictionsFor(d.entityId) : [],
    d.connectorId ? restrictionsFor(d.connectorId) : [],
    listWrapRules(),
    vehicle.kind === 'grant_rail' && d.entityId ? grantGate(d.entityId) : null,
    d.purpose === 'intro_ask' ? listAsks(d.vehicleId) : [],
  ]);
  const rule = rules.find((r) => r.exemption === vehicle.exemption && r.instrument === instrument);
  const own = draftWarnings({
    purpose: d.purpose,
    vehicle: { id: vehicle.id, name: vehicle.name, slug: vehicle.slug, kind: vehicle.kind, exemption: vehicle.exemption },
    otherVehicles: vehicles.filter((v) => v.id !== vehicle.id && v.phase !== 'historical').map((v) => ({ name: v.name, slug: v.slug })),
    lpRestrictions: lpR, connectorId: d.connectorId, connectorName: d.connectorName,
    connectorRestrictions: cR,
    wrap: { found: !!rule, note: rule?.note ?? null, maxPermittedUse: rule?.maxPermittedUse ?? null, instrument },
    grantGate: gate,
    introAsks: asks.filter((a) => a.entityId === d.entityId).map((a) => ({ status: a.status, connectorId: a.connectorId })),
    subject: d.subject, text: d.bodyText, attachmentCount: d.attachments.filter((a) => !a.inline).length,
  });
  if (!d.to.length) own.push({ level: 'check', rule: 'recipients', text: 'No recipient yet.' });
  return own;
}

/** What stops a move outright. */
export function moveBlocks(d: Draft): MoveBlock[] {
  const out: MoveBlock[] = [];
  if (!d.to.length) out.push({ field: 'to', text: 'Add at least one address to send to.' });
  if (!d.subject.trim()) out.push({ field: 'subject', text: 'Add a subject.' });
  if (d.mode === 'plain' ? !d.bodyText.trim() : isEmptyDoc(d.doc ?? textToDoc(''))) out.push({ field: 'body', text: 'Write something first.' });
  const total = d.attachments.reduce((s, a) => s + a.sizeBytes, 0);
  if (total > config.email.maxTotalBytes) out.push({ field: 'size', text: `The files come to ${mb(total)}, over the ${mb(config.email.maxTotalBytes)} a Gmail message can carry.` });
  return out;
}

/**
 * The message as mailguard will build it, for Preview: mailguard writes the MIME itself from fields,
 * with no place for a picture inside the text, so pictures travel as files (docs/25 §12.2).
 */
export async function mimeFor(d: Draft, from: Address | null, thread: { inReplyTo: string | null; references: string[]; subject: string }, messageId = d.messageId): Promise<string> {
  const files = await Promise.all(d.attachments.map(async (a) => ({ a, bytes: await readFile(pathOf(a.sha256)) })));
  const html = d.mode === 'rich' && d.doc ? renderHtml(d.doc, { imageSrc: () => null }) : null;
  return buildMime({
    from, to: parseAddresses(d.to.join(', ')).ok, cc: parseAddresses(d.cc.join(', ')).ok, bcc: parseAddresses(d.bcc.join(', ')).ok,
    subject: thread.subject, text: d.bodyText, html,
    attachments: files.map(({ a, bytes }) => ({ filename: a.filename, contentType: a.contentType, data: bytes })),
    messageId, inReplyTo: thread.inReplyTo, references: thread.references, date: new Date(),
  });
}

/**
 * One recipient as mailguard takes it. Mailguard drops every character outside printable ASCII from a
 * display name, so a name that has one is left off rather than mangled; quotes and angle brackets are
 * dropped so it cannot be read as another address.
 */
export function recipientFor(a: Address): string {
  const name = (a.name ?? '').replace(/["<>\\]/g, '').trim();
  return name && /^[\x20-\x7e]+$/.test(name) ? `${name} <${a.email}>` : a.email;
}

/** The draft as mailguard's fields. */
async function fieldsFor(d: Draft, replyToId: string | null): Promise<DraftFields> {
  const files = await Promise.all(d.attachments.map(async (a) => ({ filename: a.filename, mimeType: a.contentType, data: (await readFile(pathOf(a.sha256))).toString('base64') })));
  const list = (xs: string[]) => parseAddresses(xs.join(', ')).ok.map(recipientFor);
  const html = d.mode === 'rich' && d.doc ? renderHtml(d.doc, { imageSrc: () => null }) : undefined;
  return {
    to: list(d.to), cc: list(d.cc), bcc: list(d.bcc), subject: d.subject, text: d.bodyText,
    ...(html ? { html } : {}), ...(replyToId ? { replyTo: replyToId } : {}), ...(files.length ? { attachments: files } : {}),
  };
}

export interface Preview { outline: OutlineRow[]; raw: string; bytes: number; warnings: DraftWarning[]; blocks: MoveBlock[] }

export async function previewDraft(actor: Actor, draftId: string): Promise<Preview> {
  const d = await ownDraft(actor, draftId);
  const account = await mailguardAccountOf(actor.id);
  const raw = await mimeFor(d, account?.checkOk ? { name: actor.name, email: account.mailbox } : null, { inReplyTo: d.inReplyTo, references: d.references, subject: d.subject });
  return { outline: outline(raw), raw: elide(raw), bytes: Buffer.byteLength(raw), warnings: await warningsFor(d), blocks: moveBlocks(d) };
}

export type ThreadSource = 'thread' | 'new' | 'unthreaded';

/**
 * For a follow-up, the Gmail message it answers: the latest message in the earlier draft's thread that
 * is not itself a draft, read through mailguard (ids and labels only). Mailguard sets the thread and
 * the reply headers from it. Without read.metadata, or before anything in the thread was sent, the
 * follow-up is a new thread, and the receipt says so.
 */
async function threadFor(d: Draft, client: MailguardClient, canThread: boolean): Promise<{ replyTo: string | null; source: ThreadSource }> {
  if (d.purpose !== 'follow_up' || !d.replyToDraftId) return { replyTo: null, source: 'new' };
  const prev = await getDraft(d.replyToDraftId);
  if (!prev?.gmailThreadId || !canThread) return { replyTo: null, source: 'unthreaded' };
  const latest = ((await client.thread(prev.gmailThreadId)) ?? []).filter((m) => !m.labels.includes('DRAFT')).at(-1);
  return latest ? { replyTo: latest.id, source: 'thread' } : { replyTo: null, source: 'unthreaded' };
}

export interface Moved { gmailDraftId: string; account: string; threadId: string; replaced: boolean; newMessageId: boolean; warnings: DraftWarning[]; threadSource: ThreadSource }

/**
 * Move a draft into the person's Gmail Drafts through mailguard: create it there, or replace the copy
 * this key made before. If that copy is gone — sent or deleted in Gmail — a new one is made. The key is
 * checked first, every time: a key that can send (or whose permissions cannot be read) stops the move
 * before anything is written. Every move is audit-logged with what it carried (counts, never words or
 * addresses) and the warnings that were showing.
 */
export async function moveDraft(actor: Actor, draftId: string, runtime?: MailguardRuntime): Promise<Moved> {
  const d = await ownDraft(actor, draftId);
  if (d.status === 'discarded') throw new DraftRefused('This draft was discarded.');
  const blocks = moveBlocks(d);
  if (blocks.length) throw new DraftRefused(blocks.map((b) => b.text).join(' '), blocks);
  const rt = runtime ?? mailguardRuntime();
  if (rt.mode === 'off') throw new DraftRefused(rt.why, [{ field: 'connection', text: rt.why }]);
  const db = await getDb();
  if (!(await claimMove(draftId, db))) throw new DraftRefused('This draft is being moved already. Wait a moment and reload.');
  const warnings = await warningsFor(d);
  const t0 = Date.now();
  let requests = 0;
  try {
    const { client, inspection } = await checkedClient(rt, actor.handle, () => { requests++; });
    await recordCheck(actor, inspection, rt, null);
    const thread = await threadFor(d, client, inspection.canThread);
    const fields = await fieldsFor(d, thread.replyTo);
    const updated = d.gmailDraftId ? await client.updateDraft(d.gmailDraftId, fields) : null;
    const replaced = !!updated;
    const ref = updated ?? await client.createDraft(fields);
    // When the old Gmail copy was sent or deleted there, this is a new email: a new Message-ID in our records too.
    const renewed = !!d.gmailDraftId && !replaced;
    const messageId = renewed ? newMessageId(inspection.mailbox.split('@')[1]) : d.messageId;
    const bytes = Buffer.byteLength(JSON.stringify(fields));
    await db.transaction(async (tx) => {
      await recordMoved(draftId, { account: inspection.mailbox, gmailDraftId: ref.draftId, gmailMessageId: ref.messageId, gmailThreadId: ref.threadId, revision: d.revision, messageId, inReplyTo: d.inReplyTo, references: d.references }, tx);
      await touchMailguardAccount(actor.id, tx);
      await appendAudit({
        actorId: actor.id, action: 'email.draft_moved', subjectType: 'email_draft', subjectId: draftId,
        detail: {
          purpose: d.purpose, vehicleId: d.vehicleId, pursuitId: d.pursuitId, revision: d.revision, gmailDraftId: ref.draftId, threadId: ref.threadId,
          replaced, newMessageId: renewed, threadSource: thread.source, mode: d.mode, recipients: d.to.length + d.cc.length + d.bcc.length,
          attachments: d.attachments.length, bytes, requests, ms: Date.now() - t0, transport: rt.mode,
          warnings: warnings.map((w) => `${w.level}:${w.rule}`),
        },
      }, tx);
    });
    return { gmailDraftId: ref.draftId, account: inspection.mailbox, threadId: ref.threadId, replaced, newMessageId: renewed, warnings, threadSource: thread.source };
  } catch (e) {
    await releaseMove(draftId).catch(() => undefined);
    const code = e instanceof KeyRefused ? e.inspection.code : e instanceof MailguardError ? e.kind : undefined;
    await appendAudit({ actorId: actor.id, action: 'email.draft_move_failed', subjectType: 'email_draft', subjectId: draftId, detail: { requests, error: e instanceof Error ? e.name : 'unknown', code, transport: rt.mode } }).catch(() => undefined);
    if (e instanceof KeyRefused) {
      await recordCheck(actor, e.inspection, rt, isTransient(e.inspection.code) ? null : 'email.mailguard_refused').catch(() => undefined);
      throw new DraftRefused(isTransient(e.inspection.code) ? e.message : `${e.message} Email drafting is off for you until a drafts-only token is connected in Preferences → Email.`, [{ field: 'connection', text: e.message }]);
    }
    if (e instanceof NotConnected) throw new DraftRefused(e.message, [{ field: 'connection', text: e.message }]);
    if (e instanceof MailguardError) throw new DraftRefused(e.message);
    throw e;
  }
}

// ── Reads for the pages ─────────────────────────────────────────────────────────────────

export async function draftsOn(actor: Actor, where: { pursuitId?: string; entityId?: string; connectorId?: string; vehicleId?: string }): Promise<Draft[]> {
  return draftsFor(actor.id, where);
}

export async function draftWithChecks(actor: Actor, draftId: string): Promise<{ draft: Draft; warnings: DraftWarning[]; blocks: MoveBlock[] }> {
  const draft = await ownDraft(actor, draftId);
  return { draft, warnings: await warningsFor(draft), blocks: moveBlocks(draft) };
}

// ── The mailguard connection ────────────────────────────────────────────────────────────

export interface MailStatus {
  mode: 'mailguard' | 'fake' | 'off';
  /** Why drafting is off on this server. */
  why: string | null;
  /** A key is connected for this person (pasted, or the Keychain's). */
  connected: boolean;
  /** The last check found it drafts-only. */
  ok: boolean;
  mailbox: string | null;
  tool: string | null;
  capabilities: string[];
  /** Capabilities beyond drafting and thread headers: allowed, but more than this tool needs. */
  extras: string[];
  canThread: boolean;
  source: 'pasted' | 'keychain' | null;
  checkedAt: string | null;
  /** Why the key was refused, in words. */
  reason: string | null;
  code: string | null;
  /** The check failed because mailguard did not answer, not because of the key. */
  transient: boolean;
}

const off = (mode: MailStatus['mode'], why: string | null): MailStatus => ({ mode, why, connected: false, ok: false, mailbox: null, tool: null, capabilities: [], extras: [], canThread: false, source: null, checkedAt: null, reason: null, code: null, transient: false });

function statusOf(mode: 'mailguard' | 'fake', i: Inspection | null): MailStatus {
  if (!i) return off(mode, null);
  return {
    mode, why: null, connected: true, ok: i.ok, mailbox: i.mailbox, tool: i.tool, capabilities: i.capabilities, extras: i.ok ? i.extras : [],
    canThread: i.ok && i.canThread, source: i.source, checkedAt: new Date(i.at).toISOString(), reason: i.ok ? null : i.reason, code: i.ok ? null : i.code, transient: !i.ok && isTransient(i.code),
  };
}

/** Keep the account row in step with a check, and audit when asked. Never the key, never the address in the audit. */
async function recordCheck(actor: Actor, i: Inspection, rt: MailguardRuntime, action: 'email.mailguard_connected' | 'email.mailguard_refused' | 'email.mailguard_checked' | null): Promise<void> {
  const db = await getDb();
  await db.transaction(async (tx) => {
    if (i.mailbox) await recordMailguardCheck(actor.id, { mailbox: i.mailbox, toolName: i.tool ?? '', capabilities: i.capabilities, source: i.source, ok: i.ok, code: i.ok ? null : i.code }, tx);
    if (action) {
      await appendAudit({
        actorId: actor.id, action, subjectType: 'app_user', subjectId: actor.id,
        detail: { ok: i.ok, code: i.ok ? null : i.code, capabilities: i.capabilities, source: i.source, transport: rt.mode, ...(action === 'email.mailguard_refused' ? { stored: i.source === 'keychain' } : {}) },
      }, tx);
    }
  });
}

/** The person's connection for Preferences and the draft boxes: the key checked at most a day ago. */
export async function mailStatus(actor: Actor): Promise<MailStatus> {
  const rt = mailguardRuntime();
  if (rt.mode === 'off') return off('off', rt.why);
  const c = await connection(rt, actor.handle);
  if (c.inspection) {
    const row = await mailguardAccountOf(actor.id);
    // A check newer than the row: record it, and audit a key that stopped passing.
    if (!row || row.checkedAt.getTime() < c.inspection.at - 1000) {
      await recordCheck(actor, c.inspection, rt, !c.inspection.ok && !isTransient(c.inspection.code) && (row?.checkOk ?? true) ? 'email.mailguard_refused' : null);
    }
  }
  return statusOf(rt.mode, c.inspection);
}

/** Check a pasted key and keep it only if mailguard says it cannot send. */
export async function connectMailguard(actor: Actor, key: string, runtime?: MailguardRuntime): Promise<MailStatus> {
  const rt = runtime ?? mailguardRuntime();
  if (rt.mode === 'off') throw new DraftRefused(rt.why);
  try {
    const i = await connectKey(rt, actor.handle, key);
    await recordCheck(actor, i, rt, 'email.mailguard_connected');
    return statusOf(rt.mode, i);
  } catch (e) {
    if (e instanceof KeyRefused) {
      // Not stored. The audit says what was refused and why, never the key.
      const db = await getDb();
      await appendAudit({ actorId: actor.id, action: 'email.mailguard_refused', subjectType: 'app_user', subjectId: actor.id, detail: { ok: false, code: e.inspection.code, capabilities: e.inspection.capabilities, source: 'pasted', stored: false, transport: rt.mode } }, db);
      throw new DraftRefused(e.message);
    }
    throw e;
  }
}

/** Test the connection: one `GET /api/v1/me`, no draft. */
export async function testMailguard(actor: Actor, runtime?: MailguardRuntime): Promise<MailStatus> {
  const rt = runtime ?? mailguardRuntime();
  if (rt.mode === 'off') return off('off', rt.why);
  const c = await connection(rt, actor.handle, 0);
  if (!c.inspection) throw new DraftRefused('No mailguard token is connected for you yet.');
  await recordCheck(actor, c.inspection, rt, c.inspection.ok ? 'email.mailguard_checked' : 'email.mailguard_refused');
  return statusOf(rt.mode, c.inspection);
}

/** Forget a pasted key here. Mailguard keeps it until it is revoked there. */
export async function forgetMailguard(actor: Actor, runtime?: MailguardRuntime): Promise<{ keychainRemains: boolean }> {
  const rt = runtime ?? mailguardRuntime();
  if (rt.mode === 'off') return { keychainRemains: false };
  const r = await forgetKey(rt, actor.handle);
  const db = await getDb();
  await db.transaction(async (tx) => {
    await deleteMailguardAccount(actor.id, tx);
    await appendAudit({ actorId: actor.id, action: 'email.mailguard_forgotten', subjectType: 'app_user', subjectId: actor.id, detail: { ...r, transport: rt.mode } }, tx);
  });
  return { keychainRemains: r.keychainRemains };
}

/** The demo only: an invented drafts-only key from the fake mailguard, connected like a pasted one. */
export async function connectDemoMailguard(actor: Actor, runtime?: MailguardRuntime): Promise<MailStatus> {
  const rt = runtime ?? mailguardRuntime();
  if (rt.mode !== 'fake' || !rt.fakeDir) throw new DraftRefused('Demo tokens exist only on the demo, with its fake mailguard.');
  const key = await fakeMintKey(rt.fakeDir, { mailbox: `${actor.handle}@${FAKE_DOMAIN}` });
  return connectMailguard(actor, key, rt);
}
