import type { Queryable } from '@/lib/db';
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

/** Every public profile of these LPs (aliases included, under their canonical id), the latest first. */
export async function publicProfiles(q: Queryable, entityIds: string[]): Promise<PublicProfile[]> {
  if (!entityIds.length) return [];
  const keys = await q.query<{ entity: string; id: string; v: string; at: Date }>(
    `select a.canonical_id::text entity, n.note_id::text id, ${VERSION('n')} v, n.created_at at
       from identity.alias_pairs($1::uuid[]) a join research.note n on n.entity_id = a.entity_id
      where n.kind = 'public_profile' order by n.created_at desc, n.note_id`, [[...new Set(entityIds)]]);
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
