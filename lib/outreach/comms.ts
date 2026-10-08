import { z } from 'zod';
import { can } from '@/lib/authz';
import { updatesFor } from '@/lib/authz/read/strategy';
import { notesFor } from '@/lib/authz/read/research';
import { linearFor, teamAddresses, traceFor } from '@/lib/comms/read';
import { normalizeMessageId, SOURCE_LABEL, sourceOf, traceState, type SameAs, type TraceSource } from '@/lib/comms/trace';
import { aboutRaise } from '@/lib/connectors/affinity/about';
import { notesAbout } from '@/lib/connectors/affinity/notes';
import { getDb, type Queryable } from '@/lib/db';
import { requireMutationProfile } from '@/lib/mutation-policy';
import { oneLine } from '@/lib/mcp/output';
import { redactHealth } from '@/lib/redact-health';
import { markSendSent } from '@/modules/content';
import { recordAskEmailed } from '@/modules/coordination';
import { AUTONOMOUS, PERSON, requireApprovedTicket, TicketRequired } from '@/modules/governance';
import { CHANNEL_LABEL, DIRECTION_LABEL, aboutThisRaise, eventAbout, raiseWindows, type Touchpoint } from '@/modules/meetings';
import { appendAudit } from '@/modules/platform';
import type { Envelope } from '@/lib/mcp/envelope';
import { OutreachRefused } from './reads';

/**
 * The comms trace for juanmail (Juan, 5 Oct 2026; docs/27-outreach-api.md §5–§6): the email trail is the
 * record, and Capital OS reads it rather than keeping a state of its own.
 *
 *   comms_ingest           the message metadata juanmail sees in Gmail, sent and received. Writes those rows and
 *                          nothing else — no touchpoint, status, rung or ticket. Idempotent by Message-ID.
 *   outreach_link_message  after juanmail sends (or reads) one message about one LP: the message's ids and
 *                          metadata, logged with the agent ticket it used, if any, which is marked used. It creates
 *                          no outreach state either: the trace shows the message when Gmail or Affinity does, and the
 *                          LP page flags a link the trace has not shown. An autonomous send without an approved
 *                          ticket is refused (modules/governance/autonomy.ts); a person's needs none.
 *   comms_trace            one LP's merged timeline: Affinity's emails, meetings and calls, the Gmail messages,
 *                          the notes (PLC OS, Affinity) and linked Linear issues, each with its source, de-duplicated,
 *                          with last touch, who owes a reply and who holds the thread read from it.
 */

interface Ctx { env: Envelope }

const uuid = z.string().uuid();
const isoTime = z.string().datetime({ offset: true });
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const email = z.string().max(254).transform((s) => s.trim().toLowerCase()).refine((s) => EMAIL.test(s), 'not an email address');
const gmailId = z.string().min(1).max(200).regex(/^[\w.@<>+=/-]+$/);
const SKEW_MS = 5 * 60_000; // GUESS — clock skew between juanmail's server and this one.

const keyOf = (messageId: string | undefined, gid: string) => {
  if (messageId) {
    const k = normalizeMessageId(messageId);
    if (!k) throw new OutreachRefused(400, 'messageId is not a Message-ID (<local@host>).');
    return { key: k, real: true };
  }
  return { key: `gmail:${gid}`, real: false };
};

async function pursuitFor(ctx: Ctx, pursuitId: string, q: Queryable, write: boolean) {
  const p = await q.one<{ pursuit_id: string; entity_id: string; vehicle_id: string; vehicle: string; slug: string; name: string }>(
    `select p.pursuit_id::text, identity.canonical_entity_id(p.entity_id)::text entity_id, p.vehicle_id::text, v.name vehicle, v.slug, e.display_name name
       from strategy.pursuit p join platform.vehicle v on v.id = p.vehicle_id join identity.entity e on e.entity_id = identity.canonical_entity_id(p.entity_id)
      where p.pursuit_id = strategy.canonical_pursuit_id($1::uuid)`, [pursuitId]);
  if (!p || !can(ctx.env.principal, write ? 'mutate' : 'read', { vehicle: p.vehicle_id })) throw new OutreachRefused(404, 'No such LP on your vehicles.');
  return p;
}

/** The people and firms on record behind outside addresses: email claims (never licensed ones), and each person's current firm. */
async function entitiesOf(addresses: string[], q: Queryable): Promise<string[]> {
  if (!addresses.length) return [];
  const people = (await q.query<{ id: string }>(`select distinct identity.canonical_entity_id(c.entity_id)::text id
      from research.claim c left join research.source_doc d on d.doc_id = c.source
     where c.superseded_by is null and c.field ~ '(^|\\.)email$' and lower(trim(c.value)) = any($1::text[])
       and c.source !~* '^dakota' and coalesce(d.origin, '') !~* 'dakota'`, [addresses])).map((r) => r.id);
  if (!people.length) return [];
  const firms = (await q.query<{ id: string }>(`select distinct identity.canonical_entity_id(org_entity)::text id from identity.affiliation
     where ended_on is null and identity.canonical_entity_id(person_entity) = any($1::uuid[])`, [people])).map((r) => r.id);
  return [...new Set([...people, ...firms])].sort();
}

// ── comms_ingest ─────────────────────────────────────────────────────────────────────────

const message = z.object({
  messageId: z.string().min(3).max(400).optional().describe('The Message-ID header, e.g. <abc@mail.gmail.com>: the de-duplication key. Without it, the Gmail id is.'),
  gmailMessageId: gmailId, threadId: gmailId.optional(),
  date: isoTime, direction: z.enum(['sent', 'received']).describe('Sent from this mailbox, or received in it.'),
  from: email, to: z.array(email).max(100).default([]), cc: z.array(email).max(100).default([]),
  subject: z.string().max(998).optional(),
  pursuitId: uuid.optional().describe('The LP this message is about, when juanmail knows it (from the queue): counts it for that vehicle.'),
}).strict();
export const ingestInput = z.object({ messages: z.array(message).min(1).max(100) }).strict();

export async function ingest(ctx: Ctx, raw: Record<string, unknown>) {
  requireMutationProfile();
  const a = raw as z.infer<typeof ingestInput>;
  const db = await getDb();
  const owner = ctx.env.owner;
  const [team, about] = await Promise.all([teamAddresses(db),
    db.query<{ slug: string; name: string; aliases: string[] }>(`select slug, name, coalesce(aliases, '{}') aliases from platform.vehicle`)]);
  const out: Array<{ messageId: string; status: 'new' | 'already' | 'unmatched' }> = [];
  for (const m of a.messages) {
    const at = new Date(m.date);
    if (at.getTime() > Date.now() + SKEW_MS) throw new OutreachRefused(400, `A message is dated in the future (${m.gmailMessageId}).`);
    const { key, real } = keyOf(m.messageId, m.gmailMessageId);
    const outside = [m.from, ...m.to, ...m.cc].filter((x) => !team.has(x));
    let entities = await entitiesOf(outside, db);
    let pursuitId: string | null = null;
    if (m.pursuitId) {
      const p = await pursuitFor(ctx, m.pursuitId, db, false);
      pursuitId = p.pursuit_id;
      entities = [...new Set([...entities, p.entity_id])].sort();
    }
    // A message with nobody on record is not kept: it is about no LP here.
    if (!entities.length) { out.push({ messageId: key, status: 'unmatched' }); continue; }
    const ab = aboutRaise(m.subject ?? '', [m.from, ...m.to], about, []);
    const r = await db.one<{ fresh: boolean }>(`insert into email.comms_message (message_id, has_message_id, gmail_id, thread_id, sent_at, direction, from_addr, to_addrs, cc_addrs,
        subject, entity_ids, pursuit_id, about, about_vehicles, about_basis, mailbox_of, token_id, seen_by)
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::uuid[], $12, $13, $14, $15, $16, $17, array[$16]::uuid[])
      on conflict (message_id) do update set
        entity_ids = array(select distinct x from unnest(email.comms_message.entity_ids || excluded.entity_ids) x order by x),
        pursuit_id = coalesce(email.comms_message.pursuit_id, excluded.pursuit_id),
        thread_id = coalesce(email.comms_message.thread_id, excluded.thread_id),
        seen_by = array(select distinct x from unnest(email.comms_message.seen_by || excluded.seen_by) x order by x),
        updated_at = case when email.comms_message.entity_ids @> excluded.entity_ids and email.comms_message.seen_by @> excluded.seen_by
                            and (email.comms_message.pursuit_id is not null or excluded.pursuit_id is null) then email.comms_message.updated_at else now() end
      returning (xmax = 0) as fresh`,
    [key, real, m.gmailMessageId, m.threadId ?? null, at, m.direction === 'sent' ? 'ours' : 'theirs', m.from, m.to, m.cc, m.subject ?? null,
      entities, pursuitId, ab.about, ab.vehicles, ab.basis, owner.id, ctx.env.tokenId]);
    out.push({ messageId: key, status: r?.fresh ? 'new' : 'already' });
  }
  const n = (s: string) => out.filter((x) => x.status === s).length;
  await appendAudit({ actorId: owner.id, action: 'comms.ingested', subjectType: 'mcp_token', subjectId: ctx.env.tokenId,
    detail: { messages: a.messages.length, new: n('new'), already: n('already'), unmatched: n('unmatched') } }, db);
  return { data: {
    new: n('new'), already: n('already'), unmatched: n('unmatched'), messages: out,
    note: 'Metadata only. Nothing else was written: no touchpoint, status, rung or ticket. The LP page and the queue read these with Affinity\'s records, one row per message. A message with nobody on record is not kept.',
  } };
}

// ── outreach_link_message (and the deprecated outreach_record_send) ──────────────────────

export const linkInput = z.object({
  pursuitId: uuid.optional().describe('The LP this message is about. Or pursuitIds, for one message about several.'),
  pursuitIds: z.array(uuid).min(1).max(10).optional()
    .describe('One message about several LPs (1–10), such as an intro ask naming three: linked to each, all or none. Each LP is authorized on its own. A person\'s send only: an autonomous send about several LPs is refused (409), since an approval covers one email about one LP.'),
  gmailMessageId: gmailId, threadId: gmailId.optional(),
  messageId: z.string().min(3).max(400).optional().describe('The Message-ID header: matches the message in the trace.'),
  date: isoTime, direction: z.enum(['sent', 'received']),
  from: email, to: z.array(email).max(50).default([]), cc: z.array(email).max(50).default([]),
  subject: z.string().max(998).optional(),
  ticketId: uuid.optional().describe('The agent ticket this send used, if any. An autonomous send needs one; a person\'s does not. Not with pursuitIds.'),
  body: z.string().max(100_000).optional().describe('Only if you mean to keep it here. Never needed.'),
}).strict();

/** The old shape (outreach_record_send, docs/27 before 5 Oct 2026), kept as an alias for one release. */
export const sentInput = z.object({
  ticketId: uuid, pursuitId: uuid, recipients: z.array(email).min(1).max(10),
  gmailMessageId: gmailId, sentAt: isoTime,
}).strict();

type Ticketed = { kind: 'SEND'; sendId: string; contentSendId: string | null; recipients: string[]; sentAt: Date | null; ticketId: string }
  | { kind: 'INTRO_ASK'; askId: string; ticketId: string; status: string };

/** The agent ticket a message uses: named, or for an autonomous send found among this LP's approved, unused ones. */
async function ticketFor(q: Queryable, ticketId: string | null, pursuitId: string, entityId: string, vehicleId: string, recipients: string[]): Promise<Ticketed | null> {
  const send = await q.one<{ send_id: string; pursuit: string; recipients: string[]; content_send_id: string | null; sent_at: Date | string | null; ticket_id: string }>(
    `select s.send_id::text, strategy.canonical_pursuit_id(s.pursuit_id)::text pursuit, s.recipients, s.content_send_id::text, s.sent_at, s.ticket_id::text
       from email.outreach_send s join governance.approval_ticket t on t.id = s.ticket_id
      where case when $1::uuid is not null then s.ticket_id = $1::uuid
                 else strategy.canonical_pursuit_id(s.pursuit_id) = $2::uuid and s.sent_at is null and t.decision = 'approve'
                      and (t.expires_at is null or t.expires_at > now()) and s.recipients @> $3::text[] end
      order by s.requested_at limit 1 for update of s`, [ticketId, pursuitId, recipients]);
  if (send) {
    if (send.pursuit !== pursuitId) throw new OutreachRefused(409, 'That ticket is for another LP. An approval is for a specific bounded action. Nothing was linked.');
    return { kind: 'SEND', sendId: send.send_id, contentSendId: send.content_send_id, recipients: send.recipients, sentAt: send.sent_at ? new Date(send.sent_at) : null, ticketId: send.ticket_id };
  }
  if (!ticketId) return null;
  const ask = await q.one<{ ask_id: string; status: string; entity: string; vehicle: string }>(`select ask_id::text, status::text, identity.canonical_entity_id(entity_id)::text entity,
      vehicle_id::text vehicle from coordination.ask where ticket_id = $1`, [ticketId]);
  if (ask) {
    if (ask.entity !== entityId || ask.vehicle !== vehicleId) throw new OutreachRefused(409, 'That ticket is for another LP. Nothing was linked.');
    return { kind: 'INTRO_ASK', askId: ask.ask_id, ticketId, status: ask.status };
  }
  throw new OutreachRefused(404, 'No agent send or intro ask is under that ticket. Nothing was linked.');
}

type Desk = Awaited<ReturnType<typeof pursuitFor>>;

/**
 * Use an agent ticket for a sent message, inside the link's transaction: approved, unexpired, sent after the approval,
 * unused, and — for a SEND — every recipient within it; a material's wrap check runs again. Marks it used. Any refusal
 * throws, and the whole link rolls back.
 */
async function useTicket(tx: Queryable, ticket: Ticketed, a: { sentAt: Date; recipients: string[]; gmailMessageId: string; ownerId: string; acting: typeof PERSON }) {
  try {
    await requireApprovedTicket(tx, ticket.kind === 'SEND'
      ? { kind: 'SEND', subjectType: ticket.contentSendId ? 'send' : 'outreach_send', subjectId: ticket.contentSendId ?? ticket.sendId, ticketId: ticket.ticketId }
      : { kind: 'INTRO_ASK', subjectType: 'ask', subjectId: ticket.askId, ticketId: ticket.ticketId });
  } catch (e) {
    if (e instanceof TicketRequired) throw new OutreachRefused(409, `${e.message} Nothing was linked.`);
    throw e;
  }
  const decided = (await tx.one<{ at: Date | string | null }>('select decided_at at from governance.approval_ticket where id = $1', [ticket.ticketId]))?.at;
  if (decided && a.sentAt.getTime() < new Date(decided).getTime() - SKEW_MS) throw new OutreachRefused(409, 'The message was sent before the approval: a ticket covers a send after it. Nothing was linked.');
  if (ticket.kind === 'SEND') {
    if (ticket.sentAt) throw new OutreachRefused(409, 'That ticket was used already. An approval covers one send; ask again for another.');
    const outside = a.recipients.filter((r) => !ticket.recipients.includes(r));
    if (outside.length) throw new OutreachRefused(409, `${outside.length} recipient${outside.length === 1 ? ' is' : 's are'} outside the approval. Nothing was linked.`);
    if (ticket.contentSendId) {
      try { await markSendSent(a.ownerId, ticket.contentSendId, tx, a.sentAt); } catch (e) { throw new OutreachRefused(409, e instanceof Error ? e.message : 'The wrap check refused.'); }
    }
    await tx.query(`update email.outreach_send set sent_at = $2, gmail_message_id = $3, recorded_by = $4, recorded_at = now() where send_id = $1`,
      [ticket.sendId, a.sentAt, a.gmailMessageId, a.ownerId]);
  } else {
    if (ticket.status === 'made') throw new OutreachRefused(409, 'That intro ask was made already. Nothing was linked.');
    try { await recordAskEmailed(a.ownerId, ticket.askId, ticket.ticketId, a.acting, tx); } catch (e) { throw new OutreachRefused(409, `${e instanceof Error ? e.message : 'The ask was refused.'} Nothing was linked.`); }
  }
}

/**
 * One message about several LPs (pursuitIds, docs/27 §5): a person's link only, when the message was sent. An agent
 * ticket approves one email about one LP — a SEND to that LP's recipients (email 004 keeps one ticket per Gmail message,
 * outreach_send_gmail_idx), an INTRO_ASK for that LP — and rule 3 approves a specific bounded action, never a bundle. An
 * email spending several approvals at once is an action nobody approved as one, so an autonomous send about several LPs
 * is refused before anything is written; it may link each LP's own email, each under its own ticket. A person needs no
 * ticket, and a multi-LP link uses none: an agent ticket open for one of those LPs stays open, for its own email.
 */
export const MULTI_AUTONOMOUS_REFUSAL = 'An autonomous send about several LPs is refused: an approval covers one email about one LP, so one message cannot spend several. Link each LP\'s own email under its own ticket, or have a person link this one (no _meta.autonomous / X-Autonomous). Nothing was linked.';

export async function link(ctx: Ctx, raw: Record<string, unknown>) {
  requireMutationProfile();
  const a = linkInput.parse(raw);
  if (Boolean(a.pursuitId) === Boolean(a.pursuitIds)) throw new OutreachRefused(400, 'Name the LP with pursuitId, or several with pursuitIds (1–10): one or the other.');
  if (a.ticketId && a.pursuitIds) throw new OutreachRefused(400, 'A message about several LPs uses no ticket: it is linked for a person only.');
  const multi = Boolean(a.pursuitIds);
  if (multi && ctx.env.autonomous && a.direction === 'sent') throw new OutreachRefused(409, MULTI_AUTONOMOUS_REFUSAL);
  const db = await getDb();
  const owner = ctx.env.owner;
  // Each LP is authorized on its own (its vehicle, as the LP page's rule): one the caller may not change refuses them all.
  const ps: Desk[] = [];
  for (const id of a.pursuitIds ?? [a.pursuitId!]) ps.push(await pursuitFor(ctx, id, db, true));
  if (new Set(ps.map((p) => p.pursuit_id)).size !== ps.length) throw new OutreachRefused(400, 'pursuitIds names one LP twice.');
  const sentAt = new Date(a.date);
  if (sentAt.getTime() > Date.now() + SKEW_MS) throw new OutreachRefused(400, 'date is in the future.');
  const { key } = keyOf(a.messageId, a.gmailMessageId);
  const ours = a.direction === 'sent';
  if (!ours && a.ticketId) throw new OutreachRefused(400, 'A received message uses no ticket.');
  const recipients = [...new Set([...a.to, ...a.cc])].sort();
  const acting = ctx.env.autonomous ? AUTONOMOUS : PERSON;
  return db.transaction(async (tx) => {
    // Once: the same message again is the same link — to the same LP, or the same set of them (or part of it).
    const prior = await tx.query<{ link_id: string; pursuit: string; ticket_id: string | null }>(
      `select l.link_id::text, strategy.canonical_pursuit_id(l.pursuit_id)::text pursuit, l.ticket_id::text from email.message_link l
        where l.message_id = $1 order by l.linked_at, l.link_id`, [key]);
    if (prior.length) {
      const rows = ps.map((p) => prior.find((r) => r.pursuit === p.pursuit_id));
      if (rows.some((r) => !r)) {
        throw new OutreachRefused(409, multi ? 'That message is linked to other LPs already: a message is linked once, to one set of LPs. Nothing was linked.' : 'That message is linked to another LP already.');
      }
      if (a.ticketId && rows[0]!.ticket_id && rows[0]!.ticket_id !== a.ticketId) throw new OutreachRefused(409, 'That message is linked under another ticket already.');
      return multi
        ? { data: { linked: false, already: true, messageId: key, links: rows.map((r) => ({ pursuitId: r!.pursuit, linkId: r!.link_id, ticketId: r!.ticket_id })) } }
        : { data: { linked: false, already: true, linkId: rows[0]!.link_id, messageId: key, ticketId: rows[0]!.ticket_id } };
    }
    const links = new Map<string, { linkId: string; ticket: Ticketed | null }>();
    for (const p of ps) {
      let ticket: Ticketed | null = null;
      // A message about several LPs uses no ticket (a person's link only, above); one LP's message, as before.
      if (ours && !multi) {
        ticket = await ticketFor(tx, a.ticketId ?? null, p.pursuit_id, p.entity_id, p.vehicle_id, recipients);
        // A person needs no ticket; an autonomous send fails closed without an approved one (rule 3, 5 Oct 2026).
        if (!ticket && acting.autonomous) {
          throw new OutreachRefused(409, 'An autonomous send needs an approved, unexpired SEND ticket covering these recipients (outreach_request_ticket, then a person approves it). Nothing was linked.');
        }
        if (ticket) await useTicket(tx, ticket, { sentAt, recipients, gmailMessageId: a.gmailMessageId, ownerId: owner.id, acting });
      }
      const linkId = (await tx.one<{ id: string }>(`insert into email.message_link (message_id, gmail_id, thread_id, sent_at, direction, from_addr, to_addrs, cc_addrs, subject, body,
          pursuit_id, ticket_id, outreach_send_id, autonomous, linked_by, token_id)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) returning link_id::text id`,
      [key, a.gmailMessageId, a.threadId ?? null, sentAt, ours ? 'ours' : 'theirs', a.from, a.to, a.cc, a.subject ?? null, a.body ?? null,
        p.pursuit_id, ticket?.ticketId ?? null, ticket?.kind === 'SEND' ? ticket.sendId : null, acting.autonomous, owner.id, ctx.env.tokenId]))!.id;
      links.set(p.pursuit_id, { linkId, ticket });
    }
    const inTrace = Boolean(await tx.one('select 1 from email.comms_message where message_id = $1', [key]));
    for (const p of ps) {
      const l = links.get(p.pursuit_id)!;
      await appendAudit({ actorId: owner.id, action: 'outreach.message_linked', subjectType: 'message_link', subjectId: l.linkId,
        detail: { messageId: key, gmailMessageId: a.gmailMessageId, threadId: a.threadId ?? null, sentAt: sentAt.toISOString(), direction: ours ? 'ours' : 'theirs',
          recipients: recipients.length, subjectChars: a.subject?.length ?? 0, body: a.body !== undefined, pursuitId: p.pursuit_id, ticketId: l.ticket?.ticketId ?? null,
          ticketKind: l.ticket?.kind ?? null, autonomous: acting.autonomous, tokenId: ctx.env.tokenId, inTrace, ...(multi ? { lps: ps.length } : {}) } }, tx);
    }
    const next = inTrace ? 'Linked to the message in the trace. Nothing else was written: no touchpoint, status or rung.'
      : 'Linked. The trace has not shown this message yet (comms_ingest, or Affinity\'s next read): until it does, the LP page flags the link. Nothing else was written.';
    if (multi) {
      return { data: {
        linked: true, messageId: key, pursuitIds: ps.map((p) => p.pursuit_id),
        links: ps.map((p) => {
          const l = links.get(p.pursuit_id)!;
          return { pursuitId: p.pursuit_id, linkId: l.linkId, ticketId: l.ticket?.ticketId ?? null, ticketUsed: Boolean(l.ticket) };
        }),
        inTrace, next: `${next} One link per LP, made together.`,
      } };
    }
    const only = links.get(ps[0]!.pursuit_id)!;
    return { data: { linked: true, linkId: only.linkId, messageId: key, pursuitId: ps[0]!.pursuit_id, ticketId: only.ticket?.ticketId ?? null, ticketUsed: Boolean(only.ticket), inTrace, next } };
  });
}

/** outreach_record_send, deprecated: the old arguments, run as outreach_link_message. */
export async function recordSendAlias(ctx: Ctx, raw: Record<string, unknown>) {
  const a = raw as z.infer<typeof sentInput>;
  const from = ctx.env.owner.email?.trim().toLowerCase() || `${ctx.env.owner.handle}@team.invalid`;
  const r = await link(ctx, { pursuitId: a.pursuitId, gmailMessageId: a.gmailMessageId, date: a.sentAt, direction: 'sent', from, to: a.recipients, ticketId: a.ticketId });
  const d = r.data as { linked: boolean; already?: boolean; linkId: string };
  return { data: { ...d, recorded: d.linked, deprecated: 'outreach_record_send is now outreach_link_message (5 Oct 2026); this name goes in the next release.' } };
}

// ── comms_trace ──────────────────────────────────────────────────────────────────────────

export const traceInput = z.object({
  pursuitId: uuid,
  limit: z.number().int().min(1).max(200).optional().describe('At most this many items (default 50).'),
  offset: z.number().int().min(0).max(100000).optional(),
}).strict();

interface Item {
  at: string; source: TraceSource; sourceLabel: string; kind: string; direction: string | null;
  subject: string | null; team: string[]; about: string[] | 'unclear' | 'general'; counts: boolean;
  sameAs: SameAs[]; ref: string;
}

export async function commsTrace(ctx: Ctx, raw: Record<string, unknown>) {
  const a = raw as z.infer<typeof traceInput>;
  const db = await getDb();
  const p = await pursuitFor(ctx, a.pursuitId, db, false);
  const user = ctx.env.principal;
  const words = can(user, 'read', { vehicle: p.vehicle_id, fieldClass: 'R2' });
  const [trace, windows, updates, affinityNotes, notes, linear] = await Promise.all([
    traceFor(p.entity_id), raiseWindows(), updatesFor(p.pursuit_id), notesAbout(p.entity_id), notesFor(p.entity_id),
    linearFor(p.pursuit_id, db),
  ]);
  const w = windows.get(p.vehicle_id);
  const all = [...windows.values()];
  const countsHere = (t: Touchpoint) => (w ? aboutThisRaise(t, w) : !t.vehicleId || t.vehicleId === p.vehicle_id);
  let redacted = 0;
  const clean = (t: string | null | undefined) => {
    if (!t || !words) return null;
    const r = redactHealth(t);
    redacted += r.redacted;
    return r.text;
  };
  const items: Item[] = [];
  for (const t of trace.touches) {
    const on = t.on ?? t.scheduledFor;
    if (!on) continue;
    const ab = eventAbout(t, all);
    const msg = trace.messageOf.get(t.touchpointId);
    items.push({
      at: on.toISOString(), source: sourceOf(t), sourceLabel: SOURCE_LABEL[sourceOf(t)], kind: CHANNEL_LABEL[t.channel].toLowerCase(),
      direction: t.direction ? DIRECTION_LABEL[t.direction] : null, subject: clean(msg?.subject ?? (t.source === 'gmail' ? t.summary : null)),
      team: msg?.team ?? t.attendees,
      about: ab.kind === 'vehicles' ? ab.vehicles.map((v) => v.slug) : ab.kind === 'unclear' ? 'unclear' : 'general',
      counts: countsHere(t),
      sameAs: trace.sameAs.get(t.touchpointId) ?? [], ref: t.touchpointId,
    });
  }
  for (const u of updates) {
    items.push({ at: u.createdAt.toISOString(), source: 'plcos', sourceLabel: 'PLC OS update', kind: 'note', direction: null, subject: oneLine(clean(u.body)),
      team: [u.createdByName], about: [p.slug], counts: true, sameAs: [], ref: `update:${u.updateId}` });
  }
  for (const n of notes.filter((x) => x.kind === 'context')) {
    items.push({ at: new Date(n.createdAt).toISOString(), source: 'plcos', sourceLabel: 'PLC OS note', kind: 'note', direction: null,
      subject: oneLine(clean(n.body)), team: n.author ? [n.author] : [], about: 'general', counts: false, sameAs: [], ref: `note:${n.noteId}` });
  }
  for (const n of affinityNotes) {
    // A note that mentions health lends only a summary read with it redacted (N56), never its text.
    const text = n.reading?.summary ?? (n.health ? null : n.text.split(/(?<=[.!?])\s/)[0]?.slice(0, 300) ?? null);
    items.push({ at: n.createdAt.toISOString(), source: 'affinity', sourceLabel: 'Affinity note', kind: 'note', direction: null, subject: clean(text),
      team: n.authorOnTeam ? [n.author] : [], about: n.tag?.vehicles?.length ? n.tag.vehicles : n.tag?.about === 'raise' ? 'unclear' : 'general',
      counts: false, sameAs: [], ref: `affinity-note:${n.noteId}` });
  }
  for (const i of linear) {
    const at = i.completedAt ?? i.createdAt;
    if (!at) continue;
    items.push({ at: at.toISOString(), source: 'linear', sourceLabel: 'Linear', kind: i.completedAt ? 'issue done' : 'issue', direction: null,
      subject: clean(`${i.identifier ?? ''} ${i.title ?? ''}`.trim()), team: [], about: [p.slug], counts: false, sameAs: [], ref: `linear:${i.id}` });
  }
  items.sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : x.ref < y.ref ? -1 : 1));
  const counted = { ...trace, touches: trace.touches.filter(countsHere) };
  const state = traceState(counted);
  const anyState = traceState(trace);
  const offset = a.offset ?? 0, limit = a.limit ?? 50;
  const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
  return { data: {
    pursuitId: p.pursuit_id, lp: p.name, vehicle: p.slug,
    state: {
      lastTouch: state.summary.lastTouch ? { on: day(state.summary.lastTouch), channel: state.summary.lastTouchChannel } : null,
      owes: state.owes ? { by: state.owes.by, since: day(state.owes.since), says: state.owes.by === 'us' ? 'They spoke last: we owe a reply.' : 'We wrote last: waiting on them.' } : null,
      thread: anyState.thread ? { subject: clean(anyState.thread.subject), team: anyState.thread.team, holder: anyState.thread.holder, messages: anyState.thread.messages, last: day(anyState.thread.last) } : null,
    },
    items: items.slice(offset, offset + limit), total: items.length, offset,
    mismatches: trace.flags.map((f) => ({ kind: f.kind, at: day(f.at), text: f.text })),
    redacted: redacted ? `${redacted} sentence${redacted === 1 ? '' : 's'} with a health detail redacted.` : null,
    ...(words ? {} : { withheld: 'Subjects and words are withheld at your access.' }),
  }, coverage: {
    corpus: `Affinity's emails, meetings, calls and notes as of the last translation; ${trace.messages.length} Gmail message${trace.messages.length === 1 ? '' : 's'} juanmail reported${trace.messages.length ? ` (${day(trace.messages[0]!.sentAt)} to ${day(trace.messages.at(-1)!.sentAt)})` : ''}; PLC OS updates and notes; linked Linear issues.`,
    note: 'One row per event: a Gmail message Affinity also has is matched by Message-ID when both carry it, else by date, participants and subject, with the confidence said. A mailbox juanmail does not read is not here; absence here is not absence in the world.',
  } };
}
