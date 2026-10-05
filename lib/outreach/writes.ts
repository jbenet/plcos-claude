import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { config } from '@/config/deployment';
import { AuthorizationError, can } from '@/lib/authz';
import { authorizeAction } from '@/lib/authz/server';
import { getDb, type Queryable } from '@/lib/db';
import { requireMutationProfile } from '@/lib/mutation-policy';
import { addUpdate } from '@/lib/updates';
import { markSendSent, proposeDeskSend } from '@/modules/content';
import { proposeAsk, recordOverlap } from '@/modules/coordination';
import { openTicket, requireApprovedTicket, TicketRequired } from '@/modules/governance';
import { logTouchpoint, TouchpointRefused } from '@/modules/meetings';
import { IndicationRefused } from '@/modules/pipeline';
import { appendAudit } from '@/modules/platform';
import { StatusRefused } from '@/modules/strategy';
import type { Envelope } from '@/lib/mcp/envelope';

/** Who is calling: the token's envelope. */
export interface DeskContext { env: Envelope }
import { FUND_FIRST_CHOICES, OutreachRefused, outreachQueue, type Check } from './reads';

/**
 * The mail desk's writes (docs/27-outreach-api.md §3–5). Each reuses the service the app's own page uses,
 * after the same checks: the real-data rule (changes only on the live server), then the UI action's own
 * authorization rule for the pursuit, as the token's principal. None sends, approves, accepts or moves
 * money. Tickets are opened for a person to approve, requested by the inactive "Mail desk" actor so the
 * person who approves is never the requester; the desk records a send only against an approved ticket.
 */

const uuid = z.string().uuid();
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoTime = z.string().datetime({ offset: true });
const key = z.string().min(8).max(100).regex(/^[\w.:-]+$/);
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const email = z.string().max(254).transform((s) => s.trim().toLowerCase()).refine((s) => EMAIL.test(s), 'not an email address');

/** The pursuit, canonical, if this principal may change it: the LP page's own rule (lib/authz/rules.ts). */
async function deskPursuit(ctx: DeskContext, pursuitId: string, q: Queryable) {
  requireMutationProfile();
  try {
    await authorizeAction(ctx.env.principal, 'app/targets/actions.ts#addUpdateAction', [{ pursuitId }], q);
  } catch (e) {
    if (e instanceof AuthorizationError) throw new OutreachRefused(404, 'No such LP on your vehicles, or you may not change it.');
    throw e;
  }
  const p = await q.one<{ pursuit_id: string; entity_id: string; vehicle_id: string; slug: string; vehicle: string; kind: string; exemption: string; name: string }>(
    `select p.pursuit_id::text, identity.canonical_entity_id(p.entity_id)::text entity_id, p.vehicle_id::text, v.slug, v.name vehicle,
            v.kind::text kind, v.exemption, e.display_name name
       from strategy.pursuit p join platform.vehicle v on v.id = p.vehicle_id
       join identity.entity e on e.entity_id = identity.canonical_entity_id(p.entity_id)
      where p.pursuit_id = strategy.canonical_pursuit_id($1::uuid)`, [pursuitId]);
  if (!p) throw new OutreachRefused(404, 'No such LP on your vehicles, or you may not change it.');
  return p;
}

/** A request key, used once: a retry gets the first answer back. Reserved before the work, filled after. */
async function once<T>(ctx: DeskContext, op: string, requestKey: string | undefined, work: () => Promise<T>): Promise<T | { data: unknown; replayed: true }> {
  if (!requestKey) return work();
  const db = await getDb();
  const k = `desk:${ctx.env.owner.id}:${op}:${requestKey}`;
  const reserved = await db.one(`insert into email.outreach_request (request_key, op, token_id) values ($1, $2, $3) on conflict do nothing returning request_key`, [k, op, ctx.env.tokenId]);
  if (!reserved) {
    const prior = await db.one<{ result: unknown }>('select result from email.outreach_request where request_key = $1', [k]);
    if (prior?.result == null) throw new OutreachRefused(409, 'That request is still being handled. Try again in a moment.');
    return { ...(prior.result as { data: unknown }), replayed: true };
  }
  try {
    const result = await work();
    await db.query('update email.outreach_request set result = $2 where request_key = $1', [k, JSON.stringify(result)]);
    return result;
  } catch (e) {
    await db.query('delete from email.outreach_request where request_key = $1', [k]);
    throw e;
  }
}

const deskActor = async (q: Queryable) => (await q.one<{ id: string }>(`select id::text from platform.app_user where handle = 'mail-desk'`))?.id
  ?? (() => { throw new Error('The Mail desk actor is missing (platform 015).'); })();

// ── POST /api/outreach/update ───────────────────────────────────────────────────────────

const statuses = ['new', 'sourcing', 'selected', 'connecting', 'discussing', 'committed', 'passed'] as const;
export const updateInput = z.object({
  pursuitId: uuid,
  words: z.string().min(1).max(20000),
  applied: z.object({
    status: z.object({ to: z.enum(statuses), passedBy: z.enum(['them', 'us']).optional(), reason: z.string().max(60).optional() }).strict().optional(),
    touch: z.object({ channel: z.enum(['meeting', 'call', 'email', 'message']), direction: z.enum(['ours', 'theirs', 'both']).optional(), on: isoDay, read: z.enum(['very_interested', 'interested', 'not_very_interested']).optional() }).strict().optional(),
    nextStep: z.object({ step: z.string().min(1).max(300), on: isoDay.optional() }).strict().optional(),
    indicated: z.object({ low: z.number().min(0), high: z.number().min(0).optional(), on: isoDay.optional(), touchpointId: uuid.optional() }).strict().optional(),
  }).strict().default({}),
  idempotencyKey: key,
}).strict();

export async function update(ctx: DeskContext, raw: Record<string, unknown>) {
  const a = raw as z.infer<typeof updateInput>;
  const db = await getDb();
  const p = await deskPursuit(ctx, a.pursuitId, db);
  const t = a.applied;
  const at = (d: string, hour: string) => new Date(`${d}T${hour}:00:00Z`);
  try {
    // The LP page's update box, exactly (lib/updates.ts): one transaction, once per key, each ticked box.
    const r = await addUpdate(ctx.env.owner.id, {
      pursuitId: p.pursuit_id, body: a.words, idempotencyKey: `desk:${ctx.env.owner.id}:${a.idempotencyKey}`,
      status: t.status ? { to: t.status.to, passedBy: t.status.passedBy ?? null, reason: t.status.reason ?? null } : null,
      touch: t.touch ? { channel: t.touch.channel, direction: t.touch.direction ?? (t.touch.channel === 'meeting' || t.touch.channel === 'call' ? 'both' : 'ours'), on: at(t.touch.on, '12'), read: t.touch.read ?? null } : null,
      nextStep: t.nextStep ? { step: t.nextStep.step, on: t.nextStep.on ? at(t.nextStep.on, '00') : null } : null,
      indicated: t.indicated ? { low: t.indicated.low, high: t.indicated.high ?? null, on: t.indicated.on ? at(t.indicated.on, '12') : null, touchpointId: t.indicated.touchpointId ?? null } : null,
    });
    return { data: { pursuitId: p.pursuit_id, updateId: r.updateId, created: r.created, applied: r.applied, ladderProposed: r.proposed,
      next: r.proposed ? 'A ladder rung the logged touchpoint supports is waiting on Approvals; nothing was recorded on the ladder.' : null } };
  } catch (e) {
    if (e instanceof StatusRefused || e instanceof TouchpointRefused || e instanceof IndicationRefused) throw new OutreachRefused(422, e.message);
    throw e;
  }
}

// ── POST /api/outreach/tickets ──────────────────────────────────────────────────────────

export const ticketInput = z.object({
  kind: z.enum(['SEND', 'INTRO_ASK']),
  pursuitId: uuid,
  assetId: uuid.optional(),
  connectorId: uuid.optional(),
  scope: z.object({
    recipients: z.array(email).min(1).max(10).optional(),
    purpose: z.enum(['invite', 'reply', 'follow_up']).default('invite'),
    note: z.string().max(500).optional(),
  }).strict(),
  coordination: z.object({ choice: z.enum(FUND_FIRST_CHOICES), followUpOn: isoDay.optional(), note: z.string().max(500).optional() }).strict().optional(),
  idempotencyKey: key.optional(),
}).strict();

const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

export async function requestTicket(ctx: DeskContext, raw: Record<string, unknown>) {
  const a = raw as z.infer<typeof ticketInput>;
  return once(ctx, 'tickets', a.idempotencyKey, async () => {
    const db = await getDb();
    const p = await deskPursuit(ctx, a.pursuitId, db);
    if (a.kind === 'SEND' && !a.scope.recipients?.length) throw new OutreachRefused(400, 'A SEND ticket names its recipients (scope.recipients): the approval covers them and nobody else.');
    if (a.kind === 'INTRO_ASK' && !a.connectorId) throw new OutreachRefused(400, 'An INTRO_ASK names the connector who would introduce (connectorId).');
    // The queue's own checks for this LP, now: a blocking one refuses before any ticket exists.
    const row = (await outreachQueue(ctx.env.principal, { vehicle: p.slug, pursuitId: p.pursuit_id })).data.rows[0] as { checks: Check[] } | undefined;
    if (!row) throw new OutreachRefused(409, 'This LP is not in the queue (passed, or not readable): no ticket was opened.');
    const blocking = row.checks.filter((c) => !c.ok && c.blocking);
    if (blocking.length) throw new OutreachRefused(409, `Refused, no ticket opened: ${blocking.map((c) => `${c.rule}: ${c.detail}`).join(' ')}`);
    const advisories = row.checks.filter((c) => !c.ok && !c.blocking);
    const fundFirst = advisories.find((c) => c.rule === 'fund_first');
    if (fundFirst && !a.coordination) {
      throw new OutreachRefused(409, `${fundFirst.detail} Say how (coordination.choice: ${FUND_FIRST_CHOICES.join(', ')}); it is recorded with a dated follow-up.`);
    }
    const actor = await deskActor(db);
    const owner = ctx.env.owner;
    const basis = [
      { label: 'Requested through', value: `the mail desk, by ${owner.name}'s token (${ctx.env.tokenId.slice(0, 8)})` },
      ...advisories.map((c) => ({ label: `${c.rule.replace('_', ' ')} (advisory)`, value: c.detail })),
    ];

    // Fund before SPV, advisory: the overlap is recorded with its choice and a dated follow-up (rule 5).
    const fund = fundFirst ? await db.one<{ vehicle_id: string; pursuit_id: string }>(`select p.vehicle_id::text, p.pursuit_id::text from strategy.active_pursuit p
      join platform.vehicle v on v.id = p.vehicle_id where v.kind = 'fund' and v.phase <> 'historical' and p.closed_at is null
        and p.status::text = any($2::text[]) and identity.canonical_entity_id(p.entity_id) = $1::uuid order by v.sort_order limit 1`,
    [p.entity_id, ['connecting', 'discussing', 'committed']]) : null;
    const followUpOn = a.coordination?.followUpOn ?? plusDays(config.guard.conflictWindowDays);
    if (fund && a.coordination?.choice === 'wait') {
      const overlapId = await recordOverlap(owner.id, { entityId: p.entity_id, vehicleId: p.vehicle_id, pursuitId: p.pursuit_id, otherVehicleId: fund.vehicle_id,
        otherPursuitId: fund.pursuit_id, choice: 'wait', followUpOn, ticketId: null, note: a.coordination.note ?? null });
      return { data: { opened: false, overlapId, followUpOn, next: `Held: the SPV waits for the fund discussion. Recorded, with a follow-up on ${followUpOn}; no ticket was opened.` } };
    }

    const result: { ticketId: string; sendId: string | null; askId: string | null; conflictCaseId: string | null } = { ticketId: '', sendId: null, askId: null, conflictCaseId: null };
    if (a.kind === 'SEND') await db.transaction(async (tx) => {
      {
        const recipients = [...new Set(a.scope.recipients!)];
        let contentSendId: string | null = null, material: string | null = null;
        if (a.assetId) {
          const m = await proposeDeskSend(actor, { assetId: a.assetId, entityId: p.entity_id, vehicleId: p.vehicle_id, instrument: p.kind === 'spv' ? 'spv' : 'lp_commitment' }, tx);
          if (!m.sendId) throw new OutreachRefused(409, `Refused by the wrap check, no ticket opened: ${m.check.refusals.join(' ')}`);
          contentSendId = m.sendId; material = `${m.title} (v${m.version})`;
        }
        const sendId = randomUUID();
        const ticketId = await openTicket(actor, {
          kind: 'SEND', subjectType: contentSendId ? 'send' : 'outreach_send', subjectId: contentSendId ?? sendId,
          subjectLabel: `${a.scope.purpose === 'reply' ? 'Reply' : a.scope.purpose === 'follow_up' ? 'Follow-up' : 'Invitation'} to ${p.name} — ${p.vehicle}${material ? `, with ${material}` : ''}`,
          scope: {
            authorizes: `One email from ${owner.name}'s own mailbox, sent once by the mail desk through MailGuard, to ${recipients.join(', ')}, `
              + `about ${p.vehicle} (${a.scope.purpose.replace('_', ' ')})${material ? `, with ${material} attached` : ''}, and to nobody else.`,
            excludes: ['Any other recipient, or a copy to anyone else', 'A second send on this approval', 'Any material not named here', 'Any statement about another vehicle', 'Forwarding rights'],
            basis: [...basis, ...(material ? [{ label: 'Wrap check', value: `Passed — ${p.exemption} × ${p.kind === 'spv' ? 'spv' : 'lp_commitment'}` }] : []),
              ...(a.scope.note ? [{ label: 'Note from the desk', value: a.scope.note }] : [])],
          },
          vehicleId: p.vehicle_id,
          expiresInDays: 3, // GUESS — as a material send: an approval is for this week's email, not next month's.
        }, tx);
        if (contentSendId) await tx.query('update content.send set ticket_id = $2 where send_id = $1', [contentSendId, ticketId]);
        await tx.query(`insert into email.outreach_send (send_id, pursuit_id, entity_id, vehicle_id, purpose, recipients, asset_id, content_send_id, ticket_id, requested_for, token_id)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [sendId, p.pursuit_id, p.entity_id, p.vehicle_id, a.scope.purpose, recipients, a.assetId ?? null, contentSendId, ticketId, owner.id, ctx.env.tokenId]);
        result.ticketId = ticketId; result.sendId = sendId;
      }
    });

    if (a.kind === 'INTRO_ASK') {
      // The routes page's own service: the ask, its guards, the INTRO_ASK ticket and any conflict case.
      const connector = await db.one<{ id: string; name: string }>('select entity_id::text id, display_name name from identity.entity where entity_id = identity.canonical_entity_id($1::uuid)', [a.connectorId]);
      if (!connector) throw new OutreachRefused(404, 'No such connector.');
      const r = await proposeAsk(actor, {
        entityId: p.entity_id, entityName: p.name, connectorId: connector.id, connectorName: connector.name, vehicleId: p.vehicle_id, vehicleName: p.vehicle,
        purpose: a.scope.note?.slice(0, 200) || `Introduction to ${p.name} for ${p.vehicle}`, ownerId: owner.id,
        carries: `${connector.name} introducing ${p.name} to ${owner.name} about ${p.vehicle}, asked once by email from ${owner.name}'s own mailbox through the mail desk.`,
      });
      result.ticketId = r.ticketId; result.askId = r.askId; result.conflictCaseId = r.conflictCaseId;
    }
    let overlapId: string | null = null;
    if (fund && a.coordination) {
      overlapId = await recordOverlap(owner.id, { entityId: p.entity_id, vehicleId: p.vehicle_id, pursuitId: p.pursuit_id, otherVehicleId: fund.vehicle_id,
        otherPursuitId: fund.pursuit_id, choice: a.coordination.choice, followUpOn, ticketId: result.ticketId, note: a.coordination.note ?? null });
    }
    await appendAudit({ actorId: owner.id, action: 'outreach.ticket_requested', subjectType: 'approval_ticket', subjectId: result.ticketId,
      detail: { kind: a.kind, pursuitId: p.pursuit_id, tokenId: ctx.env.tokenId, recipients: a.scope.recipients?.length ?? 0, assetId: a.assetId ?? null, overlapId } });
    return { data: {
      opened: true, kind: a.kind, ticketId: result.ticketId, sendId: result.sendId, askId: result.askId, conflictCaseId: result.conflictCaseId, overlapId,
      followUpOn: overlapId ? followUpOn : null, advisories: advisories.map((c) => ({ rule: c.rule, detail: c.detail })),
      next: 'Waiting on a person\'s approval in Capital OS (Approvals). Nothing was sent or approved by this call.',
    } };
  });
}

// ── POST /api/outreach/contacts ─────────────────────────────────────────────────────────

export const contactInput = z.object({
  entityId: uuid, email, source: z.literal('gmail'), confirmedBy: z.string().min(1).max(254), confirmedAt: isoTime.optional(), idempotencyKey: key.optional(),
}).strict();

/** The vehicles an entity is on: its own pursuits, or an organisation's whose contact it is. */
async function entityVehicles(entityId: string, q: Queryable): Promise<string[]> {
  return (await q.query<{ v: string }>(`
    select p.vehicle_id::text v from strategy.active_pursuit p where identity.canonical_entity_id(p.entity_id) = identity.canonical_entity_id($1::uuid)
    union select p.vehicle_id::text from strategy.pursuit_contact c join strategy.active_pursuit p using (pursuit_id)
      where identity.canonical_entity_id(c.person_entity) = identity.canonical_entity_id($1::uuid)
    union select p.vehicle_id::text from identity.affiliation a join strategy.active_pursuit p
      on identity.canonical_entity_id(p.entity_id) = identity.canonical_entity_id(a.org_entity)
      where identity.canonical_entity_id(a.person_entity) = identity.canonical_entity_id($1::uuid) and a.ended_on is null`, [entityId])).map((r) => r.v);
}

export async function contacts(ctx: DeskContext, raw: Record<string, unknown>) {
  const a = raw as z.infer<typeof contactInput>;
  return once(ctx, 'contacts', a.idempotencyKey, async () => {
    requireMutationProfile();
    const owner = ctx.env.owner;
    // Juan picks the address in the wave review; the confirmation is the token owner's own, never someone else's.
    if (![owner.handle, owner.email.toLowerCase()].includes(a.confirmedBy.trim().toLowerCase())) {
      throw new OutreachRefused(403, 'confirmedBy is the token\'s owner: a desk confirms addresses only for the person it acts as.');
    }
    const db = await getDb();
    const vehicles = await entityVehicles(a.entityId, db);
    if (!vehicles.some((v) => can(ctx.env.principal, 'mutate', { vehicle: v }))) throw new OutreachRefused(404, 'No such person or organisation on your vehicles.');
    const at = a.confirmedAt ? new Date(a.confirmedAt) : new Date();
    if (at.getTime() > Date.now() + 5 * 60_000) throw new OutreachRefused(400, 'confirmedAt is in the future.');
    return db.transaction(async (tx) => {
      const entity = (await tx.one<{ id: string }>('select identity.canonical_entity_id($1::uuid)::text id', [a.entityId]))!.id;
      const doc = `gmail:${owner.handle}`;
      await tx.query(`insert into research.source_doc (doc_id, title, kind, origin, as_of, strength, supports, body)
        values ($1, $2, 'mailbox', 'gmail', current_date, 'moderate', $3, '') on conflict (doc_id) do nothing`,
      [doc, `${owner.name}'s Gmail, through the mail desk`, 'An email address seen in correspondence in this mailbox and confirmed by its owner. Not proof the address is current.']);
      const existing = await tx.query<{ claim_id: string; value: string; source: string; origin: string | null }>(`select c.claim_id::text, c.value, c.source, d.origin
        from research.claim c left join research.source_doc d on d.doc_id = c.source
        where identity.canonical_entity_id(c.entity_id) = $1::uuid and c.superseded_by is null and c.field ~ '(^|\\.)email$'`, [entity]);
      const claim = (await tx.one<{ id: string }>(`insert into research.claim (entity_id, field, value, source, as_of, confidence, last_verified_by, last_verified_at)
        values ($1, 'email', $2, $3, $4::date, 'high', $5, $6) returning claim_id::text id`,
      [entity, a.email, doc, at.toISOString().slice(0, 10), owner.id, at]))!.id;
      // The same address from this mailbox before: superseded by the new confirmation, so the history stays.
      const mine = existing.filter((e) => e.source === doc && e.value.trim().toLowerCase() === a.email);
      for (const e of mine) await tx.query('update research.claim set superseded_by = $2 where claim_id = $1', [e.claim_id, claim]);
      // Another source's address is never overwritten: kept, and the disagreement said back (and logged, without the addresses).
      const others = existing.filter((e) => e.source !== doc);
      const disagree = others.filter((e) => e.value.trim().toLowerCase() !== a.email);
      const agree = others.filter((e) => e.value.trim().toLowerCase() === a.email);
      const sourceOf = (e: { source: string; origin: string | null }) => (/affinity/i.test(e.source) || /affinity/i.test(e.origin ?? '') ? 'affinity' : /dakota/i.test(e.source) || /dakota/i.test(e.origin ?? '') ? 'licensed' : 'research');
      await appendAudit({ actorId: owner.id, action: 'contact.confirmed', subjectType: 'entity', subjectId: entity,
        detail: { source: 'gmail', claimId: claim, tokenId: ctx.env.tokenId, superseded: mine.length, agrees: agree.length, disagrees: disagree.length } }, tx);
      return { data: {
        claimId: claim, entityId: entity, email: a.email, source: 'gmail', confirmedBy: owner.handle, confirmedAt: at.toISOString(),
        kept: disagree.filter((e) => sourceOf(e) !== 'licensed').map((e) => ({ email: e.value, source: sourceOf(e) })),
        keptLicensed: disagree.filter((e) => sourceOf(e) === 'licensed').length,
        note: disagree.length ? 'Other addresses on file were kept, not overwritten: both are on record, each with its source and date.' : null,
      } };
    });
  });
}

// ── POST /api/outreach/sent ─────────────────────────────────────────────────────────────

export const sentInput = z.object({
  ticketId: uuid, pursuitId: uuid, recipients: z.array(email).min(1).max(10),
  gmailMessageId: z.string().min(1).max(200).regex(/^[\w.@<>+=/-]+$/), sentAt: isoTime,
}).strict();

const SKEW_MS = 5 * 60_000; // GUESS — clock skew between the desk's device and this server.

export async function recordDeskSend(ctx: DeskContext, raw: Record<string, unknown>) {
  const a = raw as z.infer<typeof sentInput>;
  const db = await getDb();
  const p = await deskPursuit(ctx, a.pursuitId, db);
  const sentAt = new Date(a.sentAt);
  if (sentAt.getTime() > Date.now() + SKEW_MS) throw new OutreachRefused(400, 'sentAt is in the future.');
  const owner = ctx.env.owner;
  return db.transaction(async (tx) => {
    const s = await tx.one<{ send_id: string; pursuit_id: string; recipients: string[]; content_send_id: string | null; sent_at: Date | string | null; gmail_message_id: string | null; touchpoint_id: string | null }>(
      `select send_id::text, strategy.canonical_pursuit_id(pursuit_id)::text pursuit_id, recipients, content_send_id::text, sent_at, gmail_message_id, touchpoint_id::text
         from email.outreach_send where ticket_id = $1 for update`, [a.ticketId]);
    if (!s) throw new OutreachRefused(404, 'No desk send was asked for under that ticket. Only a SEND ticket the desk opened can record its send.');
    if (s.pursuit_id !== p.pursuit_id) throw new OutreachRefused(409, 'That ticket is for another LP. An approval is for a specific bounded action.');
    const outside = a.recipients.filter((r) => !s.recipients.includes(r));
    if (outside.length) throw new OutreachRefused(409, `${outside.length} recipient${outside.length === 1 ? ' is' : 's are'} outside the approval. Nothing was recorded.`);
    // Once: the same message again is the same record; a different one is refused.
    if (s.sent_at) {
      if (s.gmail_message_id === a.gmailMessageId) return { data: { recorded: false, already: true, sendId: s.send_id, touchpointId: s.touchpoint_id, sentAt: new Date(s.sent_at).toISOString() } };
      throw new OutreachRefused(409, 'This ticket\'s send was recorded already. An approval covers one send; ask again for another.');
    }
    let decidedAt: Date | null = null;
    try {
      await requireApprovedTicket(tx, { kind: 'SEND', subjectType: s.content_send_id ? 'send' : 'outreach_send', subjectId: s.content_send_id ?? s.send_id, ticketId: a.ticketId });
      decidedAt = (await tx.one<{ at: Date | string }>('select decided_at at from governance.approval_ticket where id = $1', [a.ticketId]))?.at as Date | null;
    } catch (e) {
      if (e instanceof TicketRequired) throw new OutreachRefused(409, `${e.message} Nothing was recorded.`);
      throw e;
    }
    if (decidedAt && sentAt.getTime() < new Date(decidedAt).getTime() - SKEW_MS) throw new OutreachRefused(409, 'sentAt is before the approval: a send needs its approval first. Nothing was recorded.');
    const dup = await tx.one('select 1 from email.outreach_send where gmail_message_id = $1', [a.gmailMessageId]);
    if (dup) throw new OutreachRefused(409, 'That Gmail message is recorded against another ticket already.');
    if (s.content_send_id) {
      try { await markSendSent(owner.id, s.content_send_id, tx, sentAt); } catch (e) { throw new OutreachRefused(409, e instanceof Error ? e.message : 'The wrap check refused.'); }
    }
    // The email is a touchpoint: ours, by email, on this vehicle, so "waiting on their reply" starts here.
    const touchpointId = await logTouchpoint(owner.id, {
      entityId: p.entity_id, vehicleId: p.vehicle_id, pursuitId: p.pursuit_id, channel: 'email', on: sentAt, direction: 'ours',
      summary: 'Email sent from the mail desk, under an approved SEND ticket.', read: null,
    }, { q: tx });
    await tx.query(`update email.outreach_send set sent_at = $2, gmail_message_id = $3, recorded_by = $4, recorded_at = now(), touchpoint_id = $5 where send_id = $1`,
      [s.send_id, sentAt, a.gmailMessageId, owner.id, touchpointId]);
    await appendAudit({ actorId: owner.id, action: 'outreach.send_recorded', subjectType: 'approval_ticket', subjectId: a.ticketId,
      detail: { sendId: s.send_id, pursuitId: p.pursuit_id, tokenId: ctx.env.tokenId, recipients: a.recipients.length, touchpointId } }, tx);
    return { data: { recorded: true, sendId: s.send_id, touchpointId, sentAt: sentAt.toISOString() } };
  });
}

