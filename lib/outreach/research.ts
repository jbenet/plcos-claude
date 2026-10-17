import { z } from 'zod';
import { getDb } from '@/lib/db';
import { can } from '@/lib/authz';
import { requireMutationProfile } from '@/lib/mutation-policy';
import { resolveEntity } from '@/modules/identity/create';
import { appendAudit } from '@/modules/platform';
import { peopleWithAddress } from './addresses';
import { changed, claimReliedOnSince, refCounts, UNDO_HOURS } from './lps';
import { OutreachRefused } from './reads';
import { deskActor, once, type DeskContext } from './writes';

/**
 * Someone to research, on no vehicle (JuanMail relayed Juan, 14 Oct 2026: "Should be possible to research entities
 * without a vehicle"). The reconcile page in JuanMail finds people Juan emailed who are not here and whose mail was not
 * about a raise; this puts them in the research set without putting them in anyone's pipeline.
 *
 *   - Matched first, as outreach_add_lp is: a person whose address is on record is that person; otherwise the resolver
 *     (modules/identity/create.ts) decides on the name with the address's domain and the firm as evidence, and refuses
 *     when it cannot pick one person.
 *   - The request is a research.note of kind 'research_request' (the promotion rule: a note until it needs columns).
 *     The research export (lib/enrich/candidates.ts) takes everyone with one, pursuit or not. One open request per
 *     person: a second call answers the first.
 *   - The address is recorded as outreach_add_lp records one: confirmed by a person, unconfirmed when autonomous.
 *   - Undo (undoAddResearch): within a day, by the same person's token, while nothing else refers to what it added.
 */

const uuid = z.string().uuid();
const key = z.string().min(8).max(100).regex(/^[\w.:-]+$/);
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const email = z.string().max(254).transform((s) => s.trim().toLowerCase()).refine((s) => EMAIL.test(s), 'not an email address');

export const researchInput = z.object({
  address: email,
  name: z.string().trim().min(1).max(200).optional().describe('Their name as the mail gives it. Without one, the address stands in as the name.'),
  firm: z.string().trim().min(1).max(200).optional().describe('Their firm, if the mail names one: evidence for matching and a lead for research.'),
  note: z.string().transform((s) => s.trim().replace(/\s+/g, ' ')).pipe(z.string().min(1).max(300)).optional()
    .describe('One sentence on why, at most 300 characters. Never a mail body.'),
  source: z.string().min(1).max(60).regex(/^[\w.:-]+$/).describe('Who asked, e.g. "juanmail-reconcile".'),
  idempotencyKey: key,
}).strict();
type ResearchArgs = z.infer<typeof researchInput>;

export const undoResearchInput = z.object({ entityId: uuid }).strict();

interface Requested {
  ownerId: string; tokenId: string; entityId: string; autonomous: boolean; createdEntity: boolean;
  claimId: string | null; noteId: string; sourceRecord: string | null; refs: Record<string, number>;
}

class Unchanged extends Error { constructor(readonly answer: { data: unknown }) { super('unchanged'); } }

// ── POST /api/outreach/research · outreach_add_research ─────────────────────────────────

export async function addResearch(ctx: DeskContext, raw: Record<string, unknown>) {
  const a = raw as ResearchArgs;
  requireMutationProfile();
  // It writes people and claims on no vehicle, so it asks what the rest of the desk's writes ask of a token: that its
  // owner may change their own vehicles. A Viewer's token added research with no check at all (17 Oct 2026).
  if (!can(ctx.env.principal, 'mutate', { vehicle: ctx.env.principal.vehicles ?? null })) {
    throw new OutreachRefused(403, 'Not added: this token\'s owner may not change records here.');
  }
  const autonomous = ctx.env.autonomous;
  return once(ctx, 'research', a.idempotencyKey, raw, async () => {
    const owner = ctx.env.owner;
    const db = await getDb();
    const desk = autonomous ? await deskActor(db) : null;
    const name = a.name ?? a.address;
    try {
      return await db.transaction(async (tx) => {
        const byAddress = await peopleWithAddress(a.address, tx);
        if (byAddress.length > 1) {
          throw new OutreachRefused(409, `Not added: ${byAddress.length} people here have that address on record (${byAddress.map((p) => p.name).join('; ')}). Nothing was written. Resolve the duplicate in Capital OS, then call again.`);
        }
        let entityId: string, createdEntity = false, sourceRecord: string | null = null;
        if (byAddress.length === 1) entityId = byAddress[0]!.id;
        else {
          const sourceId = `email:${a.address}`;
          const had = await tx.one('select 1 from identity.source_record where source = $1 and source_id = $2', ['mail_desk', sourceId]);
          const r = await resolveEntity(tx, { type: 'person', name, source: 'mail_desk', sourceId, domains: [a.address], organizations: a.firm ? [a.firm] : [] });
          if (r.created && r.possible.length) {
            const names = await tx.query<{ name: string }>('select display_name name from identity.entity where entity_id = any($1::uuid[]) order by display_name', [r.possible]);
            throw new OutreachRefused(409, `Not added: "${name}" could be ${r.possible.length === 1 ? 'someone' : `one of ${r.possible.length} people`} already here (${names.map((n) => n.name).join('; ')}), and the mail does not say which. Nothing was written. Record the address on the right person (outreach_propose_contact), then call again.`);
          }
          entityId = r.id; createdEntity = r.created;
          if (!had) sourceRecord = sourceId;
        }

        const open = await tx.one<{ id: string }>(`select note_id::text id from research.note
          where kind = 'research_request' and identity.canonical_entity_id(entity_id) = $1::uuid order by created_at limit 1`, [entityId]);
        if (open) throw new Unchanged({ data: { entityId, created: false, requested: false, next: 'Already in the research set: nothing was changed.' } });

        const doc = `gmail:${owner.handle}`;
        await tx.query(`insert into research.source_doc (doc_id, title, kind, origin, as_of, strength, supports, body)
          values ($1, $2, 'mailbox', 'gmail', current_date, 'moderate', $3, '') on conflict (doc_id) do nothing`,
        [doc, `${owner.name}'s Gmail, through the mail desk`, 'An email address seen in correspondence in this mailbox and confirmed by its owner. Not proof the address is current.']);
        const same = await tx.one(`select 1 from research.claim where identity.canonical_entity_id(entity_id) = $1::uuid
          and superseded_by is null and field = 'email' and lower(btrim(value)) = $2 limit 1`, [entityId, a.address]);
        const claimId = same ? null : (await tx.one<{ id: string }>(`insert into research.claim (entity_id, field, value, source, as_of, confidence, last_verified_by, last_verified_at)
          values ($1, 'email', $2, $3, current_date, $4, $5, $6) returning claim_id::text id`,
        [entityId, a.address, doc, autonomous ? 'medium' : 'high', autonomous ? null : owner.id, autonomous ? null : new Date()]))!.id;

        const body = `Research asked for by ${autonomous ? 'the mail desk on its own' : owner.name} (${a.source})${a.note ? `: ${a.note}` : '.'}`;
        const noteId = (await tx.one<{ id: string }>(`insert into research.note (entity_id, author_id, kind, body, data) values ($1, $2, 'research_request', $3, $4::jsonb) returning note_id::text id`,
          [entityId, desk ?? owner.id, body, JSON.stringify({ source: a.source, address: a.address, firm: a.firm ?? null, autonomous, tokenId: ctx.env.tokenId,
            as_of: new Date().toISOString().slice(0, 10), confidence: autonomous ? 'medium' : 'high', last_verified_by: autonomous ? null : owner.id })]))!.id;

        const req: Requested = { ownerId: owner.id, tokenId: ctx.env.tokenId, entityId, autonomous, createdEntity, claimId, noteId, sourceRecord,
          refs: await refCounts(tx, 'identity', 'entity', entityId) };
        await appendAudit({ actorId: owner.id, action: 'outreach.research_added', subjectType: 'entity', subjectId: entityId, detail: { ...req, source: a.source } }, tx);
        return { data: {
          entityId, created: createdEntity, requested: true,
          next: `In the research set; the next research run picks them up. Undo within ${UNDO_HOURS} hours: DELETE /api/outreach/research?entityId=${entityId} (outreach_undo_add_research).`,
        } };
      });
    } catch (e) {
      if (e instanceof Unchanged) return e.answer;
      throw e;
    }
  });
}

// ── DELETE /api/outreach/research · outreach_undo_add_research ──────────────────────────

export async function undoAddResearch(ctx: DeskContext, raw: Record<string, unknown>) {
  const { entityId } = raw as z.infer<typeof undoResearchInput>;
  requireMutationProfile();
  const owner = ctx.env.owner;
  const db = await getDb();
  const row = await db.one<{ audit_id: string; at: Date | string; detail: Requested }>(`select id::text audit_id, at, detail from platform.audit_log
    where action = 'outreach.research_added' and subject_type = 'entity' and subject_id = $1 order by id desc limit 1`, [entityId]);
  if (!row) throw new OutreachRefused(404, 'No research request added through the mail desk for that entityId.');
  const req = row.detail, addedAt = new Date(row.at);
  if (req.ownerId !== owner.id) throw new OutreachRefused(409, 'Not undone: it was added through another person\'s token, and only they can undo it.');
  if (await db.one(`select 1 from platform.audit_log where action = 'outreach.research_undone' and subject_type = 'entity' and subject_id = $1 and at > $2`, [entityId, addedAt])) {
    throw new OutreachRefused(409, 'Not undone: it was undone already.');
  }
  if (Date.now() - addedAt.getTime() > UNDO_HOURS * 3_600_000) {
    throw new OutreachRefused(409, `Not undone: it was added ${addedAt.toISOString()}, more than ${UNDO_HOURS} hours ago. Change it in Capital OS instead.`);
  }
  return db.transaction(async (tx) => {
    if (!(await tx.one('select 1 from research.note where note_id = $1', [req.noteId]))) throw new OutreachRefused(409, 'Not undone: the request is no longer there.');
    // The person is retired only when this call created them and nothing has referred to them since.
    const retire = req.createdEntity && changed(req.refs, await refCounts(tx, 'identity', 'entity', entityId)).length === 0;
    await tx.query('delete from research.note where note_id = $1', [req.noteId]);
    if (req.claimId && !(await claimReliedOnSince(tx, entityId, row.audit_id))) await tx.query('delete from research.claim where claim_id = $1', [req.claimId]);
    if (req.sourceRecord && retire) {
      await tx.query(`delete from research.note where entity_id = $1 and kind = 'identity_creation' and data->>'source' = 'mail_desk' and data->>'sourceId' = $2`, [entityId, req.sourceRecord]);
      await tx.query(`delete from identity.source_record where source = 'mail_desk' and source_id = $1`, [req.sourceRecord]);
    }
    if (retire) await tx.query('update identity.entity set retired_at = now() where entity_id = $1 and retired_at is null', [entityId]);
    await appendAudit({ actorId: owner.id, action: 'outreach.research_undone', subjectType: 'entity', subjectId: entityId, detail: {
      entityId, tokenId: ctx.env.tokenId, autonomous: ctx.env.autonomous, entityRetired: retire, noteId: req.noteId, claimId: req.claimId,
    } }, tx);
    return { data: { entityId, undone: true, removed: { entity: retire },
      next: retire ? 'Undone: the request is gone and the person it added is retired.' : 'Undone: the request is gone. The person is kept.' } };
  });
}
