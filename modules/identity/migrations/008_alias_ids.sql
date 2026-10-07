-- Every alias of a set of canonical ids, walked down `merged_into` by entity_merge_idx.
-- `identity.canonical_entity_id(col) = any($ids)` is a plpgsql call per row, so it scans the
-- whole table; `col = any(identity.alias_ids($ids))` asks the column's own index for the same
-- rows. Only roots (merged_into is null) start the walk, as only roots are ever canonical, so
-- x is in alias_ids(ids) exactly when canonical_entity_id(x) is in ids.
create or replace function identity.alias_pairs(ids uuid[]) returns table (canonical_id uuid, entity_id uuid)
language sql stable as $$
  with recursive a(canonical_id, entity_id) as (
    select e.entity_id, e.entity_id from identity.entity e where e.entity_id = any(ids) and e.merged_into is null
    union
    select a.canonical_id, e.entity_id from a join identity.entity e on e.merged_into = a.entity_id
  )
  select a.canonical_id, a.entity_id from a
$$;

create or replace function identity.alias_ids(ids uuid[]) returns uuid[]
language sql stable as $$
  select coalesce(array_agg(p.entity_id), '{}'::uuid[]) from identity.alias_pairs(ids) p
$$;
