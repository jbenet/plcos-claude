-- Preserve every source FK. Canonical projection is reversible without moving facts.
create function identity.canonical_entity_id(id uuid) returns uuid language sql stable as $$
  with recursive chain as (
    select entity_id, merged_into, array[entity_id] seen from identity.entity where entity_id = id
    union all
    select e.entity_id, e.merged_into, c.seen || e.entity_id
      from chain c join identity.entity e on e.entity_id = c.merged_into
      where not e.entity_id = any(c.seen)
  ) select entity_id from chain where merged_into is null limit 1
$$;
create view identity.entity_resolution as
  with recursive roots as (
    select entity_id, entity_id canonical_id, array[entity_id] seen from identity.entity where merged_into is null
    union all
    select e.entity_id, r.canonical_id, r.seen || e.entity_id
    from roots r join identity.entity e on e.merged_into = r.entity_id where not e.entity_id = any(r.seen)
  ) select entity_id, canonical_id from roots;
create index entity_merge_idx on identity.entity(merged_into) where merged_into is not null;
alter table identity.match_assertion
  add column merged_entity uuid references identity.entity,
  add column canonical_entity uuid references identity.entity,
  add column rule text,
  add column signals jsonb,
  add column undone_at timestamptz,
  add column undo_reason text;
create table identity.possible_match (
  edge_id uuid primary key default gen_random_uuid(),
  left_entity uuid not null references identity.entity,
  right_entity uuid not null references identity.entity,
  confidence numeric not null check(confidence >= 0 and confidence <= 1),
  signals jsonb not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(left_entity,right_entity), check(left_entity < right_entity)
);

-- Source-ordered keyset pages must not repeatedly scan the warehouse roster.
create index source_record_entity_source_idx on identity.source_record(entity_id,source,source_id);
