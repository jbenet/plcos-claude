-- Repair the old entity-only importer. Move undecided proposals only: a human's
-- decision and the next step it wrote remain historical facts, never silently rewritten.
with destination as (
  select s.suggestion_id, min(p.pursuit_id::text)::uuid as pursuit_id
  from strategy.suggestion s
  join strategy.pursuit old on old.pursuit_id = s.pursuit_id
  join platform.vehicle v on lower(trim(s.data #>> '{ask,vehicle}')) in (lower(v.name), lower(v.slug))
  join strategy.pursuit p on p.vehicle_id = v.id
    and identity.canonical_entity_id(p.entity_id) = identity.canonical_entity_id(old.entity_id)
    and p.closed_at is null
  where s.status = 'proposed' and p.vehicle_id <> old.vehicle_id
    and not exists (select 1 from strategy.suggestion duplicate
      where duplicate.pursuit_id = p.pursuit_id and duplicate.file_hash = s.file_hash)
  group by s.suggestion_id having count(*) = 1
)
update strategy.suggestion s set pursuit_id = d.pursuit_id
from destination d where s.suggestion_id = d.suggestion_id;
-- No pursuit in the named vehicle is not permission to create one, nor to offer
-- a wrong-vehicle action. Keep the proposal and its inputs for diagnosis.
update strategy.suggestion s set status = 'withdrawn',
  decision_note = 'Vehicle mapping repair: no unique open pursuit in the strategy’s named vehicle. Re-import after resolving scope.'
from strategy.pursuit p, platform.vehicle v
where s.pursuit_id = p.pursuit_id and p.vehicle_id = v.id and s.status = 'proposed'
  and nullif(trim(s.data #>> '{ask,vehicle}'), '') is not null
  and lower(trim(s.data #>> '{ask,vehicle}')) not in (lower(v.name), lower(v.slug));
