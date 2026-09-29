import type { Queryable } from '@/lib/db';

/** Compact all-different assertions. Each active row contributes its member and anchor;
 * sharing an anchor is not by itself a constraint unless separationGroup is recorded.
 * Resolve aliases together so every caller protects complete current components.
 */
export async function readSeparationGroups(tx: Queryable): Promise<string[][]> {
  const rows = await tx.query<{ key: string; ids: string[] }>(`with endpoints as (
    select signals->>'separationGroup' key,merged_entity id from identity.match_assertion
      where kind='not_same_as' and undone_at is null and signals->>'separationGroup' is not null
    union
    select signals->>'separationGroup' key,canonical_entity id from identity.match_assertion
      where kind='not_same_as' and undone_at is null and signals->>'separationGroup' is not null
  ) select e.key,array_agg(distinct r.canonical_id::text) ids from endpoints e
    join identity.entity_resolution r on r.entity_id=e.id group by e.key`);
  return rows.map(r => r.ids);
}

export function violatesSeparationGroup(ids: Iterable<string>, groups: string[][]): boolean {
  const selected = new Set(ids);
  return groups.some(group => {
    let found = false;
    for (const id of new Set(group)) if (selected.has(id)) {
      if (found) return true;
      found = true;
    }
    return false;
  });
}
