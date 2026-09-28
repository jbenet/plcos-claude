import { getDb, type Db } from '@/lib/db';
import { can, type Principal } from '@/lib/authz';
import type { PassedBy, PursuitStatus } from '@/modules/strategy';
import { projectPipeline, type PipelineIdentity, type NoteIdentity } from './projection';

/** Restricted users receive an explicit data projection, before any unrestricted page loader runs. */
export async function scopedReadData(user: Principal, query?: Db) {
  const db = query ?? await getDb();
  const rows = await db.query<PipelineIdentity>(`select p.pursuit_id::text id, e.entity_id::text "entityId",
    e.display_name name, p.vehicle_id::text "vehicleId", v.name vehicle, u.name owner, p.status::text status,
    exists(select 1 from coordination.restriction r where identity.canonical_entity_id(r.entity_id)=e.entity_id
      and (r.expires_at is null or r.expires_at>=current_date)) restricted
    from strategy.active_pursuit p join identity.entity e on e.entity_id=identity.canonical_entity_id(p.entity_id)
    join platform.vehicle v on v.id=p.vehicle_id join platform.app_user u on u.id=p.owner_id
    order by e.display_name,v.sort_order`);
  const preliminary = projectPipeline(user, rows);
  const ids = [...new Set(preliminary.rows.map(row => row.entityId))];
  const notes = ids.length ? await db.query<NoteIdentity>(`select n.note_id::text id,
    identity.canonical_entity_id(n.entity_id)::text "entityId", u.name author, n.created_at::text at
    from research.note n left join platform.app_user u on u.id=n.author_id
    where identity.canonical_entity_id(n.entity_id)=any($1::uuid[]) order by n.created_at desc`, [ids]) : [];
  // Metadata only: never select the note payload/body, even for health-flagged notes.
  const affinityNotes = ids.length ? await db.query<NoteIdentity>(`select distinct 'affinity:' || n.source_id id,
    identity.canonical_entity_id(r.entity_id)::text "entityId",
    nullif(trim(concat_ws(' ',n.payload#>>'{creator,firstName}',n.payload#>>'{creator,lastName}')),'') author,
    coalesce(n.payload->>'createdAt',n.fetched_at::text) at
    from identity.source_record r join sources.raw_record n on n.source='affinity' and n.kind='note'
    where r.source='affinity' and identity.canonical_entity_id(r.entity_id)=any($1::uuid[])
      and ((r.source_id like 'person:%' and exists(select 1 from jsonb_array_elements(coalesce(n.payload#>'{personsPreview,data}','[]'::jsonb)) x where x->>'id'=split_part(r.source_id,':',2)))
        or (r.source_id like 'company:%' and exists(select 1 from jsonb_array_elements(coalesce(n.payload#>'{companiesPreview,data}','[]'::jsonb)) x where x->>'id'=split_part(r.source_id,':',2))))
      and not exists(select 1 from sources.raw_record newer where newer.source=n.source and newer.kind=n.kind
        and newer.source_id=n.source_id and (newer.fetched_at,newer.id)>(n.fetched_at,n.id))`, [ids]) : [];
  const allowedVehicles = [...new Set(preliminary.rows.filter(row => can(user, 'read', { vehicle: row.vehicleId, fieldClass: 'R1' })).map(row => row.vehicleId))];
  const details = allowedVehicles.length ? await db.query<{ id: string; amount: string | null; track: string | null; restriction: string | null }>(`select p.pursuit_id::text id,
    x.amount::text amount,x.track::text track,
    (select string_agg(r.instruction, E'\\n') from coordination.restriction r
      where identity.canonical_entity_id(r.entity_id)=identity.canonical_entity_id(p.entity_id)
        and (r.expires_at is null or r.expires_at>=current_date)) restriction
    from strategy.active_pursuit p left join pipeline.exposure x
      on identity.canonical_entity_id(x.entity_id)=identity.canonical_entity_id(p.entity_id) and x.vehicle_id=p.vehicle_id and x.closed_at is null
    where p.vehicle_id=any($1::uuid[])`, [allowedVehicles]) : [];
  const bodies = allowedVehicles.length ? await db.query<{ id: string; body: string }>(`select n.note_id::text id,n.body from research.note n
    where identity.canonical_entity_id(n.entity_id)=any($1::uuid[]) and n.data->>'vehicleId'=any($2::text[])
      and n.kind='context' and n.data->>'source' is distinct from 'dakota'`, [ids, allowedVehicles]) : [];
  const statuses = allowedVehicles.length ? await db.query<{ id: string; status: PursuitStatus; passedBy: PassedBy | null; reason: string | null; nextStep: string | null; nextStepOn: string | null }>(`select pursuit_id::text id,status::text status,passed_by::text "passedBy",
    case when source='dakota' then null else status_reason end reason,
    next_step "nextStep",next_step_on::text "nextStepOn" from strategy.active_pursuit where vehicle_id=any($1::uuid[])`, [allowedVehicles]) : [];
  return { ...projectPipeline(user, rows, [...notes, ...affinityNotes]), details, bodies, statuses, asOf: new Date().toISOString() };
}
