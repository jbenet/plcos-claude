import type { Queryable } from '@/lib/db';

export interface ResolvedIdentity {
  id: string; root: string; name: string; type: string; created: string; retired: boolean;
}

/** Bulk identity reads must not join the recursive entity_resolution view. Resolve
 * each redirect once, retaining its aliases and excluding broken/cyclic chains just
 * as that view does. Read afresh after a caller changes redirects in its transaction. */
export async function resolvedIdentities(tx: Queryable): Promise<ResolvedIdentity[]> {
  const entities = await tx.query<Omit<ResolvedIdentity, 'root'> & { parent: string | null }>(`
    select entity_id::text id,merged_into::text parent,display_name name,
      entity_type::text type,created_at::text created,retired_at is not null retired
    from identity.entity order by entity_id`);
  const byId = new Map(entities.map(e => [e.id, e]));
  const roots = new Map<string, string | null>();
  for (const entity of entities) {
    if (roots.has(entity.id)) continue;
    const path: string[] = [], seen = new Set<string>();
    let id = entity.id, root: string | null = null;
    while (true) {
      if (roots.has(id)) { root = roots.get(id)!; break; }
      if (seen.has(id)) break;
      const next = byId.get(id);
      if (!next) break;
      path.push(id); seen.add(id);
      if (next.parent === null) { root = id; break; }
      id = next.parent;
    }
    for (const member of path) roots.set(member, root);
  }
  return entities.flatMap(({ parent: _parent, ...e }) => {
    const root = roots.get(e.id);
    return root ? [{ ...e, root }] : [];
  });
}
