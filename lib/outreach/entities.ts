import { z } from 'zod';
import { can } from '@/lib/authz';
import { getDb, type Queryable } from '@/lib/db';
import { requireMutationProfile } from '@/lib/mutation-policy';
import { identityEmailDomain, resolveEntity } from '@/modules/identity/create';
import { normalizeIdentityName } from '@/modules/identity/resolution';
import { appendAudit } from '@/modules/platform';
import { LINK_ROLES, RELATIONS, type Relation } from './entity-reads';
import { peopleWithAddress } from './addresses';
import { changed, claimReliedOnSince, refCounts, UNDO_HOURS } from './lps';
import { OutreachRefused } from './reads';
import { deskActor, entityVehicles, onOthersVehicle, once, UNCONFIRMED_ELSEWHERE, type DeskContext } from './writes';

/**
 * Who someone is to us when they are not an LP, and where mail to an LP goes (JuanMail feedback 0173 and 0174; Juan
 * said yes, 15 Oct 2026). docs/27 §5c.
 *
 *   - Send-to: one address per entity that mail goes To (an investments@ inbox), its main contact cc'd. Set by
 *     outreach_propose_contact with role 'send-to'; a new one replaces the old. Read back as entity.sendTo.
 *   - Relation: a non-LP organisation is a portfolio company, a prospect company, a service provider or other
 *     (identity.entity_relation). An LP is anyone with a pursuit; a company in network.portfolio reads as a portfolio
 *     company without a row. A row set here wins.
 *   - Links: a person on a company's team, or an LP's assistant: an identity.affiliation (kind staff, role 'team' or
 *     'assistant', source mail_desk), never primary, so it does not make them the LP's contact for outreach.
 *   - outreach_add_entity makes these from mail, matched first and never duplicated, as outreach_add_lp is; undo
 *     within a day.
 */


const uuid = z.string().uuid();
const key = z.string().min(8).max(100).regex(/^[\w.:-]+$/);
const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const email = z.string().max(254).transform((s) => s.trim().toLowerCase()).refine((s) => EMAIL.test(s), 'not an email address');
const words = z.string().transform((s) => s.trim().replace(/\s+/g, ' ')).pipe(z.string().min(1).max(300));

// ── The send-to role (outreach_propose_contact role 'send-to' / 'none') ─────────────────

/**
 * Makes this address the entity's send-to, replacing any other; answers the one it replaced. The replaced address,
 * who set it and when stay in the audit entry (red team, 17 Oct 2026: the row was deleted and the old address lost),
 * so the LP page shows it and can put it back through this same path. `actorId` is who it is attributed to: the
 * Mail desk actor for an autonomous call, the person otherwise.
 */
export async function setSendTo(tx: Queryable, a: { entityId: string; email: string; claimId: string | null; actorId: string; tokenId: string | null; autonomous: boolean; source: string }) {
  const prior = await tx.query<{ entity_id: string; email: string; set_by: string; set_at: Date | string; source: string }>(`select s.entity_id::text, s.email,
      s.set_by::text, s.set_at, s.source
    from identity.alias_pairs(array[$1::uuid]) p join identity.send_to s on s.entity_id = p.entity_id order by s.set_at desc`, [a.entityId]);
  // One per entity, through merges: rows on its merged records go too.
  await tx.query('delete from identity.send_to where entity_id = any($1::uuid[])', [prior.map((p) => p.entity_id)]);
  await tx.query(`insert into identity.send_to (entity_id, email, claim_id, set_by, source) values ($1, $2, $3, $4, $5)`,
    [a.entityId, a.email, a.claimId, a.actorId, a.source]);
  const was = prior.find((p) => p.email !== a.email) ?? null;
  const replaced = was?.email ?? null;
  await appendAudit({ actorId: a.actorId, action: 'contact.send_to_set', subjectType: 'entity', subjectId: a.entityId,
    detail: { email: a.email, claimId: a.claimId, tokenId: a.tokenId, autonomous: a.autonomous, source: a.source, replaced: replaced !== null,
      unchanged: prior.some((p) => p.email === a.email), previous: was ? previousOf(was) : null } }, tx);
  return { replaced };
}

const previousOf = (r: { email: string; set_by: string; set_at: Date | string; source: string }) =>
  ({ email: r.email, setBy: r.set_by, setAt: new Date(r.set_at).toISOString(), source: r.source });

/** Clears the entity's send-to when it is this address; answers whether it was. The cleared address stays in the audit entry. */
export async function clearSendTo(tx: Queryable, a: { entityId: string; email: string; actorId: string; tokenId: string; autonomous: boolean }) {
  const gone = await tx.query<{ email: string; set_by: string; set_at: Date | string; source: string }>(`delete from identity.send_to where email = $2
    and entity_id = any(identity.alias_ids(array[$1::uuid])) returning email, set_by::text, set_at, source`, [a.entityId, a.email]);
  if (gone.length) await appendAudit({ actorId: a.actorId, action: 'contact.send_to_cleared', subjectType: 'entity', subjectId: a.entityId,
    detail: { tokenId: a.tokenId, autonomous: a.autonomous, previous: previousOf(gone[0]!) } }, tx);
  return gone.length > 0;
}

// ── POST /api/outreach/entities · outreach_add_entity ───────────────────────────────────

export const ENTITY_TYPES = ['person', ...RELATIONS] as const;

export const addEntityInput = z.object({
  type: z.enum(ENTITY_TYPES).describe('person, or what an organisation is to us: portfolio-company, prospect-company, service-provider, other.'),
  name: z.string().trim().min(1).max(200).describe('The name as the mail gives it.'),
  email: email.optional().describe('Their address. For a person, the strongest evidence for matching; for a company, its domain is.'),
  companyEntityId: uuid.optional().describe('A person only, with role: the company they are on the team of (team), or the LP they assist (assistant).'),
  role: z.enum(LINK_ROLES).optional().describe('A person only, with companyEntityId: team (at a company) or assistant (of an LP, a person or a firm).'),
  evidence: z.object({
    gmailMessageIds: z.array(z.string().min(1).max(100).regex(/^[\w-]+$/)).min(1).max(20),
    words: words.describe('One sentence, at most 300 characters: what the mail shows. Never the body.'),
  }).strict(),
  idempotencyKey: key,
}).strict()
  .refine((a) => !!a.companyEntityId === !!a.role, 'Give companyEntityId and role together, or neither.')
  .refine((a) => a.type === 'person' || !a.role, 'companyEntityId and role are for a person.');
type AddEntityArgs = z.infer<typeof addEntityInput>;

export const undoAddEntityInput = z.object({ entityId: uuid }).strict();

/** What an add left behind, in its audit entry: how undo knows what is its own. */
interface Added {
  ownerId: string; tokenId: string; entityId: string; autonomous: boolean; createdEntity: boolean; sourceRecord: string | null;
  claimId: string | null; noteId: string; affiliationId: string | null;
  relation: { set: Relation | null; previous: { relation: Relation; setBy: string; setAt: string; source: string } | null } | null;
  refs: Record<string, number>;
}

class Unchanged extends Error { constructor(readonly answer: { data: unknown }) { super('unchanged'); } }

const ORG_TYPES = ['org', 'family', 'foundation'];

export async function addEntity(ctx: DeskContext, raw: Record<string, unknown>) {
  const a = raw as AddEntityArgs;
  requireMutationProfile();
  const autonomous = ctx.env.autonomous;
  return once(ctx, 'entities', a.idempotencyKey, raw, async () => {
    const owner = ctx.env.owner;
    const db = await getDb();
    const desk = autonomous ? await deskActor(db) : null;
    const isPerson = a.type === 'person';
    const relation: Relation | null = isPerson ? null : a.type as Relation;

    // ── The company or LP a person is linked to: there, and one you may change ──
    let company: { id: string; name: string; type: string } | null = null;
    // The company is also on a vehicle the caller may not change: the link is made, the address written unconfirmed.
    let companyElsewhere = false;
    if (a.companyEntityId) {
      company = await db.one<{ id: string; name: string; type: string }>(`select e.entity_id::text id, e.display_name name, e.entity_type::text type
        from identity.entity e where e.entity_id = identity.canonical_entity_id($1::uuid) and e.retired_at is null`, [a.companyEntityId]);
      if (!company) throw new OutreachRefused(404, 'No such companyEntityId.');
      const vehicles = await entityVehicles(company.id, db);
      if (a.role === 'assistant' && !vehicles.length) throw new OutreachRefused(422, `Not added: ${company.name} is not an LP here (no pursuit), so nobody can be their assistant. Use role team for a company's people.`);
      if (a.role === 'team' && !ORG_TYPES.includes(company.type)) throw new OutreachRefused(422, `Not added: ${company.name} is a person, not a company. An LP's helper is role assistant.`);
      const mayChange = vehicles.length ? vehicles.some((v) => can(ctx.env.principal, 'mutate', { vehicle: v })) : can(ctx.env.principal, 'mutate', {});
      if (!mayChange) throw new OutreachRefused(404, 'No such companyEntityId.');
      companyElsewhere = vehicles.some((v) => !can(ctx.env.principal, 'mutate', { vehicle: v }));
    } else if (!can(ctx.env.principal, 'mutate', {})) {
      throw new OutreachRefused(403, 'Your access may not add people or organisations.');
    }

    try {
      return await db.transaction(async (tx) => {
        // ── Who: matched first, never a second record ──
        let entityId: string | null = null, createdEntity = false, rule = 'new', sourceRecord: string | null = null;
        const typeOf = async (ids: string[]) => tx.query<{ id: string; type: string; name: string }>(`select entity_id::text id, entity_type::text type, display_name name
          from identity.entity where entity_id = any($1::uuid[]) and retired_at is null`, [ids]);
        if (a.email) {
          const byAddress = (await typeOf((await peopleWithAddress(a.email, tx)).map((p) => p.id)))
            .filter((e) => (isPerson ? e.type === 'person' : ORG_TYPES.includes(e.type)));
          if (byAddress.length > 1) {
            throw new OutreachRefused(409, `Not added: ${byAddress.length} ${isPerson ? 'people' : 'organisations'} here have that address on record (${byAddress.map((p) => p.name).join('; ')}), so it does not say which. Nothing was written. Resolve the duplicate in Capital OS, then call again.`);
          }
          if (byAddress.length === 1) { entityId = byAddress[0]!.id; rule = 'address'; }
        }
        if (!entityId && isPerson && company) {
          // Someone already linked to that company under the same name is that person.
          const same = (await tx.query<{ id: string; name: string }>(`select distinct p.entity_id::text id, p.display_name name from identity.affiliation af
            join identity.entity p on p.entity_id = identity.canonical_entity_id(af.person_entity)
            where af.org_entity = any(identity.alias_ids(array[$1::uuid])) and af.ended_on is null and p.retired_at is null`, [company.id]))
            .filter((p) => normalizeIdentityName(p.name) === normalizeIdentityName(a.name));
          if (same.length === 1) { entityId = same[0]!.id; rule = 'name_at_company'; }
        }
        if (!entityId && !isPerson) {
          // An organisation: the address's domain, then one organisation of that name.
          const domain = a.email ? identityEmailDomain(a.email) : null;
          const byDomain = domain ? await tx.query<{ id: string }>(`select distinct identity.canonical_entity_id(x.entity_id)::text id from identity.external_identifier x
            join identity.entity e on e.entity_id = identity.canonical_entity_id(x.entity_id)
            where x.kind = 'domain' and lower(x.value) = $1 and e.retired_at is null and e.entity_type::text = any($2::text[])`, [domain, ORG_TYPES]) : [];
          if (byDomain.length === 1) { entityId = byDomain[0]!.id; rule = 'domain'; }
          else {
            const named = (await tx.query<{ id: string; name: string }>(`select entity_id::text id, display_name name from identity.entity
              where merged_into is null and retired_at is null and entity_type::text = any($2::text[]) and lower(display_name) = lower($1)`, [a.name, ORG_TYPES]))
              .filter((e) => normalizeIdentityName(e.name) === normalizeIdentityName(a.name));
            if (named.length > 1) {
              throw new OutreachRefused(409, `Not added: ${named.length} organisations here are called "${a.name}". Nothing was written. Merge them in Capital OS, or give the address so its domain picks one.`);
            }
            if (named.length === 1) { entityId = named[0]!.id; rule = 'name'; }
          }
        }
        if (!entityId) {
          const sourceId = a.email ? `email:${a.email}` : `entity:${owner.id}:${a.idempotencyKey}`;
          const had = await tx.one('select 1 from identity.source_record where source = $1 and source_id = $2', ['mail_desk', sourceId]);
          const r = await resolveEntity(tx, { type: isPerson ? 'person' : 'org', name: a.name, source: 'mail_desk', sourceId,
            domains: a.email ? [a.email] : [], organizations: company && isPerson && a.role === 'team' ? [company.name] : [] });
          const sameType = r.created && r.possible.length ? (await typeOf(r.possible)).filter((e) => (isPerson ? e.type === 'person' : ORG_TYPES.includes(e.type))) : [];
          if (sameType.length) {
            throw new OutreachRefused(409, `Not added: "${a.name}" could be ${sameType.length === 1 ? 'someone' : `one of ${sameType.length}`} already here (${sameType.map((n) => n.name).join('; ')}), and the mail does not say which. Nothing was written. Record the address on the right one (outreach_propose_contact), then call again.`);
          }
          entityId = r.id; createdEntity = r.created; rule = r.rule;
          if (!had) sourceRecord = sourceId;
        }
        const found = (await typeOf([entityId]))[0];
        if (!found) throw new OutreachRefused(409, 'Not added: the match is retired. Nothing was written.');
        if (isPerson ? found.type !== 'person' : !ORG_TYPES.includes(found.type)) {
          throw new OutreachRefused(409, `Not added: the match, ${found.name}, is ${found.type === 'person' ? 'a person' : 'an organisation'} here. Nothing was written.`);
        }
        if (company && company.id === entityId) throw new OutreachRefused(422, 'Not added: a person cannot be linked to themselves.');

        // ── What it is to us: the relation, replacing an earlier one ──
        let relationAnswer: Added['relation'] = null;
        if (relation) {
          const prev = await tx.one<{ entity_id: string; relation: Relation; set_by: string; set_at: Date | string; source: string }>(`select r.entity_id::text, r.relation, r.set_by::text, r.set_at, r.source
            from identity.alias_pairs(array[$1::uuid]) p join identity.entity_relation r on r.entity_id = p.entity_id order by r.set_at desc limit 1`, [entityId]);
          if (prev?.relation !== relation) {
            await tx.query('delete from identity.entity_relation where entity_id = any(identity.alias_ids(array[$1::uuid]))', [entityId]);
            await tx.query('insert into identity.entity_relation (entity_id, relation, set_by, source) values ($1, $2, $3, $4)', [entityId, relation, desk ?? owner.id, 'mail_desk']);
            relationAnswer = { set: relation, previous: prev ? { relation: prev.relation, setBy: prev.set_by, setAt: new Date(prev.set_at).toISOString(), source: prev.source } : null };
          }
        }

        // ── The link: team at a company, or an LP's assistant ──
        let affiliationId: string | null = null;
        if (company && a.role) {
          const open = await tx.one(`select 1 from identity.affiliation where person_entity = any(identity.alias_ids(array[$1::uuid]))
            and org_entity = any(identity.alias_ids(array[$2::uuid])) and ended_on is null and lower(role) = $3`, [entityId, company.id, a.role]);
          if (!open) {
            affiliationId = (await tx.one<{ id: string }>(`insert into identity.affiliation (person_entity, org_entity, kind, role, is_primary, source, as_of, certainty, note)
              values ($1, $2, 'staff', $3, false, 'mail_desk', current_date, $4, $5) returning affiliation_id::text id`,
            [entityId, company.id, a.role, autonomous ? 'probable' : 'known', `From mail: ${a.evidence.words}`]))!.id;
          }
        }

        // ── The address, as outreach_add_lp records one ──
        let claimId: string | null = null;
        const elsewhere = companyElsewhere || (!createdEntity && await onOthersVehicle(ctx.env.principal, entityId, tx));
        const verified = !autonomous && !elsewhere;
        if (a.email) {
          const doc = `gmail:${owner.handle}`;
          await tx.query(`insert into research.source_doc (doc_id, title, kind, origin, as_of, strength, supports, body)
            values ($1, $2, 'mailbox', 'gmail', current_date, 'moderate', $3, '') on conflict (doc_id) do nothing`,
          [doc, `${owner.name}'s Gmail, through the mail desk`, 'An email address seen in correspondence in this mailbox and confirmed by its owner. Not proof the address is current.']);
          const same = await tx.one(`select 1 from research.claim where entity_id = any(identity.alias_ids(array[$1::uuid]))
            and superseded_by is null and field = 'email' and lower(btrim(value)) = $2 limit 1`, [entityId, a.email]);
          claimId = same ? null : (await tx.one<{ id: string }>(`insert into research.claim (entity_id, field, value, source, as_of, confidence, last_verified_by, last_verified_at)
            values ($1, 'email', $2, $3, current_date, $4, $5, $6) returning claim_id::text id`,
          [entityId, a.email, doc, verified ? 'high' : 'medium', verified ? owner.id : null, verified ? new Date() : null]))!.id;
        }

        if (!createdEntity && !relationAnswer && !affiliationId && !claimId) {
          throw new Unchanged({ data: { entityId, type: found.type === 'person' ? 'person' : 'org', relation: relation ?? null, created: { entity: false, relation: false, link: false },
            next: 'Already here as asked: nothing was changed.' } });
        }

        // ── The mail as the record (rule 9): ids and a sentence, never a body ──
        const gmailIds = [...new Set(a.evidence.gmailMessageIds)];
        const what = isPerson ? (a.role === 'assistant' ? `as ${company!.name}'s assistant` : a.role === 'team' ? `on ${company!.name}'s team` : 'as a person') : `as a ${relation!.replace('-', ' ')}`;
        const noteId = (await tx.one<{ id: string }>(`insert into research.note (entity_id, author_id, kind, body, data) values ($1, $2, 'context', $3, $4::jsonb) returning note_id::text id`,
          [entityId, desk ?? owner.id, `Recorded ${what} from mail by ${autonomous ? 'the mail desk on its own' : owner.name}: ${a.evidence.words}`,
            JSON.stringify({ source: 'mail_desk', type: a.type, companyEntityId: company?.id ?? null, role: a.role ?? null, autonomous, gmailMessageIds: gmailIds,
              words: a.evidence.words, tokenId: ctx.env.tokenId, as_of: new Date().toISOString().slice(0, 10), confidence: autonomous ? 'medium' : 'high',
              last_verified_by: autonomous ? null : owner.id })]))!.id;

        const added: Added = { ownerId: owner.id, tokenId: ctx.env.tokenId, entityId, autonomous, createdEntity, sourceRecord, claimId, noteId, affiliationId,
          relation: relationAnswer, refs: await refCounts(tx, 'identity', 'entity', entityId) };
        await appendAudit({ actorId: owner.id, action: 'outreach.entity_added', subjectType: 'entity', subjectId: entityId, detail: {
          ...added, rule, type: a.type, role: a.role ?? null, companyEntityId: company?.id ?? null, messages: { gmail: gmailIds.length },
        } }, tx);
        return { data: {
          entityId, type: isPerson ? 'person' : 'org', relation: relation ?? null,
          created: { entity: createdEntity, relation: !!relationAnswer, link: !!affiliationId },
          ...(relationAnswer?.previous ? { replacedRelation: relationAnswer.previous.relation } : {}),
          link: company && a.role ? { role: a.role, entityId: company.id, name: company.name } : null,
          ...(elsewhere && !autonomous && claimId ? { unconfirmed: UNCONFIRMED_ELSEWHERE } : {}),
          next: `Recorded ${what}. Undo within ${UNDO_HOURS} hours: DELETE /api/outreach/entities?entityId=${entityId} (outreach_undo_add_entity).`,
        } };
      });
    } catch (e) {
      if (e instanceof Unchanged) return e.answer;
      throw e;
    }
  });
}

// ── DELETE /api/outreach/entities · outreach_undo_add_entity ────────────────────────────

export async function undoAddEntity(ctx: DeskContext, raw: Record<string, unknown>) {
  const { entityId } = raw as z.infer<typeof undoAddEntityInput>;
  requireMutationProfile();
  const owner = ctx.env.owner;
  const db = await getDb();
  const row = await db.one<{ audit_id: string; at: Date | string; detail: Added }>(`select id::text audit_id, at, detail from platform.audit_log
    where action = 'outreach.entity_added' and subject_type = 'entity' and subject_id = $1 order by id desc limit 1`, [entityId]);
  if (!row) throw new OutreachRefused(404, 'Nothing added through the mail desk for that entityId.');
  const add = row.detail, addedAt = new Date(row.at);
  if (add.ownerId !== owner.id) throw new OutreachRefused(409, 'Not undone: it was added through another person\'s token, and only they can undo it.');
  if (await db.one(`select 1 from platform.audit_log where action = 'outreach.entity_undone' and subject_type = 'entity' and subject_id = $1 and id > $2::bigint`, [entityId, row.audit_id])) {
    throw new OutreachRefused(409, 'Not undone: it was undone already.');
  }
  if (Date.now() - addedAt.getTime() > UNDO_HOURS * 3_600_000) {
    throw new OutreachRefused(409, `Not undone: it was added ${addedAt.toISOString()}, more than ${UNDO_HOURS} hours ago. Change it in Capital OS instead.`);
  }
  return db.transaction(async (tx) => {
    const retire = add.createdEntity && changed(add.refs, await refCounts(tx, 'identity', 'entity', entityId)).length === 0;
    await tx.query('delete from research.note where note_id = $1', [add.noteId]);
    if (add.affiliationId) await tx.query('delete from identity.affiliation where affiliation_id = $1', [add.affiliationId]);
    if (add.relation?.set) {
      // Back to what it was, unless someone has set it since.
      const now = await tx.one<{ relation: string }>('select relation from identity.entity_relation where entity_id = $1', [entityId]);
      if (now?.relation === add.relation.set) {
        await tx.query('delete from identity.entity_relation where entity_id = $1', [entityId]);
        const p = add.relation.previous;
        if (p && !retire) await tx.query('insert into identity.entity_relation (entity_id, relation, set_by, set_at, source) values ($1, $2, $3, $4, $5)', [entityId, p.relation, p.setBy, p.setAt, p.source]);
      }
    }
    if (add.claimId && !(await claimReliedOnSince(tx, entityId, row.audit_id))) await tx.query('delete from research.claim where claim_id = $1', [add.claimId]);
    // The alias it attached to a record already here goes too, as undoAddLp's does.
    if (add.sourceRecord && (retire || !add.createdEntity)) {
      await tx.query(`delete from research.note where entity_id = $1 and kind = 'identity_creation' and data->>'source' = 'mail_desk' and data->>'sourceId' = $2`, [entityId, add.sourceRecord]);
      await tx.query(`delete from identity.source_record where source = 'mail_desk' and source_id = $1`, [add.sourceRecord]);
    }
    if (retire) await tx.query('update identity.entity set retired_at = now() where entity_id = $1 and retired_at is null', [entityId]);
    await appendAudit({ actorId: owner.id, action: 'outreach.entity_undone', subjectType: 'entity', subjectId: entityId, detail: {
      entityId, tokenId: ctx.env.tokenId, autonomous: ctx.env.autonomous, entityRetired: retire, noteId: add.noteId, affiliationId: add.affiliationId,
    } }, tx);
    return { data: { entityId, undone: true, removed: { entity: retire, link: !!add.affiliationId, relation: !!add.relation?.set },
      next: retire ? 'Undone: what it recorded is gone and the record it created is retired.' : 'Undone: what it recorded is gone. The record is kept.' } };
  });
}
