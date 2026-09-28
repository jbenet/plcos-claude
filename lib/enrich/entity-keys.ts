import type { Queryable } from '@/lib/db';
import { isEntityKey } from './connection-check';

/** Shared importer/export identity rules. Omit keys to export all unambiguous research aliases. */
export async function importEntityKeys(tx: Queryable, keys?: string[]): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  const uuids = [...new Set((keys ?? []).filter(isEntityKey))];
  const entities = uuids.length ? await tx.query<{ key: string; id: string }>(
    `select entity_id::text key, identity.canonical_entity_id(entity_id)::text id
       from identity.entity where entity_id = any($1::uuid[])`, [uuids]) : [];
  const canonical = new Map(entities.map(e => [e.key, e.id]));
  // Unknown UUIDs retain the existing not-in-system / no-pursuit handling.
  for (const key of uuids) resolved.set(key, canonical.get(key.toLowerCase()) ?? key.toLowerCase());
  const aliases = await tx.query<{ key: string; id: string }>(
    `select distinct source_id key, identity.canonical_entity_id(entity_id)::text id
       from identity.source_record where ($1::text[] is null or source_id = any($1::text[]))
         and (source = 'prospect_key' or (source = 'warehouse' and source_id like 'member:%'))`,
    [keys ? [...new Set(keys.filter(k => !isEntityKey(k)))] : null]);
  const candidates = new Map<string, Set<string>>();
  for (const row of aliases) candidates.set(row.key, (candidates.get(row.key) ?? new Set()).add(row.id));
  // Never pick between conflicting namespaces by row order.
  for (const [key, ids] of candidates) if (ids.size === 1) resolved.set(key, [...ids][0]!);
  return resolved;
}
