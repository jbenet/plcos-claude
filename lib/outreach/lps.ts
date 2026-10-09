import { z } from 'zod';
import { can } from '@/lib/authz';
import { getDb, type Queryable } from '@/lib/db';
import { requireMutationProfile } from '@/lib/mutation-policy';
import { addUpdate } from '@/lib/updates';
import { resolveEntity } from '@/modules/identity/create';
import { IndicationRefused } from '@/modules/pipeline';
import { appendAudit } from '@/modules/platform';
import { StatusRefused } from '@/modules/strategy';
import { peopleWithAddress } from './addresses';
import { OutreachRefused, deskVehicle } from './reads';
import { deskActor, once, type DeskContext } from './writes';

/**
 * The mail desk adds an LP from mail (docs/27-outreach-api.md §5; Juan, 9 Oct 2026: JuanMail should operate PLC OS
 * from mail). When Juan has pitched someone about a vehicle by email and they are not an LP here, the desk adds them:
 * the person (matched first, never duplicated) and their pursuit on that vehicle, with the mail as the evidence.
 *
 *   - Matched first. A person whose address on record is this one (lib/outreach/addresses.ts) is that person. Otherwise
 *     modules/identity/create.ts resolveEntity, the only entrance for creating one, decides on the name with the
 *     address's domain and the firm as evidence. When it cannot pick one person safely (a name shared with people
 *     here and no evidence that picks one), the call is refused and nothing is written.
 *   - Already on the vehicle: nothing changes, and the answer names the pursuit (created.pursuit false).
 *   - A person's call: the status is theirs ('us'), as asked; an indicated amount goes through the update box's own
 *     service (lib/updates.ts), in the same transaction; the address is confirmed by the token's owner.
 *   - An autonomous call (no person clicked): allowed, because a status is a plan, not a ladder rung (rule 2, 3). But
 *     the status is the system's ('rule'), so a person's later choice wins; the address is unconfirmed; an amount is
 *     refused (money stays a person's). The pursuit's reason and the LP's timeline say the desk added it on its own.
 *   - The mail is the record (rule 9): Gmail ids, Message-IDs and a sentence of words, never a body, kept in a note
 *     with its source, date, confidence and who verified it. One audit entry, outreach.lp_added, with ids and counts.
 *   - Undo (undoAddLp): within 24 hours, by the same person's token, while nothing else has happened on it.
 */

/** Juan's spec (9 Oct 2026): an add is undone within a day, or changed in the app like any other LP. */
export const UNDO_HOURS = 24;

const uuid = z.string().uuid();
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const key = z.string().min(8).max(100).regex(/^[\w.:-]+$/);
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const email = z.string().max(254).transform((s) => s.trim().toLowerCase()).refine((s) => EMAIL.test(s), 'not an email address');
const words = z.string().transform((s) => s.trim().replace(/\s+/g, ' ')).pipe(z.string().min(1).max(300));

export const ADD_STATUSES = ['selected', 'connecting', 'discussing'] as const;

export const addLpInput = z.object({
  vehicle: z.string().min(1).max(80).describe('The vehicle\'s slug (as in the app\'s address) or id.'),
  person: z.object({
    name: z.string().trim().min(1).max(200).describe('The name as it reads in Latin script: "Kenji Tanaka".'),
    nameAsWritten: z.string().trim().min(1).max(200).optional().describe('The name as they write it, if different: "田中 健二". Kept as evidence.'),
    email,
    firm: z.string().trim().min(1).max(200).optional().describe('Their firm, if the mail names one: evidence for matching, kept with the record.'),
  }).strict(),
  status: z.enum(ADD_STATUSES).optional().describe('Where our effort is (default connecting): a plan, never a ladder rung.'),
  indicated: z.object({ low: z.number().min(0), high: z.number().min(0).optional(), on: isoDay.optional() }).strict().optional()
    .describe('An amount they indicated in the mail. A person\'s call only: an autonomous one is refused.'),
  evidence: z.object({
    gmailMessageIds: z.array(z.string().min(1).max(100).regex(/^[\w-]+$/)).min(1).max(20),
    messageIds: z.array(z.string().min(3).max(998).regex(/^<?[^<>\s]+@[^<>\s]+>?$/)).max(20).optional(),
    words: words.describe('One sentence, at most 300 characters: what the mail shows. Never the body.'),
  }).strict(),
  idempotencyKey: key,
}).strict();
type AddLpArgs = z.infer<typeof addLpInput>;

export const undoAddLpInput = z.object({ pursuitId: uuid }).strict();

/** What an add left behind, kept in its audit entry: how undo knows what is its own. */
interface Added {
  ownerId: string; tokenId: string; vehicleId: string; entityId: string; pursuitId: string; autonomous: boolean;
  created: { entity: boolean; pursuit: boolean }; status: string; statusSource: 'us' | 'rule';
  claimId: string | null; noteId: string; updateId: string | null; indicationId: string | null; sourceRecord: string | null;
  refs: { pursuit: Record<string, number>; entity: Record<string, number> };
}

/** Answers without writing: the transaction is rolled back and this answer given. */
class Unchanged extends Error { constructor(readonly answer: { data: unknown }) { super('unchanged'); } }

const bracket = (m: string) => (m.startsWith('<') ? m : `<${m}>`).toLowerCase();
const at = (d: string) => new Date(`${d}T12:00:00Z`);

/**
 * How many rows of each table point at this pursuit or person, by every foreign key the schema has: read after an add,
 * and again at undo, so anything written on it since — an update, a touchpoint, a link, a ticket's send, a merge — shows.
 */
async function refCounts(q: Queryable, schema: 'strategy' | 'identity', table: 'pursuit' | 'entity', id: string): Promise<Record<string, number>> {
  const cols = await q.query<{ ref: string; tbl: string; col: string }>(`
    select format('%I.%I', n.nspname, cl.relname) || '.' || a.attname::text ref, format('%I.%I', n.nspname, cl.relname) tbl, format('%I', a.attname) col
      from pg_constraint c join pg_class cl on cl.oid = c.conrelid join pg_namespace n on n.oid = cl.relnamespace
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and array_length(c.conkey, 1) = 1
       and c.confrelid = (select t.oid from pg_class t join pg_namespace s on s.oid = t.relnamespace where s.nspname = $1 and t.relname = $2)
     order by 1`, [schema, table]);
  if (!cols.length) return {};
  // The names come from the catalog, quoted by format(%I); the id is a parameter.
  const rows = await q.query<{ i: number; n: number }>(cols.map((c, i) => `select ${i} i, count(*)::int n from ${c.tbl} where ${c.col} = $1::uuid`).join(' union all '), [id]);
  const out: Record<string, number> = {};
  for (const r of rows) if (r.n) out[cols[r.i]!.ref] = r.n;
  return out;
}

const changed = (before: Record<string, number>, now: Record<string, number>) =>
  [...new Set([...Object.keys(before), ...Object.keys(now)])].filter((k) => (before[k] ?? 0) !== (now[k] ?? 0));

const TABLE_WORD: Record<string, string> = {
  'strategy.pursuit_update': 'an update', 'meetings.meeting': 'a touchpoint', 'email.message_link': 'a linked message', 'email.comms_message': 'a message in the trace',
  'email.outreach_send': 'a send ticket', 'strategy.ladder_event': 'a ladder rung', 'pipeline.indication': 'an indicated amount', 'strategy.pursuit': 'a merge',
  'coordination.ask': 'an intro ask', 'email.draft': 'a draft', 'strategy.suggestion': 'a strategy',
};
const ACTION_WORD: Record<string, string> = {
  'pursuit.update_added': 'an update', 'pursuit.status_set': 'a status change', 'pursuit.next_step_set': 'a next step', 'pursuit.indication_recorded': 'an indicated amount',
  'outreach.message_linked': 'a linked message', 'outreach.ticket_requested': 'a ticket', 'pursuit.merged': 'a merge',
};
const describe = (refs: string[]) => [...new Set(refs.map((r) => TABLE_WORD[r.replace(/\.[^.]+$/, '')] ?? r.replace(/\.[^.]+$/, '')))];

// ── POST /api/outreach/lps · outreach_add_lp ────────────────────────────────────────────

export async function addLp(ctx: DeskContext, raw: Record<string, unknown>) {
  const a = raw as AddLpArgs;
  // Before the request key is reserved: a server that is not the live one writes nothing at all.
  requireMutationProfile();
  const autonomous = ctx.env.autonomous;
  if (autonomous && a.indicated) {
    throw new OutreachRefused(400, 'Not added: an amount is a person\'s to record. Called autonomously (no person clicked), leave out indicated; a person adds it with outreach_update.');
  }
  return once(ctx, 'lps', a.idempotencyKey, async () => {
    const owner = ctx.env.owner;
    const v = await deskVehicle(ctx.env.principal, a.vehicle);
    if (!can(ctx.env.principal, 'mutate', { vehicle: v.id })) throw new OutreachRefused(404, `No vehicle "${a.vehicle.slice(0, 80)}" among yours that you may change.`);
    const status = a.status ?? 'connecting';
    const db = await getDb();
    const desk = autonomous ? await deskActor(db) : null;
    const today = new Date().toISOString().slice(0, 10);
    const gmailIds = [...new Set(a.evidence.gmailMessageIds)];
    const messageIds = [...new Set((a.evidence.messageIds ?? []).map(bracket))];
    try {
      return await db.transaction(async (tx) => {
        // ── Who: the address on record first, then the resolver, never a second record for one person ──
        const byAddress = await peopleWithAddress(a.person.email, tx);
        if (byAddress.length > 1) {
          throw new OutreachRefused(409, `Not added: ${byAddress.length} people here have that address on record (${byAddress.map((p) => p.name).join('; ')}), so it does not say which one. Nothing was written. Resolve the duplicate in Capital OS, then call again.`);
        }
        let entityId: string, createdEntity = false, rule = 'address', sourceRecord: string | null = null;
        if (byAddress.length === 1) entityId = byAddress[0]!.id;
        else {
          const sourceId = `email:${a.person.email}`;
          const had = await tx.one('select 1 from identity.source_record where source = $1 and source_id = $2', ['mail_desk', sourceId]);
          const r = await resolveEntity(tx, { type: 'person', name: a.person.name, source: 'mail_desk', sourceId,
            domains: [a.person.email], organizations: a.person.firm ? [a.person.firm] : [] });
          if (r.created && r.possible.length) {
            const names = await tx.query<{ name: string }>('select display_name name from identity.entity where entity_id = any($1::uuid[]) order by display_name', [r.possible]);
            throw new OutreachRefused(409, `Not added: "${a.person.name}" could be ${r.possible.length === 1 ? 'someone' : `one of ${r.possible.length} people`} already here (${names.map((n) => n.name).join('; ')}), and the mail (the address's domain${a.person.firm ? ', the firm' : ''}) does not say which. Nothing was written. Record the address on the right person (outreach_propose_contact) or add them in Capital OS, then call again.`);
          }
          entityId = r.id; createdEntity = r.created; rule = r.rule;
          if (!had) sourceRecord = sourceId;
        }

        // ── Already on the vehicle: change nothing ──
        const existing = await tx.one<{ id: string; status: string }>(`select p.pursuit_id::text id, p.status::text status from strategy.pursuit p
          where identity.canonical_entity_id(p.entity_id) = $1::uuid and p.vehicle_id = $2 and p.merged_into is null order by p.opened_at, p.pursuit_id limit 1`, [entityId, v.id]);
        if (existing) {
          throw new Unchanged({ data: {
            entityId, pursuitId: existing.id, created: { entity: false, pursuit: false }, status: existing.status, autonomous,
            next: `Already an LP on ${v.name}: nothing was changed. Update it with outreach_update (pursuitId).`,
          } });
        }

        // ── The pursuit: a person's status, or the system's ──
        const statusSource = autonomous ? 'rule' : 'us';
        const reason = autonomous ? `Added by the mail desk on its own, from mail: ${a.evidence.words}` : a.evidence.words;
        const pursuit = await tx.one<{ id: string }>(`insert into strategy.pursuit (entity_id, vehicle_id, owner_id, status, status_source, status_reason,
            status_set_at, status_set_by, source, source_ref, source_as_of)
          values ($1, $2, $3, $4::strategy.pursuit_status, $5, $6, now(), $7, 'mail_desk', $8, now())
          on conflict (entity_id, vehicle_id) do nothing returning pursuit_id::text id`,
        [entityId, v.id, owner.id, status, statusSource, reason, desk ?? owner.id, gmailIds[0]]);
        if (!pursuit) throw new OutreachRefused(409, `Not added: this person already has a pursuit on ${v.name} (added a moment ago, or merged into another). Nothing was written; open the LP in Capital OS.`);
        const pursuitId = pursuit.id;

        // ── The address, as outreach_propose_contact records one: confirmed by a person, or not confirmed ──
        const doc = `gmail:${owner.handle}`;
        await tx.query(`insert into research.source_doc (doc_id, title, kind, origin, as_of, strength, supports, body)
          values ($1, $2, 'mailbox', 'gmail', current_date, 'moderate', $3, '') on conflict (doc_id) do nothing`,
        [doc, `${owner.name}'s Gmail, through the mail desk`, 'An email address seen in correspondence in this mailbox and confirmed by its owner. Not proof the address is current.']);
        const same = await tx.one<{ id: string }>(`select claim_id::text id from research.claim where identity.canonical_entity_id(entity_id) = $1::uuid
          and superseded_by is null and source = $2 and field = 'email' and lower(btrim(value)) = $3 limit 1`, [entityId, doc, a.person.email]);
        const claimId = same ? null : (await tx.one<{ id: string }>(`insert into research.claim (entity_id, field, value, source, as_of, confidence, last_verified_by, last_verified_at)
          values ($1, 'email', $2, $3, current_date, $4, $5, $6) returning claim_id::text id`,
        [entityId, a.person.email, doc, autonomous ? 'medium' : 'high', autonomous ? null : owner.id, autonomous ? null : new Date()]))!.id;

        // ── The mail as the record (rule 9): ids and a sentence, never a body ──
        const noteId = (await tx.one<{ id: string }>(`insert into research.note (entity_id, author_id, kind, body, data) values ($1, $2, 'context', $3, $4::jsonb) returning note_id::text id`,
          [entityId, desk ?? owner.id, autonomous ? `Added to ${v.name} by the mail desk on its own, from mail: ${a.evidence.words}` : `Added to ${v.name} from mail by ${owner.name}: ${a.evidence.words}`,
            JSON.stringify({ source: 'mail_desk', pursuitId, vehicleId: v.id, autonomous, gmailMessageIds: gmailIds, messageIds, words: a.evidence.words,
              nameAsWritten: a.person.nameAsWritten ?? null, firm: a.person.firm ?? null, tokenId: ctx.env.tokenId,
              as_of: today, confidence: autonomous ? 'medium' : 'high', last_verified_by: autonomous ? null : owner.id })]))!.id;

        // ── An amount they indicated: the update box's own service, in this transaction ──
        let updateId: string | null = null, indicationId: string | null = null;
        if (a.indicated) {
          const r = await addUpdate(owner.id, {
            pursuitId, body: a.evidence.words, idempotencyKey: `desk:${owner.id}:lps:${a.idempotencyKey}`,
            indicated: { low: a.indicated.low, high: a.indicated.high ?? null, on: a.indicated.on ? at(a.indicated.on) : null },
          }, { q: tx });
          updateId = r.updateId; indicationId = r.applied.indicated?.indicationId ?? null;
        }

        const added: Added = {
          ownerId: owner.id, tokenId: ctx.env.tokenId, vehicleId: v.id, entityId, pursuitId, autonomous,
          created: { entity: createdEntity, pursuit: true }, status, statusSource, claimId, noteId, updateId, indicationId, sourceRecord,
          refs: { pursuit: await refCounts(tx, 'strategy', 'pursuit', pursuitId), entity: await refCounts(tx, 'identity', 'entity', entityId) },
        };
        await appendAudit({ actorId: owner.id, action: 'outreach.lp_added', subjectType: 'pursuit', subjectId: pursuitId, detail: {
          ...added, rule, gmailMessageIds: gmailIds, messages: { gmail: gmailIds.length, messageIds: messageIds.length }, indicated: !!indicationId,
        } }, tx);
        return { data: {
          entityId, pursuitId, created: { entity: createdEntity, pursuit: true }, status, autonomous,
          next: `Added to ${v.name}${autonomous ? ', marked as added by the mail desk on its own: a person\'s status replaces this one, and the address is unconfirmed' : ''}. `
            + `Open it at /${v.slug}/pipeline/${pursuitId}. Undo within ${UNDO_HOURS} hours, while nothing else has happened on it: DELETE /api/outreach/lps?pursuitId=${pursuitId} (outreach_undo_add_lp).`,
        } };
      });
    } catch (e) {
      if (e instanceof Unchanged) return e.answer;
      if (e instanceof StatusRefused || e instanceof IndicationRefused) throw new OutreachRefused(422, e.message);
      throw e;
    }
  });
}

// ── DELETE /api/outreach/lps · outreach_undo_add_lp ─────────────────────────────────────

const FK_VIOLATION = (e: unknown) => (e as { code?: string })?.code === '23503';

export async function undoAddLp(ctx: DeskContext, raw: Record<string, unknown>) {
  const { pursuitId } = raw as z.infer<typeof undoAddLpInput>;
  requireMutationProfile();
  const owner = ctx.env.owner;
  const db = await getDb();
  const row = await db.one<{ audit_id: string; at: Date | string; detail: Added }>(`select id::text audit_id, at, detail from platform.audit_log
    where action = 'outreach.lp_added' and subject_type = 'pursuit' and subject_id = $1 order by id desc limit 1`, [pursuitId]);
  const none = new OutreachRefused(404, 'No LP added through the mail desk with that pursuitId on your vehicles.');
  if (!row || !can(ctx.env.principal, 'mutate', { vehicle: row.detail.vehicleId })) throw none;
  const added = row.detail, addedAt = new Date(row.at);
  if (added.ownerId !== owner.id) throw new OutreachRefused(409, 'Not undone: it was added through another person\'s token, and only they can undo it. Change it in Capital OS instead.');
  if (await db.one(`select 1 from platform.audit_log where action = 'outreach.lp_undone' and subject_type = 'pursuit' and subject_id = $1`, [pursuitId])) {
    throw new OutreachRefused(409, 'Not undone: it was undone already.');
  }
  if (Date.now() - addedAt.getTime() > UNDO_HOURS * 3_600_000) {
    throw new OutreachRefused(409, `Not undone: it was added ${addedAt.toISOString()}, more than ${UNDO_HOURS} hours ago. Change it in Capital OS instead.`);
  }
  try {
    return await db.transaction(async (tx) => {
      await tx.exec('lock table strategy.pursuit in row exclusive mode');
      const p = await tx.one<{ status: string; status_source: string; owner_id: string; merged_into: string | null }>(`select status::text, status_source,
        owner_id::text, merged_into::text from strategy.pursuit where pursuit_id = $1 for update`, [pursuitId]);
      if (!p) throw new OutreachRefused(409, 'Not undone: that pursuit is no longer there.');
      // Anything since the add: on the pursuit's own row, in the audit log after its transaction, or a new row pointing at it.
      const happened: string[] = [];
      if (p.merged_into) happened.push('a merge');
      if (p.status !== added.status || p.status_source !== added.statusSource) happened.push('a status change');
      if (p.owner_id !== added.ownerId) happened.push('a new owner');
      // After the add's own transaction (its rows share its time, to the microsecond).
      const later = await tx.query<{ action: string }>(`select distinct action from platform.audit_log
        where at > (select at from platform.audit_log where id = $2::bigint) and action not in ('mcp.call')
        and ((subject_type = 'pursuit' and subject_id = $1) or detail->>'pursuitId' = $1 or detail->'pursuitIds' ? $1)`, [pursuitId, row.audit_id]);
      happened.push(...later.map((l) => ACTION_WORD[l.action] ?? l.action.replace(/^[a-z_]+\./, '').replace(/_/g, ' ')));
      if (await tx.one('select 1 from governance.approval_ticket where subject_id = $1::uuid', [pursuitId])) happened.push('a ticket');
      happened.push(...describe(changed(added.refs.pursuit, await refCounts(tx, 'strategy', 'pursuit', pursuitId))));
      if (happened.length) {
        throw new OutreachRefused(409, `Not undone: something has happened on this LP since it was added (${[...new Set(happened)].join(', ')}). Change it in Capital OS instead.`);
      }
      if (added.indicationId) {
        const seats = await tx.one<{ n: number }>(`select coalesce(sum((detail->>'seatsMovedToIoi')::int), 0)::int n from platform.audit_log
          where action = 'pursuit.indication_recorded' and detail->>'indicationId' = $1`, [added.indicationId]);
        if (seats?.n) throw new OutreachRefused(409, 'Not undone: the amount it recorded moved an SPV seat to IOI. Change it in Capital OS instead.');
      }
      // The person: retired only when this add created them and nothing else refers to them now.
      const entityRefs = await refCounts(tx, 'identity', 'entity', added.entityId);
      const retire = added.created.entity && changed(added.refs.entity, entityRefs).length === 0;

      if (added.indicationId) await tx.query('delete from pipeline.indication where indication_id = $1', [added.indicationId]);
      if (added.updateId) await tx.query('delete from strategy.pursuit_update where update_id = $1', [added.updateId]);
      await tx.query('delete from strategy.pursuit where pursuit_id = $1', [pursuitId]);
      await tx.query('delete from research.note where note_id = $1', [added.noteId]);
      if (added.claimId) await tx.query('delete from research.claim where claim_id = $1', [added.claimId]);
      if (added.sourceRecord && (retire || !added.created.entity)) {
        await tx.query(`delete from research.note where entity_id = $1 and kind = 'identity_creation' and data->>'source' = 'mail_desk' and data->>'sourceId' = $2`, [added.entityId, added.sourceRecord]);
        await tx.query(`delete from identity.source_record where source = 'mail_desk' and source_id = $1`, [added.sourceRecord]);
      }
      if (retire) await tx.query('update identity.entity set retired_at = now() where entity_id = $1 and retired_at is null', [added.entityId]);
      await appendAudit({ actorId: owner.id, action: 'outreach.lp_undone', subjectType: 'pursuit', subjectId: pursuitId, detail: {
        pursuitId, entityId: added.entityId, vehicleId: added.vehicleId, tokenId: ctx.env.tokenId, autonomous: ctx.env.autonomous, entityRetired: retire,
        claimId: added.claimId, noteId: added.noteId, updateId: added.updateId, indicationId: added.indicationId,
      } }, tx);
      return { data: {
        pursuitId, entityId: added.entityId, undone: true, removed: { pursuit: true, entity: retire },
        next: retire ? 'Undone: the pursuit is gone and the person it added is retired.'
          : added.created.entity ? 'Undone: the pursuit is gone. The person it added is kept: something else here refers to them now.'
            : 'Undone: the pursuit is gone. The person was already here and is kept.',
      } };
    });
  } catch (e) {
    if (FK_VIOLATION(e)) throw new OutreachRefused(409, 'Not undone: something else here now refers to what it added. Change it in Capital OS instead.');
    throw e;
  }
}
