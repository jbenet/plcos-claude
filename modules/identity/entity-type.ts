import type { Db, Queryable } from '@/lib/db';

export interface TypeCorrection {
  entityId: string; type: 'person' | 'org'; by: string; reason: string; rule: string;
  requestKey: string; evidence?: unknown;
}
/** Caller owns a transaction. Same lock order as identity merge; never moves source facts. */
export async function recordEntityTypeCorrection(tx: Queryable, input: TypeCorrection): Promise<string | null> {
  if (![input.by, input.reason, input.rule, input.requestKey].every(s => s.trim())) throw new Error('Actor, reason, rule and request key are required');
  if (!['person', 'org'].includes(input.type)) throw new Error('Type must be person or org');
  await tx.exec('lock table identity.entity in share row exclusive mode');
  const retry = await tx.one<{ correction_id: string; entity_id: string; corrected_type: string }>(
    'select correction_id::text,entity_id::text,corrected_type::text from identity.entity_type_correction where request_key=$1', [input.requestKey]);
  if (retry) {
    if (retry.entity_id !== input.entityId || retry.corrected_type !== input.type) throw new Error('Request key already used for another correction');
    return retry.correction_id;
  }
  const entity = await tx.one<{ type: string; merged_into: string | null }>(
    'select entity_type::text type,merged_into::text from identity.entity where entity_id=$1 and retired_at is null for update', [input.entityId]);
  if (!entity || entity.merged_into) throw new Error('Correct the active canonical entity');
  if (entity.type === input.type) return null;
  const active = await tx.one('select correction_id from identity.entity_type_correction where entity_id=$1 and reversed_at is null', [input.entityId]);
  if (active) throw new Error('Reverse the current correction before replacing it');
  const row = await tx.one<{ id: string }>(`insert into identity.entity_type_correction
    (entity_id,original_type,corrected_type,recorded_by,reason,rule,evidence,request_key)
    values($1,$2::identity.entity_type,$3::identity.entity_type,$4,$5,$6,$7::jsonb,$8) returning correction_id::text id`,
    [input.entityId, entity.type, input.type, input.by, input.reason, input.rule, JSON.stringify(input.evidence ?? {}), input.requestKey]);
  await tx.query('update identity.entity set entity_type=$2::identity.entity_type where entity_id=$1', [input.entityId, input.type]);
  return row!.id;
}

export const correctEntityType = (db: Db, input: TypeCorrection) => db.transaction(tx => recordEntityTypeCorrection(tx, input));

/** Reversal is itself audited and idempotent. Undo later redirects first; never delete a node. */
export async function reverseEntityTypeCorrection(db: Db, correctionId: string, by: string, reason: string): Promise<boolean> {
  if (!by.trim() || !reason.trim()) throw new Error('Actor and reversal reason are required');
  return db.transaction(async tx => {
    await tx.exec('lock table identity.entity in share row exclusive mode');
    const row = await tx.one<{ entity_id: string; original_type: string; reversed_at: unknown }>(
      'select entity_id::text,original_type::text,reversed_at from identity.entity_type_correction where correction_id=$1 for update', [correctionId]);
    if (!row) throw new Error('Correction not found');
    if (row.reversed_at) return false;
    const redirects = await tx.one(`select entity_id from identity.entity where entity_id=$1 and
      (merged_into is not null or exists(select 1 from identity.entity e where e.merged_into=$1))`, [row.entity_id]);
    if (redirects) throw new Error('Undo identity merges involving this entity before reversing its type');
    await tx.query(`update identity.entity_type_correction set reversed_at=now(),reversed_by=$2,reversal_reason=$3 where correction_id=$1`, [correctionId, by, reason]);
    await tx.query('update identity.entity set entity_type=$2::identity.entity_type where entity_id=$1', [row.entity_id, row.original_type]);
    return true;
  });
}
