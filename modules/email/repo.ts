import { getDb, type Queryable } from '@/lib/db';
import type { DocNode } from '@/lib/email/doc';
import type { Attachment, Draft, DraftMode, DraftPurpose, Prefill } from './types';

interface DraftRow {
  draft_id: string; owner_id: string; owner_handle: string; owner_name: string; purpose: DraftPurpose; vehicle_id: string; vehicle_name: string;
  pursuit_id: string | null; entity_id: string | null; entity_name: string | null; connector_id: string | null; connector_name: string | null;
  to_addrs: string[]; cc_addrs: string[]; bcc_addrs: string[]; subject: string; mode: DraftMode; doc: DocNode | null; body_text: string;
  prefill: Prefill | null; message_id: string; reply_to_draft_id: string | null; in_reply_to: string | null; references_ids: string[];
  status: Draft['status']; revision: number; gmail_account: string | null; gmail_draft_id: string | null; gmail_thread_id: string | null;
  moved_at: Date | string | null; moved_revision: number | null; created_at: Date | string; updated_at: Date | string;
}

const SELECT = `select d.draft_id::text, d.owner_id::text, u.handle owner_handle, u.name owner_name, d.purpose, d.vehicle_id::text, v.name vehicle_name,
    d.pursuit_id::text, d.entity_id::text, e.display_name entity_name, d.connector_id::text, c.display_name connector_name,
    d.to_addrs, d.cc_addrs, d.bcc_addrs, d.subject, d.mode, d.doc, d.body_text, d.prefill, d.message_id, d.reply_to_draft_id::text,
    d.in_reply_to, d.references_ids, d.status, d.revision, d.gmail_account, d.gmail_draft_id, d.gmail_thread_id, d.moved_at, d.moved_revision,
    d.created_at, d.updated_at
  from email.draft d
  join platform.app_user u on u.id = d.owner_id
  join platform.vehicle v on v.id = d.vehicle_id
  left join identity.entity e on e.entity_id = d.entity_id
  left join identity.entity c on c.entity_id = d.connector_id`;

const date = (x: Date | string | null) => (x === null ? null : new Date(x));

function toDraft(r: DraftRow, attachments: Attachment[]): Draft {
  return {
    draftId: r.draft_id, ownerId: r.owner_id, ownerHandle: r.owner_handle, ownerName: r.owner_name, purpose: r.purpose,
    vehicleId: r.vehicle_id, vehicleName: r.vehicle_name, pursuitId: r.pursuit_id, entityId: r.entity_id, entityName: r.entity_name,
    connectorId: r.connector_id, connectorName: r.connector_name, to: r.to_addrs ?? [], cc: r.cc_addrs ?? [], bcc: r.bcc_addrs ?? [],
    subject: r.subject, mode: r.mode, doc: r.doc, bodyText: r.body_text, prefill: r.prefill, messageId: r.message_id,
    replyToDraftId: r.reply_to_draft_id, inReplyTo: r.in_reply_to, references: r.references_ids ?? [], status: r.status,
    revision: r.revision, gmailAccount: r.gmail_account, gmailDraftId: r.gmail_draft_id, gmailThreadId: r.gmail_thread_id,
    movedAt: date(r.moved_at), movedRevision: r.moved_revision, createdAt: new Date(r.created_at), updatedAt: new Date(r.updated_at),
    attachments,
  };
}

interface AttachmentRow { attachment_id: string; draft_id: string; filename: string; content_type: string; size_bytes: number; sha256: string; inline: boolean; content_id: string }
const toAttachment = (a: AttachmentRow): Attachment => ({
  attachmentId: a.attachment_id, filename: a.filename, contentType: a.content_type, sizeBytes: Number(a.size_bytes), sha256: a.sha256, inline: a.inline, contentId: a.content_id,
});

async function attachmentsOf(db: Queryable, ids: string[]): Promise<Map<string, Attachment[]>> {
  const out = new Map<string, Attachment[]>();
  if (!ids.length) return out;
  const rows = await db.query<AttachmentRow>(`select a.attachment_id::text, a.draft_id::text, a.filename, a.content_type, a.size_bytes, a.sha256, a.inline, a.content_id
    from email.attachment a where a.draft_id = any($1::uuid[]) and a.removed_at is null order by a.created_at, a.attachment_id`, [ids]);
  for (const r of rows) out.set(r.draft_id, [...(out.get(r.draft_id) ?? []), toAttachment(r)]);
  return out;
}

export async function getDraft(draftId: string, q?: Queryable): Promise<Draft | null> {
  const db = q ?? (await getDb());
  const row = await db.one<DraftRow>(`${SELECT} where d.draft_id = $1`, [draftId]);
  if (!row) return null;
  return toDraft(row, (await attachmentsOf(db, [row.draft_id])).get(row.draft_id) ?? []);
}

/** A person's drafts about one pursuit, or to one connector about one target, newest first; discarded ones left out. */
export async function draftsFor(ownerId: string, where: { pursuitId?: string; entityId?: string; connectorId?: string; vehicleId?: string }, q?: Queryable): Promise<Draft[]> {
  const db = q ?? (await getDb());
  const conds = ['d.owner_id = $1', "d.status <> 'discarded'"];
  const args: unknown[] = [ownerId];
  if (where.pursuitId) { args.push(where.pursuitId); conds.push(`d.pursuit_id = $${args.length}`); }
  if (where.entityId) { args.push(where.entityId); conds.push(`d.entity_id = $${args.length}`); }
  if (where.connectorId) { args.push(where.connectorId); conds.push(`d.connector_id = $${args.length}`); }
  if (where.vehicleId) { args.push(where.vehicleId); conds.push(`d.vehicle_id = $${args.length}`); }
  const rows = await db.query<DraftRow>(`${SELECT} where ${conds.join(' and ')} order by d.updated_at desc, d.draft_id limit 20`, args);
  const att = await attachmentsOf(db, rows.map((r) => r.draft_id));
  return rows.map((r) => toDraft(r, att.get(r.draft_id) ?? []));
}

export async function insertDraft(d: {
  ownerId: string; purpose: DraftPurpose; vehicleId: string; pursuitId: string | null; entityId: string | null; connectorId: string | null;
  to: string[]; subject: string; mode: DraftMode; doc: DocNode | null; bodyText: string; prefill: Prefill | null; messageId: string;
  replyToDraftId: string | null; inReplyTo: string | null; references: string[]; gmailThreadId: string | null;
}, q: Queryable): Promise<string> {
  const row = await q.one<{ id: string }>(`insert into email.draft (owner_id, purpose, vehicle_id, pursuit_id, entity_id, connector_id, to_addrs, subject, mode, doc, body_text,
      prefill, message_id, reply_to_draft_id, in_reply_to, references_ids, gmail_thread_id)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning draft_id::text id`,
  [d.ownerId, d.purpose, d.vehicleId, d.pursuitId, d.entityId, d.connectorId, d.to, d.subject, d.mode, d.doc ? JSON.stringify(d.doc) : null, d.bodyText,
    d.prefill ? JSON.stringify(d.prefill) : null, d.messageId, d.replyToDraftId, d.inReplyTo, d.references, d.gmailThreadId]);
  return row!.id;
}

/** Save an edit if nobody saved one since `revision`; null when they did. */
export async function updateDraftBody(draftId: string, revision: number, v: {
  to: string[]; cc: string[]; bcc: string[]; subject: string; mode: DraftMode; doc: DocNode | null; bodyText: string;
}, q: Queryable): Promise<number | null> {
  const row = await q.one<{ revision: number }>(`update email.draft set to_addrs = $3, cc_addrs = $4, bcc_addrs = $5, subject = $6, mode = $7, doc = $8, body_text = $9,
      revision = revision + 1, updated_at = now()
    where draft_id = $1 and revision = $2 and status <> 'discarded' returning revision`,
  [draftId, revision, v.to, v.cc, v.bcc, v.subject, v.mode, v.doc ? JSON.stringify(v.doc) : null, v.bodyText]);
  return row?.revision ?? null;
}

/** Take the move lock; false when another move started in the last two minutes. */
export async function claimMove(draftId: string, q: Queryable): Promise<boolean> {
  // GUESS: a move takes seconds; a lock older than two minutes belongs to a request that died.
  const row = await q.one<{ draft_id: string }>(`update email.draft set moving_since = now()
    where draft_id = $1 and status <> 'discarded' and (moving_since is null or moving_since < now() - interval '2 minutes') returning draft_id::text`, [draftId]);
  return !!row;
}

export async function releaseMove(draftId: string, q?: Queryable): Promise<void> {
  const db = q ?? (await getDb());
  await db.query('update email.draft set moving_since = null where draft_id = $1', [draftId]);
}

export async function recordMoved(draftId: string, v: {
  account: string; gmailDraftId: string; gmailMessageId: string; gmailThreadId: string; revision: number; messageId: string; inReplyTo: string | null; references: string[];
}, q: Queryable): Promise<void> {
  await q.query(`update email.draft set status = 'in_gmail', gmail_account = $2, gmail_draft_id = $3, gmail_message_id = $4, gmail_thread_id = $5,
      moved_at = now(), moved_revision = $6, message_id = $7, in_reply_to = $8, references_ids = $9, moving_since = null
    where draft_id = $1`, [draftId, v.account, v.gmailDraftId, v.gmailMessageId, v.gmailThreadId, v.revision, v.messageId, v.inReplyTo, v.references]);
}

export async function setStatus(draftId: string, status: Draft['status'], q: Queryable): Promise<void> {
  await q.query('update email.draft set status = $2, updated_at = now() where draft_id = $1', [draftId, status]);
}

export async function insertAttachment(a: { draftId: string; filename: string; contentType: string; sizeBytes: number; sha256: string; inline: boolean; createdBy: string }, q: Queryable): Promise<Attachment> {
  const row = await q.one<AttachmentRow>(`insert into email.attachment (draft_id, filename, content_type, size_bytes, sha256, inline, content_id, created_by)
    values ($1,$2,$3,$4,$5,$6, gen_random_uuid()::text || '@drafts.plc-raise-tools.invalid', $7)
    returning attachment_id::text, draft_id::text, filename, content_type, size_bytes, sha256, inline, content_id`,
  [a.draftId, a.filename, a.contentType, a.sizeBytes, a.sha256, a.inline, a.createdBy]);
  await q.query('update email.draft set revision = revision + 1, updated_at = now() where draft_id = $1', [a.draftId]);
  return toAttachment(row!);
}

export async function getAttachment(attachmentId: string, q?: Queryable): Promise<(Attachment & { draftId: string; ownerId: string }) | null> {
  const db = q ?? (await getDb());
  const row = await db.one<AttachmentRow & { owner_id: string }>(`select a.attachment_id::text, a.draft_id::text, a.filename, a.content_type, a.size_bytes, a.sha256, a.inline, a.content_id, d.owner_id::text
    from email.attachment a join email.draft d on d.draft_id = a.draft_id where a.attachment_id = $1 and a.removed_at is null`, [attachmentId]);
  return row ? { ...toAttachment(row), draftId: row.draft_id, ownerId: row.owner_id } : null;
}

export async function removeAttachmentRow(attachmentId: string, q: Queryable): Promise<void> {
  const row = await q.one<{ draft_id: string }>('update email.attachment set removed_at = now() where attachment_id = $1 and removed_at is null returning draft_id::text', [attachmentId]);
  if (row) await q.query('update email.draft set revision = revision + 1, updated_at = now() where draft_id = $1', [row.draft_id]);
}

export interface MailguardAccount { mailbox: string; toolName: string; capabilities: string[]; source: 'pasted' | 'keychain'; connectedAt: Date; checkedAt: Date; checkOk: boolean; checkCode: string | null; lastUsedAt: Date | null }

export async function mailguardAccountOf(userId: string, q?: Queryable): Promise<MailguardAccount | null> {
  const db = q ?? (await getDb());
  const r = await db.one<{ mailbox: string; tool_name: string; capabilities: string[]; source: 'pasted' | 'keychain'; connected_at: Date | string; checked_at: Date | string; check_ok: boolean; check_code: string | null; last_used_at: Date | string | null }>(
    'select mailbox, tool_name, capabilities, source, connected_at, checked_at, check_ok, check_code, last_used_at from email.mailguard_account where user_id = $1', [userId]);
  return r ? {
    mailbox: r.mailbox, toolName: r.tool_name, capabilities: r.capabilities, source: r.source, connectedAt: new Date(r.connected_at), checkedAt: new Date(r.checked_at),
    checkOk: r.check_ok, checkCode: r.check_code, lastUsedAt: date(r.last_used_at),
  } : null;
}

/** Record what a check of the person's key found. Another mailbox or source counts as a new connection. */
export async function recordMailguardCheck(userId: string, c: { mailbox: string; toolName: string; capabilities: string[]; source: 'pasted' | 'keychain'; ok: boolean; code: string | null }, q: Queryable): Promise<void> {
  await q.query(`insert into email.mailguard_account (user_id, mailbox, tool_name, capabilities, source, check_ok, check_code) values ($1,$2,$3,$4,$5,$6,$7)
    on conflict (user_id) do update set tool_name = excluded.tool_name, capabilities = excluded.capabilities, checked_at = now(),
      check_ok = excluded.check_ok, check_code = excluded.check_code,
      connected_at = case when email.mailguard_account.mailbox = excluded.mailbox and email.mailguard_account.source = excluded.source
        then email.mailguard_account.connected_at else now() end,
      mailbox = excluded.mailbox, source = excluded.source`, [userId, c.mailbox, c.toolName, c.capabilities, c.source, c.ok, c.code]);
}

export async function deleteMailguardAccount(userId: string, q: Queryable): Promise<void> {
  await q.query('delete from email.mailguard_account where user_id = $1', [userId]);
}

export async function touchMailguardAccount(userId: string, q: Queryable): Promise<void> {
  await q.query('update email.mailguard_account set last_used_at = now() where user_id = $1', [userId]);
}

// ── A sender's voice (docs/email-guidelines.md §Voice) ──────────────────────────────────

export interface VoiceRow { style: string; samples: string[]; updatedAt: Date }

export async function getVoice(userId: string, q?: Queryable): Promise<VoiceRow | null> {
  const db = q ?? (await getDb());
  return db.one<VoiceRow>('select style, samples, updated_at "updatedAt" from email.voice where user_id = $1', [userId]);
}

export async function upsertVoice(userId: string, style: string, samples: string[], q: Queryable): Promise<void> {
  await q.query(`insert into email.voice (user_id, style, samples) values ($1, $2, $3)
    on conflict (user_id) do update set style = excluded.style, samples = excluded.samples, updated_at = now()`, [userId, style, samples]);
}

export async function deleteVoice(userId: string, q: Queryable): Promise<boolean> {
  return (await q.query<{ user_id: string }>('delete from email.voice where user_id = $1 returning user_id::text', [userId])).length > 0;
}
