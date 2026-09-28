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
  const [claims, profiles, sourced] = await Promise.all([
    loose ? q.query<{ id: string; field: string; value: string; as_of: Date | string | null }>(
      `select identity.canonical_entity_id(c.entity_id)::text id, substr(c.field, 8) field, c.value, c.as_of
         from research.claim c
        where c.superseded_by is null and c.field = any($2::text[]) and c.value ~* $3
          and identity.canonical_entity_id(c.entity_id) = any($1::uuid[])
        order by c.as_of desc nulls last`, [ids, STRATEGIC_FIELDS.map((f) => `public.${f}`), loose]) : Promise.resolve([]),
    loose ? q.query<{ id: string; text: string; at: Date | string | null }>(
      `select identity.canonical_entity_id(n.entity_id)::text id,
              concat_ws('. ', n.data->'profile'->>'summary',
                (select string_agg(x, ', ') from jsonb_array_elements_text(case when jsonb_typeof(n.data->'profile'->'interests') = 'array'
                  then n.data->'profile'->'interests' else '[]'::jsonb end) x)) text,
              coalesce((n.data->'researched'->>'at')::date, n.created_at::date) at
         from research.note n
        where n.kind = 'public_profile' and (n.data->'profile')::text ~* $2
          and identity.canonical_entity_id(n.entity_id) = any($1::uuid[])
        order by n.created_at desc`, [ids, loose]) : Promise.resolve([]),
    q.query<{ id: string; vehicle: string; strategic: boolean | null; reason: string | null; status: string | null }>(
      `select distinct on (identity.canonical_entity_id(n.entity_id), n.data->>'vehicleId')
              identity.canonical_entity_id(n.entity_id)::text id, n.data->>'vehicleId' vehicle,
              case when jsonb_typeof(n.data->'strategic') = 'boolean' then (n.data->>'strategic')::boolean end strategic,
              n.data->>'reason' reason, n.data->>'status' status
         from research.note n
        where n.data->>'source' = 'prospects' and n.data ? 'vehicleId'
          and identity.canonical_entity_id(n.entity_id) = any($1::uuid[])
        order by identity.canonical_entity_id(n.entity_id), n.data->>'vehicleId', n.created_at desc`, [ids]),
  ]);
  const add = (id: string, t: StrategicText) => texts.set(id, [...(texts.get(id) ?? []), t]);
  for (const c of claims) add(c.id, { field: c.field, value: c.value, asOf: day(c.as_of) });
  for (const p of profiles) if (p.text.trim()) add(p.id, { field: 'profile', value: p.text, asOf: day(p.at) });
  for (const s of sourced) {
    if (s.strategic === null || !s.reason?.trim()) continue;
    prospects.set(`${s.id}:${s.vehicle}`, { strategic: s.strategic, reason: s.reason.trim(), researched: s.status === 'sourcing' || s.status === 'passed' });
  }
  return { texts, prospects };
}
