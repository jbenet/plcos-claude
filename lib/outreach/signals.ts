import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { can } from '@/lib/authz';
import { getDb, type Queryable } from '@/lib/db';
import { requireMutationProfile } from '@/lib/mutation-policy';
import { redactHealth } from '@/lib/redact-health';
import { normalizeMessageId } from '@/lib/comms/trace';
import { appendAudit } from '@/modules/platform';
import type { AppUser } from '@/modules/platform';
import type { Envelope } from '@/lib/mcp/envelope';
import { OutreachRefused, deskVehicle } from './reads';
import { entityVehicles } from './writes';

/**
 * What the mail says about the people in it (Juan, 9 Oct 2026; docs/29-mail-actions.md). juanmail reads each
 * PLC OS thread and reports short signals per message — per person or firm, by the role they play in that thread
 * (an LP, a connector, someone else) — and Capital OS keeps them beside the LP, suggests the update box's boxes
 * from them, and sums them per vehicle so strategy can learn from what LPs ask and object to.
 *
 *   outreach_record_signals  propose: keeps the readings (email.mail_signal, email 022) and answers suggestions —
 *                            ready outreach_update payloads for the person to accept with one click. It moves no
 *                            status, rung, money or ticket itself: a suggestion is data for a person.
 *   outreach_signals         read: one LP's (or entity's) signals, newest first, R2 words only.
 *   outreach_insights        read: a vehicle's signals summed by kind and topic, with the latest examples, for strategy.
 *   outreach_playbook        read: the playbook juanmail runs (docs/workflows/mail-actions.md), as text.
 *
 * Deterministic on this side: no model call. The reading (which kind, which topic, the summary) is the desk's.
 */

interface Ctx { env: Envelope }

const uuid = z.string().uuid();
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoTime = z.string().datetime({ offset: true });
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const email = z.string().max(254).transform((s) => s.trim().toLowerCase()).refine((s) => EMAIL.test(s), 'not an email address');
const gmailId = z.string().min(1).max(200).regex(/^[\w.@<>+=/-]+$/);

export const SIGNAL_KINDS = ['interest', 'soft_commit', 'indication', 'question', 'objection', 'decline', 'timing',
  'materials_request', 'meeting_request', 'referral', 'intro_offer', 'other'] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];
export const SIGNAL_LABEL: Record<SignalKind, string> = {
  interest: 'Interest', soft_commit: 'Soft commitment', indication: 'Indicated amount', question: 'Question', objection: 'Objection',
  decline: 'Declined', timing: 'Timing', materials_request: 'Asked for materials', meeting_request: 'Asked to meet',
  referral: 'Referral', intro_offer: 'Offered an intro', other: 'Other',
};
export const ROLES = ['lp', 'connector', 'other'] as const;
export type Role = (typeof ROLES)[number];

const signal = z.object({
  pursuitId: uuid.optional().describe('The LP on one vehicle it is about (from the queue). For a connector, the LP they would introduce.'),
  entityId: uuid.optional().describe('The person or firm who said it, when not the pursuit\'s own entity (a partner at the LP\'s firm, a connector).'),
  email: email.optional().describe('Or their address: matched to a person on record by their email claims.'),
  role: z.enum(ROLES).describe('Their role in this thread: lp (investing), connector (introducing), other. Role, not identity: an LP can be a connector here.'),
  kind: z.enum(SIGNAL_KINDS),
  topic: z.string().trim().min(1).max(60).optional().describe('A short, reusable topic ("fees", "timeline", "BCI competition", "minimum check"): sums group by it.'),
  summary: z.string().trim().min(1).max(500).describe('Your reading in one or two sentences. Not the message body.'),
  quote: z.string().trim().min(1).max(300).optional().describe('At most a short quote that carries it.'),
  amount: z.object({ low: z.number().min(0), high: z.number().min(0).optional() }).strict().optional()
    .describe('USD, for soft_commit or indication: one number (low) or a range.'),
  followUpOn: isoDay.optional().describe('For timing: when they said to come back.'),
  confidence: z.enum(['high', 'medium', 'low']),
}).strict().refine((s) => !!(s.pursuitId || s.entityId || s.email), 'Name who: pursuitId, entityId or email.')
  .refine((s) => !s.amount || s.amount.high === undefined || s.amount.high >= s.amount.low, 'amount.high is below amount.low.');

export const signalsInput = z.object({
  message: z.object({
    messageId: z.string().min(3).max(400).optional().describe('The Message-ID header: the key. Without it, the Gmail id is.'),
    gmailMessageId: gmailId, threadId: gmailId.optional(), date: isoTime,
    direction: z.enum(['sent', 'received']),
  }).strict(),
  readBy: z.string().trim().min(1).max(80).regex(/^[\w.:/-]+$/).describe('Who read it: "rules", or the model\'s id. Kept for correction and cost.'),
  signals: z.array(signal).max(20).default([]),
  dismiss: z.array(uuid).max(50).optional().describe('signalIds a person said are wrong: kept, no longer shown or counted.'),
}).strict();

type Row = {
  signal_id: string; message_id: string; thread_id: string | null; sent_at: Date | string; direction: 'ours' | 'theirs';
  entity_id: string; entity_name: string; pursuit_id: string | null; vehicle_ids: string[]; role: Role; kind: SignalKind;
  topic: string | null; summary: string; quote: string | null; amount_low: string | null; amount_high: string | null;
  follow_up_on: Date | string | null; confidence: 'high' | 'medium' | 'low'; read_by: string;
};

const DAY = 86_400_000;
const day = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const plusDays = (from: Date, n: number) => new Date(from.getTime() + n * DAY).toISOString().slice(0, 10);
const usd = (n: number) => (n >= 1e6 ? `$${+(n / 1e6).toFixed(2)}M` : `$${Math.round(n / 1e3)}K`);

/** Words (R2) on any of the vehicles; with none, all-vehicle access. */
const readable = (u: AppUser, vehicles: string[], action: 'read' | 'mutate' = 'read') => (vehicles.length
  ? vehicles.some((v) => can(u, action, { vehicle: v, fieldClass: action === 'read' ? 'R2' : undefined }))
  : can(u, action, action === 'read' ? { fieldClass: 'R2' } : {}));

// ── Suggestions (pure) ───────────────────────────────────────────────────────────────────

const ORDER = ['new', 'sourcing', 'selected', 'connecting', 'discussing', 'committed'] as const;
export type Status = (typeof ORDER)[number] | 'passed';
const before = (s: Status, than: Status) => s !== 'passed' && than !== 'passed' && ORDER.indexOf(s) < ORDER.indexOf(than);

export interface SuggestionInput {
  pursuitId: string; status: Status; indicated: { low: number; high: number } | null;
  role: Role; kind: SignalKind; summary: string; amount?: { low: number; high?: number } | null; followUpOn?: string | null;
  messageAt: Date; messageKey: string; direction: 'ours' | 'theirs'; entityName: string;
}
export interface Suggestion {
  kind: 'status' | 'indicated' | 'next_step';
  pursuitId: string;
  why: string;
  /** A ready outreach_update payload: send it as is when the person accepts. */
  update: { pursuitId: string; words: string; applied: Record<string, unknown>; idempotencyKey: string };
}

/**
 * No touchpoint is suggested: the message is already in the trace (Juan, 5 Oct 2026: "let email be the state").
 * What the update box would carry from one signal: a status forward (never Committed, never backward), an indicated
 * amount (never soft money: that is the close track's), a next step. Only for an LP's own words on a pursuit; a
 * connector's offer becomes a next step. Nothing here is applied: a person accepts each.
 */
export function suggest(s: SuggestionInput): Suggestion[] {
  const out: Suggestion[] = [];
  const on = s.messageAt.toISOString().slice(0, 10);
  const key = (what: string) => `mail:${what}:${s.messageKey}`.replace(/[^\w.:-]/g, '_').slice(0, 100);
  const said = `${SIGNAL_LABEL[s.kind]} in mail on ${on}: ${s.summary}`;
  const theirs = s.direction === 'theirs';
  const lp = s.role === 'lp';
  if (s.status === 'passed' && s.kind !== 'interest') return out;

  if (lp && theirs && s.kind === 'decline' && s.status !== 'committed') {
    out.push({ kind: 'status', pursuitId: s.pursuitId, why: `${s.entityName} declined in the thread.`,
      update: { pursuitId: s.pursuitId, words: said, applied: { status: { to: 'passed', passedBy: 'them' } }, idempotencyKey: key('passed') } });
    return out;
  }
  const engaging: SignalKind[] = ['interest', 'soft_commit', 'indication', 'question', 'materials_request', 'meeting_request', 'timing', 'objection'];
  if (lp && theirs && engaging.includes(s.kind) && (before(s.status, 'discussing') || s.status === 'passed')) {
    out.push({ kind: 'status', pursuitId: s.pursuitId,
      why: `${s.entityName} is in a conversation with us (${SIGNAL_LABEL[s.kind].toLowerCase()}); the status is ${s.status}.`,
      update: { pursuitId: s.pursuitId, words: said, applied: { status: { to: 'discussing' } }, idempotencyKey: key('discussing') } });
  }
  if (lp && (s.kind === 'soft_commit' || s.kind === 'indication') && s.amount) {
    const low = s.amount.low;
    const high = s.amount.high ?? low;
    if (!s.indicated || s.indicated.low !== low || s.indicated.high !== high) {
      out.push({ kind: 'indicated', pursuitId: s.pursuitId,
        why: `They named ${low === high ? usd(low) : `${usd(low)}–${usd(high)}`}${s.indicated ? `; on file: ${usd(s.indicated.low)}${s.indicated.high !== s.indicated.low ? `–${usd(s.indicated.high)}` : ''}` : '; none on file'}. An indicated amount, not soft money: a soft commitment counts only when a person records it on the close track.`,
        update: { pursuitId: s.pursuitId, words: said, applied: { indicated: { low, ...(high !== low ? { high } : {}), on } }, idempotencyKey: key('indicated') } });
    }
  }
  const step = (step: string, by: string) => out.push({ kind: 'next_step', pursuitId: s.pursuitId, why: said,
    update: { pursuitId: s.pursuitId, words: said, applied: { nextStep: { step: step.slice(0, 300), on: by } }, idempotencyKey: key(`step-${s.kind}`) } });
  if (theirs) {
    const soon = plusDays(s.messageAt, 2);
    if (lp && s.kind === 'question') step(`Answer their question: ${s.summary}`, soon);
    else if (lp && s.kind === 'objection') step(`Address their concern: ${s.summary}`, soon);
    else if (lp && s.kind === 'materials_request') step(`Send what they asked for: ${s.summary}`, soon);
    else if (lp && s.kind === 'meeting_request') step('Schedule the meeting they asked for', soon);
    else if (lp && s.kind === 'timing') step(`Follow up as they asked: ${s.summary}`, s.followUpOn ?? plusDays(s.messageAt, 14));
    else if (s.role === 'connector' && s.kind === 'intro_offer') step(`Take ${s.entityName} up on the intro they offered`, soon);
    else if (s.role === 'connector' && s.kind === 'referral') step(`Follow the referral from ${s.entityName}: ${s.summary}`, soon);
  }
  return out;
}

// ── outreach_record_signals ─────────────────────────────────────────────────────────────

/** A person on record behind an address: email claims, never licensed ones (as comms_ingest matches). */
async function personOf(address: string, q: Queryable): Promise<string | null> {
  const r = await q.query<{ id: string }>(`select distinct identity.canonical_entity_id(c.entity_id)::text id
      from research.claim c left join research.source_doc d on d.doc_id = c.source
     where c.superseded_by is null and c.field ~ '(^|\\.)email$' and lower(trim(c.value)) = $1
       and c.source !~* '^dakota' and coalesce(d.origin, '') !~* 'dakota'`, [address]);
  return r.length === 1 ? r[0]!.id : null;
}

/** The active pursuits of an entity, or of the firm it acts for now, that this principal may change. */
async function pursuitsOf(entityId: string, u: AppUser, q: Queryable) {
  const rows = await q.query<{ pursuit_id: string; vehicle_id: string }>(`
    select p.pursuit_id::text, p.vehicle_id::text from strategy.active_pursuit p
     where identity.canonical_entity_id(p.entity_id) = identity.canonical_entity_id($1::uuid)
    union select p.pursuit_id::text, p.vehicle_id::text from identity.affiliation a join strategy.active_pursuit p
      on identity.canonical_entity_id(p.entity_id) = identity.canonical_entity_id(a.org_entity)
     where identity.canonical_entity_id(a.person_entity) = identity.canonical_entity_id($1::uuid) and a.ended_on is null`, [entityId]);
  return rows.filter((r) => can(u, 'mutate', { vehicle: r.vehicle_id }));
}

export async function recordSignals(ctx: Ctx, raw: Record<string, unknown>) {
  requireMutationProfile();
  const a = raw as z.infer<typeof signalsInput>;
  const db = await getDb();
  const owner = ctx.env.owner;
  const u = ctx.env.principal;
  const m = a.message;
  const at = new Date(m.date);
  if (at.getTime() > Date.now() + 5 * 60_000) throw new OutreachRefused(400, 'The message is dated in the future.');
  let messageKey = `gmail:${m.gmailMessageId}`;
  if (m.messageId) {
    const k = normalizeMessageId(m.messageId);
    if (!k) throw new OutreachRefused(400, 'messageId is not a Message-ID (<local@host>).');
    messageKey = k;
  }
  const direction = m.direction === 'sent' ? 'ours' : 'theirs';
  if (!a.signals.length && !a.dismiss?.length) throw new OutreachRefused(400, 'Nothing to record: send signals, or dismiss.');

  // Resolve every signal before writing any: who, which LP, who may read it.
  type Resolved = { i: number; entityId: string; pursuitId: string | null; vehicles: string[]; candidates: string[] };
  const resolved: Resolved[] = [];
  const unmatched: Array<{ index: number; reason: string }> = [];
  for (const [i, s] of a.signals.entries()) {
    let pursuit: { pursuit_id: string; entity_id: string; vehicle_id: string } | null = null;
    if (s.pursuitId) {
      pursuit = await db.one(`select p.pursuit_id::text, identity.canonical_entity_id(p.entity_id)::text entity_id, p.vehicle_id::text
          from strategy.pursuit p where p.pursuit_id = strategy.canonical_pursuit_id($1::uuid)`, [s.pursuitId]);
      if (!pursuit || !can(u, 'mutate', { vehicle: pursuit.vehicle_id })) throw new OutreachRefused(404, `No such LP on your vehicles (signal ${i}).`);
    }
    let entityId: string | null = s.entityId
      ? (await db.one<{ id: string }>('select identity.canonical_entity_id($1::uuid)::text id where exists (select 1 from identity.entity where entity_id = $1::uuid)', [s.entityId]))?.id ?? null
      : null;
    if (s.entityId && !entityId) throw new OutreachRefused(404, `No such person or organisation (signal ${i}).`);
    if (!entityId && s.email) entityId = await personOf(s.email, db);
    if (!entityId && pursuit) entityId = pursuit.entity_id;
    if (!entityId) { unmatched.push({ index: i, reason: s.email ? 'No one on record has that address (or more than one does).' : 'No one named.' }); continue; }
    let candidates: string[] = [];
    if (!pursuit && s.role === 'lp') {
      const mine = await pursuitsOf(entityId, u, db);
      if (mine.length === 1) pursuit = { pursuit_id: mine[0]!.pursuit_id, entity_id: entityId, vehicle_id: mine[0]!.vehicle_id };
      else candidates = mine.map((p) => p.pursuit_id);
    }
    const vehicles = pursuit ? [pursuit.vehicle_id] : await entityVehicles(entityId, db);
    if (!readable(u, vehicles, 'mutate')) throw new OutreachRefused(404, `No such person or organisation on your vehicles (signal ${i}).`);
    resolved.push({ i, entityId, pursuitId: pursuit?.pursuit_id ?? null, vehicles, candidates });
  }

  const written = await db.transaction(async (tx) => {
    const rows: Array<{ signalId: string; index: number; fresh: boolean }> = [];
    for (const r of resolved) {
      const s = a.signals[r.i]!;
      const amount = s.amount && (s.kind === 'soft_commit' || s.kind === 'indication') ? s.amount : null;
      const one = await tx.one<{ id: string; fresh: boolean }>(`insert into email.mail_signal (message_id, thread_id, sent_at, direction, entity_id, pursuit_id, vehicle_ids,
          role, kind, topic, summary, quote, amount_low, amount_high, follow_up_on, confidence, read_by, owner_id, token_id)
        values ($1, $2, $3, $4, $5, $6, $7::uuid[], $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        on conflict (message_id, entity_id, kind, coalesce(pursuit_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
          thread_id = coalesce(excluded.thread_id, email.mail_signal.thread_id), vehicle_ids = excluded.vehicle_ids, role = excluded.role,
          topic = excluded.topic, summary = excluded.summary, quote = excluded.quote, amount_low = excluded.amount_low,
          amount_high = excluded.amount_high, follow_up_on = excluded.follow_up_on, confidence = excluded.confidence,
          read_by = excluded.read_by, token_id = excluded.token_id, updated_at = now()
        returning signal_id::text id, (xmax = 0) as fresh`,
      [messageKey, m.threadId ?? null, at, direction, r.entityId, r.pursuitId, r.vehicles, s.role, s.kind, s.topic ?? null, s.summary,
        s.quote ?? null, amount?.low ?? null, amount ? (amount.high ?? amount.low) : null, s.followUpOn ?? null, s.confidence, a.readBy, owner.id, ctx.env.tokenId]);
      rows.push({ signalId: one!.id, index: r.i, fresh: one!.fresh });
    }
    let dismissed = 0;
    if (a.dismiss?.length) {
      const mine = await tx.query<{ id: string; vehicle_ids: string[] }>(`select signal_id::text id, vehicle_ids::text[] from email.mail_signal
          where signal_id = any($1::uuid[]) and dismissed_at is null`, [a.dismiss]);
      const ok = mine.filter((x) => readable(u, x.vehicle_ids, 'mutate')).map((x) => x.id);
      if (ok.length) dismissed = (await tx.query(`update email.mail_signal set dismissed_at = now(), dismissed_by = $2, updated_at = now()
          where signal_id = any($1::uuid[]) returning 1`, [ok, owner.id])).length;
    }
    // The audit carries ids, kinds and counts, never the words.
    await appendAudit({ actorId: owner.id, action: 'mail.signals', subjectType: 'mcp_token', subjectId: ctx.env.tokenId,
      detail: { message: messageKey.length > 80 ? `${messageKey.slice(0, 80)}…` : messageKey, readBy: a.readBy, signals: rows.length,
        new: rows.filter((x) => x.fresh).length, unmatched: unmatched.length, dismissed,
        kinds: rows.map((x) => a.signals[x.index]!.kind), pursuits: [...new Set(resolved.map((x) => x.pursuitId).filter(Boolean))] } }, tx);
    return { rows, dismissed };
  });

  // Suggestions from the state now: one read for every pursuit named.
  const pursuitIds = [...new Set(resolved.map((r) => r.pursuitId).filter((x): x is string => !!x))];
  const state = new Map((await db.query<{ pursuit_id: string; status: Status; name: string; low: string | null; high: string | null }>(`
    select p.pursuit_id::text, p.status::text status, e.display_name name, i.low, i.high
      from strategy.pursuit p join identity.entity e on e.entity_id = identity.canonical_entity_id(p.entity_id)
      left join lateral (select low, high from pipeline.indication x where x.pursuit_id = p.pursuit_id and x.superseded_at is null
                          order by recorded_at desc limit 1) i on true
     where p.pursuit_id = any($1::uuid[])`, [pursuitIds])).map((r) => [r.pursuit_id, r]));
  const names = new Map((await db.query<{ id: string; name: string }>('select entity_id::text id, display_name name from identity.entity where entity_id = any($1::uuid[])',
    [[...new Set(resolved.map((r) => r.entityId))]])).map((r) => [r.id, r.name]));
  const suggestions: Suggestion[] = [];
  for (const r of resolved) {
    const s = a.signals[r.i]!;
    const p = r.pursuitId ? state.get(r.pursuitId) : null;
    if (!p) continue;
    for (const x of suggest({
      pursuitId: p.pursuit_id, status: p.status, indicated: p.low != null ? { low: Number(p.low), high: Number(p.high ?? p.low) } : null,
      role: s.role, kind: s.kind, summary: s.summary, amount: s.amount ?? null, followUpOn: s.followUpOn ?? null,
      messageAt: at, messageKey, direction, entityName: names.get(r.entityId) ?? p.name,
    })) {
      // One per pursuit and kind: the first signal's wins (a status is suggested once per message).
      if (!suggestions.some((y) => y.pursuitId === x.pursuitId && y.kind === x.kind)) suggestions.push(x);
    }
  }
  return { data: {
    messageId: messageKey,
    recorded: written.rows.map((w) => {
      const r = resolved.find((x) => x.i === w.index)!;
      const s = a.signals[w.index]!;
      return { index: w.index, signalId: w.signalId, new: w.fresh, entityId: r.entityId, entityName: names.get(r.entityId) ?? null,
        pursuitId: r.pursuitId, role: s.role, kind: s.kind, ...(r.candidates.length > 1 ? { pursuitCandidates: r.candidates } : {}) };
    }),
    unmatched, dismissed: written.dismissed, suggestions,
    note: 'Kept as readings of the mail, beside each LP; nothing else changed. Each suggestion is an outreach_update payload for the person to accept as it is; none was applied. A status is never suggested backward or to Committed, and an amount is an indication, never soft money.',
  } };
}

// ── outreach_signals ─────────────────────────────────────────────────────────────────────

export const signalsReadInput = z.object({
  pursuitId: uuid.optional(), entityId: uuid.optional(),
  kind: z.enum(SIGNAL_KINDS).optional(),
  limit: z.number().int().min(1).max(200).optional(),
}).strict().refine((a) => !!a.pursuitId !== !!a.entityId, 'Give pursuitId or entityId, one of the two.');

const SELECT = `select s.signal_id::text, s.message_id, s.thread_id, s.sent_at, s.direction, s.entity_id::text, e.display_name entity_name,
    s.pursuit_id::text, s.vehicle_ids::text[], s.role, s.kind, s.topic, s.summary, s.quote, s.amount_low, s.amount_high, s.follow_up_on,
    s.confidence::text, s.read_by
  from email.mail_signal s join identity.entity e on e.entity_id = s.entity_id`;

function shape(r: Row, words: boolean, amounts: boolean) {
  const clean = (t: string | null) => (t && words ? redactHealth(t).text : null);
  return {
    signalId: r.signal_id, at: new Date(r.sent_at).toISOString(), direction: r.direction, messageId: r.message_id, threadId: r.thread_id,
    entityId: r.entity_id, entityName: r.entity_name, pursuitId: r.pursuit_id, role: r.role, kind: r.kind, kindLabel: SIGNAL_LABEL[r.kind],
    topic: words ? r.topic : null, summary: clean(r.summary), quote: clean(r.quote),
    amount: amounts && r.amount_low != null ? { low: Number(r.amount_low), high: Number(r.amount_high ?? r.amount_low) } : null,
    followUpOn: day(r.follow_up_on), confidence: r.confidence, readBy: r.read_by,
  };
}

/** One LP's or one entity's signals, newest first: the LP's own and its people's (by the pursuit, or the entity and its firm). */
export async function signalsFor(u: AppUser, a: z.infer<typeof signalsReadInput>) {
  const db = await getDb();
  let rows: Row[];
  if (a.pursuitId) {
    const p = await db.one<{ pursuit_id: string; entity_id: string; vehicle_id: string }>(`select pursuit_id::text, identity.canonical_entity_id(entity_id)::text entity_id, vehicle_id::text
        from strategy.pursuit where pursuit_id = strategy.canonical_pursuit_id($1::uuid)`, [a.pursuitId]);
    if (!p || !can(u, 'read', { vehicle: p.vehicle_id })) throw new OutreachRefused(404, 'No such LP on your vehicles.');
    rows = await db.query<Row>(`${SELECT} where s.dismissed_at is null and ($3::text is null or s.kind = $3)
        and (s.pursuit_id = $1::uuid or (s.pursuit_id is null and s.entity_id = $2::uuid))
      order by s.sent_at desc, s.signal_id limit $4`, [p.pursuit_id, p.entity_id, a.kind ?? null, a.limit ?? 50]);
  } else {
    rows = await db.query<Row>(`${SELECT} where s.dismissed_at is null and ($2::text is null or s.kind = $2)
        and s.entity_id = identity.canonical_entity_id($1::uuid)
      order by s.sent_at desc, s.signal_id limit $3`, [a.entityId, a.kind ?? null, a.limit ?? 50]);
  }
  const shown = rows.filter((r) => r.vehicle_ids.length ? r.vehicle_ids.some((v) => can(u, 'read', { vehicle: v })) : can(u, 'read', {}));
  const words = (r: Row) => readable(u, r.vehicle_ids);
  const amounts = (r: Row) => (r.vehicle_ids.length ? r.vehicle_ids.some((v) => can(u, 'read', { vehicle: v, fieldClass: 'R1' })) : can(u, 'read', { fieldClass: 'R1' }));
  return {
    data: { signals: shown.map((r) => shape(r, words(r), amounts(r))) },
    coverage: { corpus: 'Readings of the mail juanmail reported (outreach_record_signals); a mailbox it does not read is not in it. Absence is not absence in the world.', withheld: rows.length - shown.length },
    asOf: new Date().toISOString(),
  };
}

// ── outreach_insights ─────────────────────────────────────────────────────────────────────

export const insightsInput = z.object({
  vehicle: z.string().min(1).max(80).describe('A vehicle\'s slug or id.'),
  sinceDays: z.number().int().min(1).max(730).optional().describe('Look back this many days (default 90).'),
  role: z.enum(ROLES).optional(),
  examples: z.number().int().min(0).max(10).optional().describe('Latest examples per kind and topic (default 3).'),
}).strict();

/**
 * A vehicle's signals summed: by kind, by topic within kind (what LPs keep asking and objecting to), by role, and
 * per month — with the latest few examples of each. Words (R2) on the vehicle are needed; amounts (R1) for the
 * indicated sum. Deterministic: a topic is the desk's own label, so the desk keeps topics short and reused.
 */
export async function insights(u: AppUser, a: z.infer<typeof insightsInput>) {
  const v = await deskVehicle(u, a.vehicle);
  if (!can(u, 'read', { vehicle: v.id, fieldClass: 'R2' })) throw new OutreachRefused(403, 'The mail\'s readings are words (R2) on this vehicle; your access does not cover them.');
  const amounts = can(u, 'read', { vehicle: v.id, fieldClass: 'R1' });
  const since = new Date(Date.now() - (a.sinceDays ?? 90) * DAY);
  const db = await getDb();
  const rows = await db.query<Row>(`${SELECT} where s.dismissed_at is null and s.vehicle_ids @> array[$1::uuid] and s.sent_at >= $2
      and ($3::text is null or s.role = $3) order by s.sent_at desc, s.signal_id limit 5000`, [v.id, since, a.role ?? null]);
  const n = a.examples ?? 3;
  const byKind = new Map<SignalKind, Row[]>();
  for (const r of rows) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r]);
  const kinds = [...byKind].sort((x, y) => y[1].length - x[1].length).map(([kind, list]) => {
    const topics = new Map<string, Row[]>();
    for (const r of list) { const t = (r.topic ?? '').trim().toLowerCase() || '(no topic)'; topics.set(t, [...(topics.get(t) ?? []), r]); }
    return {
      kind, label: SIGNAL_LABEL[kind], signals: list.length, entities: new Set(list.map((r) => r.entity_id)).size,
      topics: [...topics].sort((x, y) => y[1].length - x[1].length || x[0].localeCompare(y[0])).slice(0, 25).map(([topic, t]) => ({
        topic, signals: t.length, entities: new Set(t.map((r) => r.entity_id)).size, lastAt: new Date(t[0]!.sent_at).toISOString(),
        examples: t.slice(0, n).map((r) => shape(r, true, amounts)),
      })),
    };
  });
  const months = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const mth = new Date(r.sent_at).toISOString().slice(0, 7);
    const o = months.get(mth) ?? {};
    o[r.kind] = (o[r.kind] ?? 0) + 1;
    months.set(mth, o);
  }
  // Indicated in mail: the latest amount per LP, summed — its own figure, never added to soft or hard (rule 1).
  const latest = new Map<string, Row>();
  for (const r of rows) if (r.amount_low != null && r.pursuit_id && !latest.has(r.pursuit_id)) latest.set(r.pursuit_id, r);
  const indicated = amounts ? [...latest.values()].reduce((o, r) => ({ low: o.low + Number(r.amount_low), high: o.high + Number(r.amount_high ?? r.amount_low), lps: o.lps + 1 }), { low: 0, high: 0, lps: 0 }) : null;
  return {
    data: {
      vehicle: { id: v.id, slug: v.slug, name: v.name }, since: since.toISOString().slice(0, 10), signals: rows.length,
      entities: new Set(rows.map((r) => r.entity_id)).size,
      byRole: Object.fromEntries(ROLES.map((r) => [r, rows.filter((x) => x.role === r).length])),
      kinds, months: [...months].sort((x, y) => x[0].localeCompare(y[0])).map(([month, counts]) => ({ month, ...counts })),
      indicatedInMail: indicated,
      note: 'Sums of the desk\'s readings of the mail, by its own kinds and topics. The amount is what LPs named in mail, latest per LP: an indication, never soft or hard money.',
    },
    coverage: { corpus: 'Readings juanmail reported (outreach_record_signals) for this vehicle', from: since.toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10),
      note: 'Only the mail juanmail reads and reads with a signal; absence is not absence in the world.' },
    asOf: new Date().toISOString(),
  };
}

// ── outreach_playbook ─────────────────────────────────────────────────────────────────────

let playbookText: string | null = null;
/** The playbook juanmail runs over the mail (docs/workflows/mail-actions.md), as markdown. */
export async function playbook() {
  playbookText ??= readFileSync(join(process.cwd(), 'docs/workflows/mail-actions.md'), 'utf8');
  return { data: { format: 'markdown', path: 'docs/workflows/mail-actions.md', text: playbookText }, asOf: new Date().toISOString() };
}
