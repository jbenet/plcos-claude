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
       from strategy.active_pursuit where ($1::uuid is null or vehicle_id = $1)
      group by vehicle_id, status`, [vehicleId],
  );
}

/** Paginate LP/vehicle pairs before loading their detail; no query per LP. */
export async function vehicleCloseStatus(vehicleId: string | null, requestedPage: number) {
  const db = await getDb();
  const candidates = `with candidates as (
    select identity.canonical_entity_id(entity_id) as entity_id, vehicle_id
      from strategy.active_pursuit where status = 'committed' and closed_at is null
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
  }>(`${candidates},
    -- The page first, then each row's pursuit through its aliases: the pursuit lookup used to run
    -- for every candidate, a canonical_entity_id() call per pursuit each time (performance pass,
    -- 8 Oct 2026: 2.7 s for the vehicle status page on an invented copy at the live scale).
    shown as (
      select c.entity_id, c.vehicle_id, e.display_name as entity_name, v.name as vehicle_name, v.slug as vehicle_slug, v.sort_order
        from candidates c join identity.entity e on e.entity_id = c.entity_id
        join platform.vehicle v on v.id = c.vehicle_id
       order by v.sort_order, e.display_name, c.entity_id
       limit $2 offset $3
    )
    select c.entity_id, c.vehicle_id, c.entity_name, c.vehicle_name, c.vehicle_slug,
           p.pursuit_id, coalesce(p.owner_said, u.name) as owner_name, p.next_step, p.next_step_on,
           p.headline, p.status_reason, p.source, p.source_as_of, p.stage_said
      from shown c
      left join lateral (
        select p.* from identity.alias_pairs(array[c.entity_id]) a
          join strategy.active_pursuit p on p.entity_id = a.entity_id
         where p.vehicle_id = c.vehicle_id
         order by (p.closed_at is null) desc, (p.entity_id = c.entity_id) desc, p.opened_at, p.pursuit_id limit 1
      ) p on true
      left join platform.app_user u on u.id = p.owner_id
     order by c.sort_order, c.entity_name, c.entity_id`, [vehicleId, CLOSE_PAGE_SIZE, (page - 1) * CLOSE_PAGE_SIZE]);
  if (!rows.length) return { total, page, rows: [] };
  const ids = [...new Set(rows.map(r => r.entity_id))];
  const [tracks, questions, notes, conditions] = await Promise.all([
    closeTracksForPairs(rows),
    db.query<{ entity_id: string; vehicle_id: string; question_id: string; question: string; status: string; due_on: Date | string | null }>(
      `select a.canonical_id as entity_id, q.vehicle_id, q.question_id, q.question, q.status, q.due_on
         from identity.alias_pairs($1::uuid[]) a join meetings.diligence_question q on q.entity_id = a.entity_id
        where q.status in ('open', 'blocked') and ($2::uuid is null or q.vehicle_id = $2)
        order by q.due_on nulls last, q.question_id`, [ids, vehicleId]),
    db.query<{ entity_id: string; body: string; created_at: Date | string }>(
      `select distinct on (a.canonical_id) a.canonical_id as entity_id, n.body, n.created_at
         from identity.alias_pairs($1::uuid[]) a join research.note n on n.entity_id = a.entity_id
        where n.kind = 'context'
        order by a.canonical_id, n.created_at desc, n.note_id`, [ids]),
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
