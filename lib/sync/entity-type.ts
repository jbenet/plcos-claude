import { config } from '@/config/deployment';
import { isLiveServer } from '@/config/ports';
import { getDb, type Db } from '@/lib/db';
import { isEntityKey } from '@/lib/enrich/connection-check';
import { lookupEntityType, pipelinePeopleNamedLikeOrgs } from '@/lib/enrich/entity-types';
import { correctEntityType, reverseEntityTypeCorrection } from '@/modules/identity/entity-type';
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
 *   POST { operation: 'correct', entityId, type, reason, requestKey } → 200 { correctionId } (null: already that type)
 *   POST { operation: 'reverse', correctionId, reason }    → 200 { reversed }
 *
 * The correction is local and reversible (modules/identity/entity-type.ts): the source record is kept, and a later
 * Affinity sync cannot overwrite it. Names are returned to the token's holder and never written to the audit row.
 */
const refusedHere = () => config.data.profile === 'real' && (Boolean(config.data.copyTakenAt) || !isLiveServer());

export async function readEntityTypes(caller: SyncCaller, db?: Db, request?: Request): Promise<PushAnswer> {
  const id = request ? new URL(request.url).searchParams.get('id') : null;
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
