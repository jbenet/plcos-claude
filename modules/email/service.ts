import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '@/config/deployment';
import { getDb, type Queryable } from '@/lib/db';
import { inlineImages, isEmptyDoc, normalizeDoc, renderHtml, renderText, textToDoc, type DocNode } from '@/lib/email/doc';
import { buildMime, newMessageId, parseAddresses, toBase64Url, type Address } from '@/lib/email/mime';
import { elide, outline, type OutlineRow } from '@/lib/email/mime-parse';
import { latestOf, newThread, replyTo, type ThreadHeaders } from '@/lib/email/threading';
import {
  completeConnect, connection, disconnect, draftClient, gmailRuntime, NotConnected, SCOPES,
  type GmailRuntime, type PendingConnect,
} from '@/lib/connectors/gmail';
import { appendAudit, listVehicles } from '@/modules/platform';
import { getEntity } from '@/modules/identity';
import { getPursuit, suggestionsFor } from '@/modules/strategy';
import { listAsks, restrictionsFor } from '@/modules/coordination';
import { listWrapRules } from '@/modules/content';
import { grantGate } from '@/modules/grants';
import { claimsFor } from '@/modules/research';
import {
  claimMove, deleteGmailAccount, draftsFor, getAttachment, getDraft, gmailAccountOf, insertAttachment, insertDraft, recordMoved, releaseMove,
  removeAttachmentRow, setStatus, touchGmailAccount, updateDraftBody, upsertGmailAccount, getVoice, upsertVoice, deleteVoice,
} from './repo';
import { draftWarnings, prefillDraft } from './rules';
import type { Attachment, Draft, DraftMode, DraftPurpose, DraftWarning, MoveBlock } from './types';

/**
 * Email drafts (docs/25-email-drafts.md). A person writes here and moves the draft into their own
 * Gmail Drafts; they send it from Gmail, or not. Nothing in this module sends, and nothing calls
 * Google except through lib/connectors/gmail, whose client cannot.
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

  // Only the strategy's own first message (W5 `firstMessage`) can start a draft; never its angle or
  // analysis (docs/email-guidelines.md; Juan, 3 Oct 2026: "This is not a good email").
  let strategy: { firstMessage: unknown; suggestionId: string; madeAt: string } | null = null;
  if (n.purpose !== 'follow_up' && pursuitId) {
    const s = (await suggestionsFor(pursuitId)).find((x) => x.status !== 'dismissed' && x.status !== 'withdrawn');
    if (s) strategy = { firstMessage: (s.data as { firstMessage?: unknown } | null)?.firstMessage ?? null, suggestionId: s.suggestionId, madeAt: s.madeAt.toISOString() };
  }
  const start = prefillDraft({
    purpose: n.purpose, senderName: actor.name, vehicleName: vehicle.name, vehicleKind: vehicle.kind,
    otherVehicles: vehicles.filter((v) => v.id !== vehicle!.id && v.phase !== 'historical').map((v) => ({ name: v.name })),
    lpName: lp?.displayName ?? null, lpIsPerson: lp?.entityType === 'person',
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
  const recipientId = d.purpose === 'intro_ask' ? d.connectorId : d.entityId;
  const [lpR, cR, rules, gate, asks, recipient] = await Promise.all([
    d.entityId ? restrictionsFor(d.entityId) : [],
    d.connectorId ? restrictionsFor(d.connectorId) : [],
    listWrapRules(),
    vehicle.kind === 'grant_rail' && d.entityId ? grantGate(d.entityId) : null,
    d.purpose === 'intro_ask' ? listAsks(d.vehicleId) : [],
    recipientId ? getEntity(recipientId) : null,
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
    recipient: recipient ? { name: recipient.displayName, isPerson: recipient.entityType === 'person' } : null,
    intendedSender: d.prefill?.from ?? null, ownerName: d.ownerName,
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

/** The message exactly as it would go to Gmail, apart from the thread fields a move reads from Gmail. */
export async function mimeFor(d: Draft, from: Address | null, thread: { inReplyTo: string | null; references: string[]; subject: string }, messageId = d.messageId): Promise<string> {
  const files = await Promise.all(d.attachments.map(async (a) => ({ a, bytes: await readFile(pathOf(a.sha256)) })));
  const shown = d.mode === 'rich' && d.doc ? new Set(inlineImages(d.doc)) : new Set<string>();
  const html = d.mode === 'rich' && d.doc
    ? renderHtml(d.doc, { imageSrc: (id) => { const a = d.attachments.find((x) => x.attachmentId === id); return a ? `cid:${a.contentId}` : null; } })
    : null;
  return buildMime({
    from, to: parseAddresses(d.to.join(', ')).ok, cc: parseAddresses(d.cc.join(', ')).ok, bcc: parseAddresses(d.bcc.join(', ')).ok,
    subject: thread.subject, text: d.bodyText, html,
    // A picture uploaded but not in the text travels as a file.
    attachments: files.map(({ a, bytes }) => ({ filename: a.filename, contentType: a.contentType, data: bytes, inline: a.inline && shown.has(a.attachmentId), contentId: a.contentId })),
    messageId, inReplyTo: thread.inReplyTo, references: thread.references, date: new Date(),
  });
}

export interface Preview { outline: OutlineRow[]; raw: string; bytes: number; warnings: DraftWarning[]; blocks: MoveBlock[] }

export async function previewDraft(actor: Actor, draftId: string): Promise<Preview> {
  const d = await ownDraft(actor, draftId);
  const account = await connectedAddress(actor);
  const raw = await mimeFor(d, account ? { name: actor.name, email: account } : null, { inReplyTo: d.inReplyTo, references: d.references, subject: d.subject });
  return { outline: outline(raw), raw: elide(raw), bytes: Buffer.byteLength(raw), warnings: await warningsFor(d), blocks: moveBlocks(d) };
}

async function connectedAddress(actor: Actor): Promise<string | null> {
  return (await gmailAccountOf(actor.id))?.email ?? null;
}

/** The thread fields for a follow-up, read from Gmail when the grant allows; else from our records. */
async function threadFor(d: Draft, client: Awaited<ReturnType<typeof draftClient>>): Promise<ThreadHeaders & { source: 'gmail' | 'ours' | 'new' }> {
  if (d.purpose !== 'follow_up' || !d.replyToDraftId) return { ...newThread(d.subject), source: 'new' };
  const prev = await getDraft(d.replyToDraftId);
  if (!prev?.gmailThreadId) return { threadId: null, inReplyTo: d.inReplyTo, references: d.references, subject: d.subject, source: 'ours' };
  if (client.grant.scopes.includes(SCOPES.metadata)) {
    const latest = latestOf(await client.client.threadHeaders(prev.gmailThreadId));
    if (latest) {
      const h = replyTo({ messageId: latest.messageId, references: latest.references, subject: latest.subject, threadId: prev.gmailThreadId }, d.subject);
      // Keep the person's own subject if they changed it from the thread's.
      return { ...h, subject: d.subject.trim() || h.subject, source: 'gmail' };
    }
  }
  return { threadId: prev.gmailThreadId, inReplyTo: d.inReplyTo, references: d.references, subject: d.subject, source: 'ours' };
}

export interface Moved { gmailDraftId: string; account: string; threadId: string; replaced: boolean; newMessageId: boolean; warnings: DraftWarning[]; threadSource: 'gmail' | 'ours' | 'new' }

/**
 * Move a draft into the person's Gmail Drafts: create it there, or replace the copy this tool
 * made before. If that copy is gone — sent or deleted in Gmail — a new one is made with a new
 * Message-ID, so two emails never share one. Every move is audit-logged with what it carried
 * (counts, never words or addresses) and the warnings that were showing.
 */
export async function moveDraft(actor: Actor, draftId: string, origin: string, runtime?: GmailRuntime): Promise<Moved> {
  const d = await ownDraft(actor, draftId);
  if (d.status === 'discarded') throw new DraftRefused('This draft was discarded.');
  const blocks = moveBlocks(d);
  if (blocks.length) throw new DraftRefused(blocks.map((b) => b.text).join(' '), blocks);
  const rt = runtime ?? gmailRuntime(origin);
  if (rt.mode === 'off') throw new DraftRefused(rt.why, [{ field: 'connection', text: rt.why }]);
  if (!(await connection(rt, actor.handle))) throw new DraftRefused('Connect your Gmail first, in Preferences.', [{ field: 'connection', text: 'Not connected.' }]);
  const db = await getDb();
  if (!(await claimMove(draftId, db))) throw new DraftRefused('This draft is being moved already. Wait a moment and reload.');
  const warnings = await warningsFor(d);
  const t0 = Date.now();
  let requests = 0;
  try {
    const client = await draftClient(rt, actor.handle, () => { requests++; });
    const thread = await threadFor(d, client);
    const from = { name: actor.name, email: client.grant.email };
    const replaced = !!d.gmailDraftId && !!(await client.client.getDraft(d.gmailDraftId));
    // The first move keeps the draft's Message-ID. When the old Gmail copy was sent or deleted
    // there, this is a new email, and it gets a new one.
    const renewed = !!d.gmailDraftId && !replaced;
    const messageId = renewed ? newMessageId(client.grant.email.split('@')[1]) : d.messageId;
    const raw = await mimeFor(d, from, thread, messageId);
    const ref = replaced
      ? await client.client.updateDraft(d.gmailDraftId!, toBase64Url(raw), thread.threadId ?? d.gmailThreadId)
      : await client.client.createDraft(toBase64Url(raw), thread.threadId);
    await db.transaction(async (tx) => {
      await recordMoved(draftId, { account: client.grant.email, gmailDraftId: ref!.draftId, gmailMessageId: ref!.messageId, gmailThreadId: ref!.threadId, revision: d.revision, messageId, inReplyTo: thread.inReplyTo, references: thread.references }, tx);
      await touchGmailAccount(actor.id, tx);
      await appendAudit({
        actorId: actor.id, action: 'email.draft_moved', subjectType: 'email_draft', subjectId: draftId,
        detail: {
          purpose: d.purpose, vehicleId: d.vehicleId, pursuitId: d.pursuitId, revision: d.revision, gmailDraftId: ref!.draftId, threadId: ref!.threadId,
          replaced, newMessageId: renewed, threadSource: thread.source, mode: d.mode, recipients: d.to.length + d.cc.length + d.bcc.length,
          attachments: d.attachments.length, bytes: Buffer.byteLength(raw), requests, ms: Date.now() - t0, transport: rt.mode,
          warnings: warnings.map((w) => `${w.level}:${w.rule}`),
        },
      }, tx);
    });
    return { gmailDraftId: ref.draftId, account: client.grant.email, threadId: ref.threadId, replaced, newMessageId: renewed, warnings, threadSource: thread.source };
  } catch (e) {
    await releaseMove(draftId).catch(() => undefined);
    await appendAudit({ actorId: actor.id, action: 'email.draft_move_failed', subjectType: 'email_draft', subjectId: draftId, detail: { requests, error: e instanceof Error ? e.name : 'unknown', transport: rt.mode } }).catch(() => undefined);
    if (e instanceof NotConnected) throw new DraftRefused(e.message, [{ field: 'connection', text: e.message }]);
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

// ── The Gmail connection ────────────────────────────────────────────────────────────────

export interface GmailStatus { mode: 'google' | 'fake' | 'off'; why: string | null; email: string | null; scopes: string[]; connectedAt: string | null; threads: boolean }

export async function gmailStatus(actor: Actor, origin: string): Promise<GmailStatus> {
  const rt = gmailRuntime(origin);
  if (rt.mode === 'off') return { mode: 'off', why: rt.why, email: null, scopes: [], connectedAt: null, threads: false };
  const c = await connection(rt, actor.handle);
  return { mode: rt.mode, why: null, email: c?.email ?? null, scopes: c?.scopes ?? [], connectedAt: c?.connectedAt ?? null, threads: !!c?.scopes.includes(SCOPES.metadata) };
}

export async function finishGmailConnect(actor: Actor, origin: string, code: string, pending: PendingConnect): Promise<string> {
  const rt = gmailRuntime(origin);
  if (rt.mode === 'off') throw new DraftRefused(rt.why);
  if (pending.handle !== actor.handle) throw new DraftRefused('This consent was started by someone else in this browser. Start again.');
  const c = await completeConnect(rt, actor.handle, code, pending);
  const db = await getDb();
  await db.transaction(async (tx) => {
    await upsertGmailAccount(actor.id, c.email, c.scopes, tx);
    await appendAudit({ actorId: actor.id, action: 'email.gmail_connected', subjectType: 'app_user', subjectId: actor.id, detail: { scopes: c.scopes, transport: rt.mode } }, tx);
  });
  return c.email;
}

export async function disconnectGmail(actor: Actor, origin: string): Promise<{ revoked: boolean }> {
  const rt = gmailRuntime(origin);
  const db = await getDb();
  const result = rt.mode === 'off' ? { revoked: false } : await disconnect(rt, actor.handle);
  await db.transaction(async (tx) => {
    await deleteGmailAccount(actor.id, tx);
    await appendAudit({ actorId: actor.id, action: 'email.gmail_disconnected', subjectType: 'app_user', subjectId: actor.id, detail: { revoked: result.revoked, transport: rt.mode } }, tx);
  });
  return result;
}

// ── A sender's voice (docs/email-guidelines.md §Voice) ──────────────────────────────────

export interface Voice { style: string; samples: string[]; updatedAt: Date | null }

export const VOICE_LIMITS = { styleChars: 4000, samples: 5, sampleChars: 6000 }; // GUESSES: a page of notes, a long email each

/** Your own voice: style notes and up to five emails of yours. Empty when you have none. */
export async function voiceOf(actor: Pick<Actor, 'id'>): Promise<Voice> {
  const v = await getVoice(actor.id);
  return v ? { style: v.style, samples: v.samples, updatedAt: v.updatedAt } : { style: '', samples: [], updatedAt: null };
}

/**
 * Save your voice. Your own only, and only what you typed or pasted; the audit entry keeps the
 * lengths, never the words. Saving it empty deletes the row.
 */
export async function saveVoice(actor: Pick<Actor, 'id'>, v: { style: string; samples: string[] }): Promise<Voice> {
  const style = String(v.style ?? '').replace(/\r\n?/g, '\n').trim();
  const samples = (v.samples ?? []).map((x) => String(x ?? '').replace(/\r\n?/g, '\n').trim()).filter(Boolean);
  if (style.length > VOICE_LIMITS.styleChars) throw new DraftRefused(`The notes are over ${VOICE_LIMITS.styleChars.toLocaleString('en-US')} characters. Keep them to what a drafter needs.`);
  if (samples.length > VOICE_LIMITS.samples) throw new DraftRefused(`Up to ${VOICE_LIMITS.samples} sample emails; three to five is plenty.`);
  if (samples.some((x) => x.length > VOICE_LIMITS.sampleChars)) throw new DraftRefused(`A sample is over ${VOICE_LIMITS.sampleChars.toLocaleString('en-US')} characters. Paste one email, without the thread below it.`);
  const db = await getDb();
  await db.transaction(async (tx) => {
    if (!style && !samples.length) {
      const gone = await deleteVoice(actor.id, tx);
      if (gone) await appendAudit({ actorId: actor.id, action: 'email.voice_deleted', subjectType: 'app_user', subjectId: actor.id, detail: {} }, tx);
      return;
    }
    await upsertVoice(actor.id, style, samples, tx);
    await appendAudit({ actorId: actor.id, action: 'email.voice_saved', subjectType: 'app_user', subjectId: actor.id, detail: { styleChars: style.length, samples: samples.length } }, tx);
  });
  return voiceOf(actor);
}
