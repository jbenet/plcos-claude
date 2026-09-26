-- A renamed PL organization changes the source roster, including for empty caches.
-- Ordinary research identities do not invalidate every target.
create or replace function network.route_entity_changed() returns trigger language plpgsql as $$
declare ids uuid[]; e uuid; row_data jsonb;
begin
  if TG_OP = 'UPDATE' and NEW is not distinct from OLD then return null; end if;
  if current_setting('network.building', true) = 'on' then return null; end if;
  row_data := case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
  if TG_TABLE_NAME = 'edge' then
    ids := array[(row_data->>'from_entity')::uuid, (row_data->>'to_entity')::uuid];
    if TG_OP = 'UPDATE' then ids := ids || array[OLD.from_entity, OLD.to_entity]; end if;
  elsif TG_TABLE_NAME = 'affiliation' then
    ids := array[(row_data->>'person_entity')::uuid, (row_data->>'org_entity')::uuid];
    if TG_OP = 'UPDATE' then ids := ids || array[OLD.person_entity, OLD.org_entity]; end if;
  else
    ids := array[(row_data->>'entity_id')::uuid];
    if TG_OP = 'UPDATE' then ids := ids || array[OLD.entity_id]; end if;
  end if;
  foreach e in array ids loop
    if e is not null then
      insert into network.route_changed_entity values (e, txid_current())
      on conflict (entity_id) do update set revision = excluded.revision
        where route_changed_entity.revision <> excluded.revision;
    end if;
  end loop;
  update network.route_revision set revision = txid_current()
    where singleton and revision <> txid_current();
  -- A source-roster change can affect every target, including previously empty ones.
  if (TG_TABLE_NAME = 'source_record' and (
      row_data->>'source' = 'app_user' or (TG_OP = 'UPDATE' and to_jsonb(OLD)->>'source' = 'app_user')
      or ((row_data->>'source' = 'w3_person' or (TG_OP = 'UPDATE' and to_jsonb(OLD)->>'source' = 'w3_person'))
        and exists (select 1 from identity.entity where entity_id = any(ids) and entity_type = 'org' and display_name = 'PL'))
    )) or (TG_TABLE_NAME = 'entity'
      and ((row_data->>'entity_type' = 'org' and row_data->>'display_name' = 'PL')
        or (TG_OP = 'UPDATE' and to_jsonb(OLD)->>'entity_type' = 'org' and to_jsonb(OLD)->>'display_name' = 'PL'))
      and exists (select 1 from identity.source_record where entity_id = any(ids) and source = 'w3_person')) then
    update network.route_revision set epoch = txid_current() where singleton;
  end if;
  return null;
end;
$$;
