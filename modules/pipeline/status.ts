import { getDb } from '@/lib/db';
import type { PursuitStatus } from '@/modules/strategy';
import { closeTracksForPairs } from './repo';

export const CLOSE_PAGE_SIZE = 20;

/** Status is a plan; these counts never imply a consent rung or signed money. */
export async function vehicleStatusCounts(vehicleId: string | null) {
  const db = await getDb();
  return db.query<{ vehicle_id: string; status: PursuitStatus; n: number; archived: number }>(
    `select vehicle_id, status::text as status, count(*)::int as n,
            count(*) filter (where closed_at is not null)::int as archived
       from strategy.pursuit where ($1::uuid is null or vehicle_id = $1)
      group by vehicle_id, status`, [vehicleId],
  );
}

/** Paginate LP/vehicle pairs before loading their detail; no query per LP. */
export async function vehicleCloseStatus(vehicleId: string | null, requestedPage: number) {
  const db = await getDb();
  const candidates = `with candidates as (
    select identity.canonical_entity_id(entity_id) as entity_id, vehicle_id
      from strategy.pursuit where status = 'committed' and closed_at is null
        and ($1::uuid is null or vehicle_id = $1)
    union
    select identity.canonical_entity_id(entity_id), vehicle_id from pipeline.exposure
      where closed_at is null and ($1::uuid is null or vehicle_id = $1)
  )`;
  const total = (await db.one<{ n: number }>(`${candidates} select count(*)::int as n from candidates`, [vehicleId]))?.n ?? 0;
  const page = Math.min(Math.max(1, Number.isSafeInteger(requestedPage) ? requestedPage : 1), Math.max(1, Math.ceil(total / CLOSE_PAGE_SIZE)));
  const rows = await db.query<{
    entity_id: string; entity_name: string; vehicle_id: string; vehicle_name: string; vehicle_slug: string;
    pursuit_id: string | null; owner_name: string | null; next_step: string | null;
    next_step_on: Date | string | null; headline: string | null; status_reason: string | null;
    source: string | null; source_as_of: Date | string | null; stage_said: string | null;
  }>(`${candidates}
    select c.*, e.display_name as entity_name, v.name as vehicle_name, v.slug as vehicle_slug,
           p.pursuit_id, coalesce(p.owner_said, u.name) as owner_name, p.next_step, p.next_step_on,
           p.headline, p.status_reason, p.source, p.source_as_of, p.stage_said
      from candidates c join identity.entity e on e.entity_id = c.entity_id
      join platform.vehicle v on v.id = c.vehicle_id
      left join lateral (
        select p.* from strategy.pursuit p
         where identity.canonical_entity_id(p.entity_id) = c.entity_id and p.vehicle_id = c.vehicle_id
         order by (p.closed_at is null) desc, (p.entity_id = c.entity_id) desc, p.opened_at, p.pursuit_id limit 1
      ) p on true
      left join platform.app_user u on u.id = p.owner_id
     order by v.sort_order, e.display_name, c.entity_id
     limit $2 offset $3`, [vehicleId, CLOSE_PAGE_SIZE, (page - 1) * CLOSE_PAGE_SIZE]);
  if (!rows.length) return { total, page, rows: [] };
  const ids = [...new Set(rows.map(r => r.entity_id))];
  const [tracks, questions, notes, conditions] = await Promise.all([
    closeTracksForPairs(rows),
    db.query<{ entity_id: string; vehicle_id: string; question_id: string; question: string; status: string; due_on: Date | string | null }>(
      `select identity.canonical_entity_id(entity_id) as entity_id, vehicle_id, question_id, question, status, due_on
         from meetings.diligence_question where identity.canonical_entity_id(entity_id) = any($1::uuid[])
          and status in ('open', 'blocked') and ($2::uuid is null or vehicle_id = $2)
        order by due_on nulls last, question_id`, [ids, vehicleId]),
    db.query<{ entity_id: string; body: string; created_at: Date | string }>(
      `select distinct on (identity.canonical_entity_id(entity_id)) identity.canonical_entity_id(entity_id) as entity_id, body, created_at
         from research.note where identity.canonical_entity_id(entity_id) = any($1::uuid[]) and kind = 'context'
        order by identity.canonical_entity_id(entity_id), created_at desc, note_id`, [ids]),
    db.query<{ entity_id: string | null; vehicle_id: string; label: string; detail: string | null; due_on: Date | string | null; owner_name: string | null }>(
      `select identity.canonical_entity_id(k.entity_id) as entity_id, c.vehicle_id, k.label, k.detail, k.due_on, u.name as owner_name
         from close.condition k join close.cycle c on c.cycle_id = k.cycle_id
         left join platform.app_user u on u.id = k.owner_id
        where k.status = 'open' and c.vehicle_id = any($2::uuid[])
          and (k.entity_id is null or identity.canonical_entity_id(k.entity_id) = any($1::uuid[]))
        order by k.due_on nulls last, k.condition_id`, [ids, [...new Set(rows.map(r => r.vehicle_id))]]),
  ]);
  return { total, page, rows: rows.map(r => ({ ...r,
    tracks: tracks.filter(t => t.exposure.entityId === r.entity_id && t.exposure.vehicleId === r.vehicle_id),
    questions: questions.filter(q => q.entity_id === r.entity_id && q.vehicle_id === r.vehicle_id),
    note: notes.find(n => n.entity_id === r.entity_id) ?? null,
    conditions: conditions.filter(c => c.vehicle_id === r.vehicle_id && (c.entity_id === null || c.entity_id === r.entity_id)),
  })) };
}
