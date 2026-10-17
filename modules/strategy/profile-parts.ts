import type { Db, Queryable } from '@/lib/db';
import { readRevision } from '@/lib/build-cache';
import { byVersion, VERSION } from './by-version';

/**
 * The parts of LPs' public profiles that the plans and the strategic marks read, kept per note version (performance
 * pass, 17 Oct 2026). Reading them meant reading each note's whole `data` (8 MB for every vehicle's LPs on the real
 * copy): 58 ms for the marks and 70 ms for Neurotech's plan, on every rebuild after a person's write, though a
 * profile changes only when it is researched again. Now the notes' keys are read (12 ms) and only a note that is new or
 * changed since has its parts read (by-version.ts).
 */
export interface ProfileParts {
  /** As the plans read it: `researched` and the capacity only. */
  data: { researched?: { at?: string; by?: string; corrected?: Array<{ at: string }> }; profile?: { capacity?: { band: string; basis: string } } };
  /** As the strategic marks read it: the summary, then the interests. */
  text: string;
  /** When it was researched, else when it was written (a date). */
  on: Date | string | null;
}
export interface PublicProfile { entityId: string; noteId: string; at: Date; parts: ProfileParts }

type Key = { entity: string; id: string; v: string; at: Date };
const readKeys = (q: Queryable, ids: string[]) => q.query<Key>(
  `select a.canonical_id::text entity, n.note_id::text id, ${VERSION('n')} v, n.created_at at
     from identity.alias_pairs($1::uuid[]) a join research.note n on n.entity_id = a.entity_id
    where n.kind = 'public_profile' order by n.created_at desc, n.note_id`, [ids]);

/** GUESS: a rebuild asks for a few sets of LPs; past this many at one revision, the oldest is dropped. */
const SHARED_SETS = 8;
const shared = new WeakMap<Db, { revision: string; keys: Map<string, Promise<Key[]>> }>();
/**
 * The notes' keys, read once per read revision for the same LPs (performance pass, 17 Oct 2026): a vehicle's plan and its
 * pipeline list's strategic marks both asked them of the same LPs on every rebuild after a person's write (900 rows
 * each for Neurotech). Both tables read here move the read revision, and a read joins only one at the revision it
 * saw, as lib/build-cache does. Inside a transaction (no `transaction` of its own) it always reads, so its own
 * uncommitted writes are seen.
 */
async function profileKeys(q: Queryable, ids: string[]): Promise<Key[]> {
  if (!('transaction' in q)) return readKeys(q, ids);
  const db = q as Db;
  const revision = await readRevision(db);
  let state = shared.get(db);
  if (!state || state.revision !== revision) shared.set(db, (state = { revision, keys: new Map() }));
  const key = [...ids].sort().join(',');
  let keys = state.keys.get(key);
  if (!keys) {
    const mine = state, read = readKeys(q, ids);
    keys = read;
    mine.keys.set(key, read);
    if (mine.keys.size > SHARED_SETS) mine.keys.delete(mine.keys.keys().next().value!);
    read.catch(() => { if (mine.keys.get(key) === read) mine.keys.delete(key); });
  }
  return keys;
}

/** Every public profile of these LPs (aliases included, under their canonical id), the latest first. */
export async function publicProfiles(q: Queryable, entityIds: string[]): Promise<PublicProfile[]> {
  if (!entityIds.length) return [];
  const keys = await profileKeys(q, [...new Set(entityIds)]);
  const parts = await byVersion<ProfileParts>(q, 'public_profile', keys, async (ids) =>
    (await q.query<{ id: string; v: string; data: ProfileParts['data']; text: string; on: Date | string | null }>(
      `select n.note_id::text id, ${VERSION('n')} v,
              jsonb_build_object('researched', n.data->'researched', 'profile', jsonb_build_object('capacity', n.data->'profile'->'capacity')) data,
              concat_ws('. ', n.data->'profile'->>'summary',
                (select string_agg(x, ', ') from jsonb_array_elements_text(case when jsonb_typeof(n.data->'profile'->'interests') = 'array'
                  then n.data->'profile'->'interests' else '[]'::jsonb end) x)) text,
              coalesce((n.data->'researched'->>'at')::date, n.created_at::date) "on"
         from research.note n where n.note_id = any($1::uuid[])`, [ids]))
      .map((r) => ({ id: r.id, v: r.v, value: { data: r.data, text: r.text, on: r.on } })));
  return keys.flatMap((k) => { const p = parts.get(k.id); return p ? [{ entityId: k.entity, noteId: k.id, at: k.at, parts: p }] : []; });
}
