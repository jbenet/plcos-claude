import type { Queryable } from '@/lib/db';

/**
 * Wide values (a profile's jsonb, a suggestion's data and body) kept per row version, so a rebuild after a person's
 * write reads them only for rows that are new or changed since (performance pass, 17 Oct 2026). The caller reads its
 * rows' keys and versions (`xmin`, which moves on any update, with the creation time beside it) and asks here for the
 * values; only the missing ones are loaded. Kept per database, since tests open many whose invented rows may share
 * ids. The values are shared between callers: never change one.
 */
type Cache = Map<string, { v: string; value: unknown }>;
const g = globalThis as typeof globalThis & { __plcosByVersion?: WeakMap<Queryable, Map<string, Cache>> };
const byDb = (g.__plcosByVersion ??= new WeakMap());
/** GUESS: well above the rows on file (3,255 profiles, 9,010 suggestions); past it a kind's cache starts again. */
const MOST = 50_000;

export async function byVersion<T>(q: Queryable, kind: string, keys: ReadonlyArray<{ id: string; v: string }>,
  load: (ids: string[]) => Promise<Array<{ id: string; v: string; value: T }>>): Promise<Map<string, T>> {
  let kinds = byDb.get(q);
  if (!kinds) byDb.set(q, (kinds = new Map()));
  let cache = kinds.get(kind) as Cache | undefined;
  if (!cache) kinds.set(kind, (cache = new Map()));
  const missing = [...new Set(keys.filter((k) => cache.get(k.id)?.v !== k.v).map((k) => k.id))];
  if (missing.length) {
    if (cache.size + missing.length > MOST) cache.clear();
    for (const r of await load(missing)) cache.set(r.id, { v: r.v, value: r.value });
  }
  // A row changed between the two reads keeps the value read second; one deleted between them is left out.
  const out = new Map<string, T>();
  for (const k of keys) { const hit = cache.get(k.id); if (hit) out.set(k.id, hit.value as T); }
  return out;
}

/** A row's version, as `byVersion` compares it: SQL for a table aliased `alias`. */
export const VERSION = (alias: string) => `${alias}.xmin::text || ':' || ${alias}.created_at::text`;
