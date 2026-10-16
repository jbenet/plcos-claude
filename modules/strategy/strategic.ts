import type { Queryable } from '@/lib/db';
import { STRATEGIC_FIELDS, type StrategicInputs, type StrategicText } from './strategic-rules';

/**
 * Strategic value (issue 0120): the stored inputs the rules in strategic-rules.ts read, for many LPs
 * at once. Read-only. Research text comes back only when it mentions one of the words asked for,
 * so a list of thousands reads a few rows each, not every fact on file.
 */

const day = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null);

export interface StrategicRecords {
  /** Research text per canonical entity: facts, the public profile. */
  texts: Map<string, StrategicText[]>;
  /** The prospect row each LP was sourced from, per `${canonical entity}:${vehicle}`. */
  prospects: Map<string, NonNullable<StrategicInputs['prospect']>>;
}

/**
 * `words`: every vehicle's field terms and SPV company names in view. A loose SQL filter (any of
 * them anywhere in the text); the rules then match at word starts, per vehicle.
 */
export async function strategicRecords(q: Queryable, entityIds: string[], words: string[]): Promise<StrategicRecords> {
  const ids = [...new Set(entityIds)];
  const texts = new Map<string, StrategicText[]>();
  const prospects = new Map<string, NonNullable<StrategicInputs['prospect']>>();
  if (!ids.length) return { texts, prospects };
  const loose = [...new Set(words.map((w) => w.replace(/\*$/, '').trim().toLowerCase()).filter(Boolean))]
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  // Aliases first (identity.alias_pairs): index probes, not canonical_entity_id() on every claim and note (78 ms -> 16 ms
  // on the real copy's Neurotech, 16 Oct 2026; a person's own change rebuilds this before their next page).
  // The loose filter runs here, not in SQL: Postgres's ~* over 42 alternatives took 400 ms on the claims and 225 ms on
  // the profiles of every vehicle's LPs, where reading them all and testing them here takes 20 ms (16 Oct 2026; the same
  // rows kept, 2,105 claims and 1,474 profiles).
  const near = loose ? new RegExp(loose, 'i') : null;
  const [claimRows, profileRows, sourced] = await Promise.all([
    loose ? q.query<{ id: string; field: string; value: string; as_of: Date | string | null }>(
      `select o.canonical_id::text id, substr(c.field, 8) field, c.value, c.as_of
         from identity.alias_pairs($1::uuid[]) o join research.claim c on c.entity_id = o.entity_id
        where c.superseded_by is null and c.field = any($2::text[])
        order by c.as_of desc nulls last`, [ids, STRATEGIC_FIELDS.map((f) => `public.${f}`)]) : Promise.resolve([]),
    loose ? q.query<{ id: string; text: string; at: Date | string | null; searched: string | null }>(
      `select o.canonical_id::text id, n.profile_text searched,
              concat_ws('. ', n.data->'profile'->>'summary',
                (select string_agg(x, ', ') from jsonb_array_elements_text(case when jsonb_typeof(n.data->'profile'->'interests') = 'array'
                  then n.data->'profile'->'interests' else '[]'::jsonb end) x)) text,
              coalesce((n.data->'researched'->>'at')::date, n.created_at::date) at
         from identity.alias_pairs($1::uuid[]) o join research.note n on n.entity_id = o.entity_id
        where n.kind = 'public_profile'
        order by n.created_at desc`, [ids]) : Promise.resolve([]),
    q.query<{ id: string; vehicle: string; strategic: boolean | null; reason: string | null; status: string | null }>(
      `select distinct on (o.canonical_id, n.data->>'vehicleId')
              o.canonical_id::text id, n.data->>'vehicleId' vehicle,
              case when jsonb_typeof(n.data->'strategic') = 'boolean' then (n.data->>'strategic')::boolean end strategic,
              n.data->>'reason' reason, n.data->>'status' status
         from identity.alias_pairs($1::uuid[]) o join research.note n on n.entity_id = o.entity_id
        where n.data->>'source' = 'prospects' and n.data ? 'vehicleId'
        order by o.canonical_id, n.data->>'vehicleId', n.created_at desc`, [ids]),
  ]);
  const claims = near ? claimRows.filter((c) => c.value !== null && near.test(c.value)) : [];
  const profiles = near ? profileRows.filter((p) => p.searched !== null && near.test(p.searched)) : [];
  const add = (id: string, t: StrategicText) => texts.set(id, [...(texts.get(id) ?? []), t]);
  for (const c of claims) add(c.id, { field: c.field, value: c.value, asOf: day(c.as_of) });
  for (const p of profiles) if (p.text.trim()) add(p.id, { field: 'profile', value: p.text, asOf: day(p.at) });
  for (const s of sourced) {
    if (s.strategic === null || !s.reason?.trim()) continue;
    prospects.set(`${s.id}:${s.vehicle}`, { strategic: s.strategic, reason: s.reason.trim(), researched: s.status === 'sourcing' || s.status === 'passed' });
  }
  return { texts, prospects };
}
