import { config } from '@/config/deployment';
import { isLiveServer } from '@/config/ports';
import { getDb, type Db } from '@/lib/db';
import { isEntityKey } from '@/lib/enrich/connection-check';
import { lookupEntityType, pipelinePeopleNamedLikeOrgs } from '@/lib/enrich/entity-types';
import { correctEntityType, reverseEntityTypeCorrection } from '@/modules/identity/entity-type';
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
    const groups = await identityReviewByName(handle, q);
    await auditSync(caller, 'identity', 'ok', { op: 'review', count: groups.length });
    return { status: 200, body: { ok: true, groups } };
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
    const correctionId = await correctEntityType(handle, { entityId: input.entityId as string, type: input.type as 'person' | 'org',
      by: caller.user.id, reason, rule: 'human:entity-type', requestKey: input.requestKey.trim() });
    await auditSync(caller, 'identity', 'ok', { op: 'correct', entityId: input.entityId, type: input.type, correctionId });
    return { status: 200, body: { ok: true, correctionId } };
  } catch (error) {
    return fail(409, 'refused', error instanceof Error ? error.message : 'Entity type correction failed.');
  }
}

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
export interface ReviewGroup { group: string; name: string; reason: string; members: Array<{ entityId: string; name: string; type: string; roles: string[] }> }

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
    const actor = await tx.one<{ id: string }>(`select id::text from platform.app_user where handle = 'reconciliation'`);
    ambiguous = (await mergeImportDuplicatesInTransaction(tx, actor?.id ?? 'review', [], [], { reviewOnly: true })).ambiguous;
    throw rollback;
  }).catch((e) => { if (e !== rollback) throw e; });
  const hits = ambiguous.filter((g) => pattern.test(g.name)).slice(0, 100);
  const ids = [...new Set(hits.flatMap((g) => g.entityIds))];
  const facts = new Map((await db.query<{ id: string; name: string; type: string }>(
    `select entity_id::text id, display_name name, entity_type::text type from identity.entity where entity_id = any($1::uuid[])`, [ids])).map((r) => [r.id, r]));
  const roles = new Map((await relationshipRoles(ids)).map((r) => [r.entityId, r.roles as string[]]));
  return hits.map((g) => ({
    group: identityReviewGroupId(g.entityIds), name: g.name, reason: g.reason,
    members: g.entityIds.map((id) => ({ entityId: id, name: facts.get(id)?.name ?? '', type: facts.get(id)?.type ?? 'unknown', roles: roles.get(id) ?? [] })),
  }));
}
