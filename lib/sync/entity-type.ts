import { config } from '@/config/deployment';
import { isLiveServer } from '@/config/ports';
import { getDb, type Db } from '@/lib/db';
import { isEntityKey } from '@/lib/enrich/connection-check';
import { lookupEntityType, pipelinePeopleNamedLikeOrgs } from '@/lib/enrich/entity-types';
import { recordEntityTypeCorrection, reverseEntityTypeCorrection } from '@/modules/identity/entity-type';
import { namePattern, relationshipRoles } from '@/modules/identity/roles';
import { auditSync, type SyncCaller } from './auth';
import type { PushAnswer } from './push';

/**
 * GET|POST /api/sync/entity-type: a record's local type by an Admin's token (sync:admin; issue 0063), the same
 * correction Developer → Enrichment applies, so the Mac can fix a record that came from Affinity typed wrong.
 *
 *   GET                                                    → 200 { items: TypeCandidate[] } pipeline people named like
 *                                                            an organisation we hold, with any person evidence found
 *   GET ?id=<pipeline or entity id, or its first 8+ chars>  → 200 { records: TypeLookup[] } that record's entity, type,
 *                                                            pipelines, sources, corrections and same-name organisations
 *   GET ?find=<name>                                       → 200 { entities: FoundEntity[] } every current record whose
 *                                                            name holds those words in order, any type (issue 0138)
 *   GET ?review=<name>                                     → 200 { groups: ReviewGroup[] } the duplicate groups Merge
 *                                                            duplicate identities would hold back for review, by name:
 *                                                            the W13 group id, members, types, roles and reasons
 *   GET ?tickets=open                                      → 200 { tickets: TicketCount[] } undecided approval tickets
 *                                                            counted by kind, requester and state; no subjects or names
 *   POST { operation: 'correct', entityId, type, reason, requestKey } → 200 { correctionId } (null: already that type)
 *   POST { operation: 'reverse', correctionId, reason }    → 200 { reversed }
 *
 * The correction is local and reversible (modules/identity/entity-type.ts): the source record is kept, and a later
 * Affinity sync cannot overwrite it. Names are returned to the token's holder and never written to the audit row.
 */
const refusedHere = () => config.data.profile === 'real' && (Boolean(config.data.copyTakenAt) || !isLiveServer());

export async function readEntityTypes(caller: SyncCaller, db?: Db, request?: Request): Promise<PushAnswer> {
  const params = request ? new URL(request.url).searchParams : null;
  const find = params?.get('find') ?? null, review = params?.get('review') ?? null;
  if (params?.get('tickets') === 'open') {
    const tickets = await openTicketCounts(db ?? await getDb());
    await auditSync(caller, 'identity', 'ok', { op: 'tickets', count: tickets.length });
    return { status: 200, body: { ok: true, tickets } };
  }
  if (find !== null || review !== null) {
    const q = (find ?? review ?? '').trim().slice(0, 120);
    if (q.replace(/[^\p{L}\p{N}]/gu, '').length < 3) {
      await auditSync(caller, 'identity', 'invalid', { op: find !== null ? 'find' : 'review', reason: 'name' });
      return { status: 400, body: { ok: false, error: 'Give at least three letters or digits of the name.' } };
    }
    const handle = db ?? await getDb();
    if (find !== null) {
      const entities = await findEntitiesByName(handle, q);
      await auditSync(caller, 'identity', 'ok', { op: 'find', count: entities.length });
      return { status: 200, body: { ok: true, entities } };
    }
    try {
      const groups = await identityReviewByName(handle, q);
      await auditSync(caller, 'identity', 'ok', { op: 'review', count: groups.length });
      return { status: 200, body: { ok: true, groups } };
    } catch (error) {
      // Say what failed rather than a bare 500 (issue 0138); the message is the code's or Postgres's, never a record.
      if (lockBusy(error)) {
        await auditSync(caller, 'identity', 'refused', { op: 'review', reason: 'busy' });
        return { status: 409, body: { ok: false, error: BUSY } };
      }
      const code = (error as { code?: string }).code;
      await auditSync(caller, 'identity', 'error', { op: 'review', reason: 'failed' });
      return { status: 500, body: { ok: false, error: `Review failed: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown error'}${code ? ` (SQLSTATE ${code})` : ''}` } };
    }
  }
  const id = params?.get('id') ?? null;
  if (id !== null) {
    try {
      const records = await (db ?? await getDb()).transaction(tx => lookupEntityType(tx, id));
      await auditSync(caller, 'identity', 'ok', { op: 'show', count: records.length });
      return { status: 200, body: { ok: true, records } };
    } catch (error) {
      await auditSync(caller, 'identity', 'invalid', { op: 'show', reason: 'id' });
      return { status: 400, body: { ok: false, error: error instanceof Error ? error.message : 'Lookup failed.' } };
    }
  }
  const items = await (db ?? await getDb()).transaction(tx => pipelinePeopleNamedLikeOrgs(tx));
  await auditSync(caller, 'identity', 'ok', { op: 'list', count: items.length });
  return { status: 200, body: { ok: true, items } };
}

export async function writeEntityType(caller: SyncCaller, request: Request, db?: Db): Promise<PushAnswer> {
  const fail = async (status: number, reason: string, error: string) => {
    await auditSync(caller, 'identity', 'invalid', { op: 'write', reason });
    return { status, body: { ok: false, error } };
  };
  if (refusedHere()) return fail(403, 'copy', 'Correct entity types on the live server.');
  const input = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!input || typeof input.reason !== 'string' || !input.reason.trim()) return fail(400, 'reason', 'A reason is required.');
  const reason = input.reason.trim().slice(0, 500);
  const handle = db ?? await getDb();
  try {
    if (input.operation === 'reverse') {
      if (!isEntityKey(input.correctionId)) return fail(400, 'input', 'Give the correctionId to reverse.');
      const reversed = await reverseEntityTypeCorrection(handle, input.correctionId as string, caller.user.id, reason);
      await auditSync(caller, 'identity', 'ok', { op: 'reverse', correctionId: input.correctionId, reversed });
      return { status: 200, body: { ok: true, reversed } };
    }
    if (input.operation !== 'correct' || !isEntityKey(input.entityId) || !['person', 'org'].includes(input.type as string)
      || typeof input.requestKey !== 'string' || !input.requestKey.trim()) {
      return fail(400, 'input', 'Give operation "correct" with entityId, type (person or org), reason and a stable requestKey, or operation "reverse" with correctionId and reason.');
    }
    const requestKey = (input.requestKey as string).trim();
    const correctionId = await handle.transaction(async (tx) => {
      await tx.exec(`set local lock_timeout = '${LOCK_WAIT}'`);
      return recordEntityTypeCorrection(tx, { entityId: input.entityId as string, type: input.type as 'person' | 'org',
        by: caller.user.id, reason, rule: 'human:entity-type', requestKey });
    });
    await auditSync(caller, 'identity', 'ok', { op: 'correct', entityId: input.entityId, type: input.type, correctionId });
    return { status: 200, body: { ok: true, correctionId } };
  } catch (error) {
    if (lockBusy(error)) return fail(409, 'busy', BUSY);
    return fail(409, 'refused', error instanceof Error ? error.message : 'Entity type correction failed.');
  }
}

/**
 * Merge duplicate identities (and an import) hold the identity tables for their whole run, minutes on the
 * live server. A retype or a review read waiting behind one ran into the 20-second statement timeout and came
 * back as "statement timeout" or a bare 500 (issue 0138). It now stops waiting early and says why.
 */
const LOCK_WAIT = '5s'; // GUESS: long enough for a normal write's lock, short of the 20 s statement timeout.
const BUSY = 'Merge duplicate identities or an import is running and holds the identity records. Nothing was changed; try again when it has finished (cloud-job.sh status).';
const lockBusy = (error: unknown) => ['55P03', '57014'].includes((error as { code?: string } | null)?.code ?? '');

/** One current record found by name (issue 0138): enough to retype or name it in a W13 decision. */
export interface FoundEntity { entityId: string; name: string; type: string; roles: string[]; pursuits: number; sources: string[] }

/** Every current (not merged, not retired) record whose name holds the words in order, at most 200. */
export async function findEntitiesByName(db: Db, q: string): Promise<FoundEntity[]> {
  const rows = await db.query<{ id: string; name: string; type: string; pursuits: number; sources: string[] | null }>(
    `select e.entity_id::text id, e.display_name name, e.entity_type::text type,
            (select count(*)::int from strategy.active_pursuit p where identity.canonical_entity_id(p.entity_id) = e.entity_id) pursuits,
            (select array_agg(distinct s.source order by s.source) from identity.source_record s
              where identity.canonical_entity_id(s.entity_id) = e.entity_id) sources
       from identity.entity e
      where e.merged_into is null and e.retired_at is null and e.display_name ilike $1
      order by e.display_name, e.entity_id limit 200`, [namePattern(q)]);
  const roles = new Map((await relationshipRoles(rows.map((r) => r.id))).map((r) => [r.entityId, r.roles as string[]]));
  return rows.map((r) => ({ entityId: r.id, name: r.name, type: r.type, roles: roles.get(r.id) ?? [], pursuits: r.pursuits, sources: r.sources ?? [] }));
}

/** A group Merge duplicate identities holds back, as W13 names it. */
export interface ReviewGroup {
  group: string; name: string; reason: string;
  members: Array<{ entityId: string; name: string; type: string; roles: string[]; sources: Array<{ source: string; key: string }> }>;
  /** What holds the group apart (issue 0138): each separation or reversed merge between two of its members, and the local type corrections. */
  separations: Array<{ assertionId: string; kind: string; rule: string | null; undone: boolean; by: string | null; at: string; note: string | null; undoReason: string | null }>;
  corrections: Array<{ entityId: string; rule: string; original: string; reversed: boolean }>;
}

/**
 * The groups the duplicates pass would hold back for review whose name holds the words (issue 0138), worked out
 * the way Export the research set does: the pass runs in a transaction that is rolled back, so nothing changes.
 */
export async function identityReviewByName(db: Db, q: string): Promise<ReviewGroup[]> {
  const { mergeImportDuplicatesInTransaction } = await import('@/lib/enrich/import-dupes');
  const { identityReviewGroupId } = await import('@/lib/enrich/identity-decisions');
  const pattern = new RegExp(q.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*'), 'i');
  const rollback = new Error('review preview');
  let ambiguous: Array<{ name: string; entityIds: string[]; reason: string }> = [];
  await db.transaction(async (tx) => {
    await tx.exec(`set local lock_timeout = '${LOCK_WAIT}'`);
    const actor = await tx.one<{ id: string }>(`select id::text from platform.app_user where handle = 'reconciliation'`);
    ambiguous = (await mergeImportDuplicatesInTransaction(tx, actor?.id ?? 'review', [], [], { reviewOnly: true })).ambiguous;
    throw rollback;
  }).catch((e) => { if (e !== rollback) throw e; });
  const hits = ambiguous.filter((g) => pattern.test(g.name)).slice(0, 100);
  const ids = [...new Set(hits.flatMap((g) => g.entityIds))];
  const facts = new Map((await db.query<{ id: string; name: string; type: string }>(
    `select entity_id::text id, display_name name, entity_type::text type from identity.entity where entity_id = any($1::uuid[])`, [ids])).map((r) => [r.id, r]));
  const roles = new Map((await relationshipRoles(ids)).map((r) => [r.entityId, r.roles as string[]]));
  const sources = await db.query<{ root: string; source: string; key: string }>(
    `select identity.canonical_entity_id(entity_id)::text root, source, source_id key from identity.source_record
      where identity.canonical_entity_id(entity_id) = any($1::uuid[]) order by source, source_id`, [ids]);
  const assertions = await db.query<{ id: string; kind: string; rule: string | null; undone: boolean; by: string | null; at: string; note: string | null; undo: string | null; a: string | null; b: string | null }>(
    `select m.assertion_id::text id, m.kind::text kind, m.rule, m.undone_at is not null undone, u.handle by, m.asserted_at::text at, m.note, m.undo_reason undo,
            coalesce(identity.canonical_entity_id(m.merged_entity), identity.canonical_entity_id(l.entity_id))::text a,
            coalesce(identity.canonical_entity_id(m.canonical_entity), identity.canonical_entity_id(r.entity_id))::text b
       from identity.match_assertion m left join platform.app_user u on u.id = m.asserted_by
       left join identity.source_record l on l.source = m.left_source and l.source_id = m.left_source_id
       left join identity.source_record r on r.source = m.right_source and r.source_id = m.right_source_id
      where (m.kind = 'not_same_as' and m.undone_at is null) or (m.kind = 'same_as' and m.undone_at is not null)`);
  const corrections = await db.query<{ id: string; rule: string; original: string; reversed: boolean }>(
    `select identity.canonical_entity_id(entity_id)::text id, rule, original_type::text original, reversed_at is not null reversed
       from identity.entity_type_correction where identity.canonical_entity_id(entity_id) = any($1::uuid[])`, [ids]);
  return hits.map((g) => {
    const inGroup = new Set(g.entityIds);
    return {
      group: identityReviewGroupId(g.entityIds), name: g.name, reason: g.reason,
      members: g.entityIds.map((id) => ({
        entityId: id, name: facts.get(id)?.name ?? '', type: facts.get(id)?.type ?? 'unknown', roles: roles.get(id) ?? [],
        sources: sources.filter((x) => x.root === id).map((x) => ({ source: x.source, key: x.key })),
      })),
      separations: assertions.filter((x) => x.a && x.b && x.a !== x.b && inGroup.has(x.a) && inGroup.has(x.b))
        .map((x) => ({ assertionId: x.id, kind: x.kind, rule: x.rule, undone: x.undone, by: x.by, at: x.at, note: x.note, undoReason: x.undo })),
      corrections: corrections.filter((c) => inGroup.has(c.id)).map((c) => ({ entityId: c.id, rule: c.rule, original: c.original, reversed: c.reversed })),
    };
  });
}

/** Undecided approval tickets, counted (issue 0137): a system actor by its handle, everyone else as "person". */
export interface TicketCount { kind: string; requester: string; state: 'open' | 'expired'; count: number }

export async function openTicketCounts(db: Db): Promise<TicketCount[]> {
  return db.query<TicketCount>(
    `select t.kind::text kind, case when u.active then 'person' else u.handle end requester,
            case when coalesce(t.expires_at < now(), false) then 'expired' else 'open' end state, count(*)::int count
       from governance.approval_ticket t join platform.app_user u on u.id = t.requested_by
      where t.decision is null group by 1, 2, 3 order by 1, 2, 3`);
}
