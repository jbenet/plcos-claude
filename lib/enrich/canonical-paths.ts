import type { Queryable } from '@/lib/db';
import type { Path } from './connect';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read projection only: stored paths keep their original IDs so identity undo restores them. */
export async function canonicalPaths(tx: Queryable, paths: Path[]): Promise<Path[]> {
  const keys = [...new Set(paths.flatMap(p => [p.lp, p.viaContact?.key, p.other.key, p.lpPerson?.key, p.other.person?.key, p.warehouse?.match.lpKey])
    .filter((key): key is string => typeof key === 'string'))];
  // Only ids can resolve. Each is walked on its own (entity_merge_idx); the entity_resolution view
  // walked every entity in the database for each call (performance pass, 8 Oct 2026: ~0.4 s per LP page).
  const ids = keys.filter(key => UUID.test(key));
  if (!ids.length) return paths;
  const rows = await tx.query<{ key: string; id: string }>(`select x.id::text key, c.id::text id
    from unnest($1::uuid[]) x(id), identity.canonical_entity_id(x.id) c(id) where c.id is not null`, [ids]);
  const roots = new Map(rows.map(r => [r.key, r.id]));
  const root = (key: string) => roots.get(key) ?? key;
  return paths.map(p => ({ ...p, lp: root(p.lp),
    ...(p.viaContact ? { viaContact: { ...p.viaContact, key: root(p.viaContact.key) } } : {}),
    ...(p.lpPerson ? { lpPerson: { ...p.lpPerson, key: root(p.lpPerson.key) } } : {}),
    other: { ...p.other, ...(p.other.key ? { key: root(p.other.key) } : {}),
      ...(p.other.person ? { person: { ...p.other.person, key: root(p.other.person.key) } } : {}) },
    ...(p.warehouse ? { warehouse: { ...p.warehouse, match: { ...p.warehouse.match, lpKey: root(p.warehouse.match.lpKey) } } } : {}),
  }));
}
