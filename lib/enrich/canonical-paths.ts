import type { Queryable } from '@/lib/db';
import type { Path } from './connect';

/** Read projection only: stored paths keep their original IDs so identity undo restores them. */
export async function canonicalPaths(tx: Queryable, paths: Path[]): Promise<Path[]> {
  const keys = [...new Set(paths.flatMap(p => [p.lp, p.other.key, p.lpPerson?.key, p.other.person?.key, p.warehouse?.match.lpKey])
    .filter((key): key is string => typeof key === 'string'))];
  if (!keys.length) return paths;
  const rows = await tx.query<{ key: string; id: string }>(`select entity_id::text key,canonical_id::text id
    from identity.entity_resolution where entity_id::text=any($1::text[])`, [keys]);
  const roots = new Map(rows.map(r => [r.key, r.id]));
  const root = (key: string) => roots.get(key) ?? key;
  return paths.map(p => ({ ...p, lp: root(p.lp),
    ...(p.lpPerson ? { lpPerson: { ...p.lpPerson, key: root(p.lpPerson.key) } } : {}),
    other: { ...p.other, ...(p.other.key ? { key: root(p.other.key) } : {}),
      ...(p.other.person ? { person: { ...p.other.person, key: root(p.other.person.key) } } : {}) },
    ...(p.warehouse ? { warehouse: { ...p.warehouse, match: { ...p.warehouse.match, lpKey: root(p.warehouse.match.lpKey) } } } : {}),
  }));
}
