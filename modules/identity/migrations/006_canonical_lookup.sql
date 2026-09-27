-- Hot page joins resolve thousands of identities. The old recursive SQL function
-- planned a recursive CTE even for an unmerged root. One indexed lookup is enough
-- in that common case; aliases still walk to the root in this statement's snapshot.
create or replace function identity.canonical_entity_id(id uuid) returns uuid
language plpgsql stable strict as $$
declare
  current_id uuid := id;
  parent_id uuid;
  seen uuid[] := array[]::uuid[];
begin
  loop
    if current_id = any(seen) then return null; end if;
    select e.merged_into into parent_id from identity.entity e where e.entity_id = current_id;
    if not found then return null; end if;
    if parent_id is null then return current_id; end if;
    seen := seen || current_id;
    current_id := parent_id;
  end loop;
end;
$$;
