-- A commit restamps only its own changed entities (performance pass, 8 Oct 2026).
--
-- route_entity_changed marked each changed entity with txid_current(), and apply_revision_bump then
-- restamped `where revision = txid_current()` at commit. But a committed stamp is the route revision,
-- greatest(revision + 1, txid), which is often some transaction's id; when a later transaction got that
-- id, its commit matched and restamped other entities' committed rows too, and locked them. Two such
-- commits could deadlock (seen in the identity-resolution property on Postgres). Committed revisions
-- are positive, so a transaction now marks its own rows with -txid_current(), which no committed row
-- carries and no reader (`revision > since`) ever sees.

-- 016's body; only the mark changes.
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
      insert into network.route_changed_entity values (e, -txid_current())
      on conflict (entity_id) do update set revision = excluded.revision
        where route_changed_entity.revision <> excluded.revision;
    end if;
  end loop;
  perform network.bump_at_commit('route');
  -- A source-roster change can affect every target, including previously empty ones.
  if (TG_TABLE_NAME = 'source_record' and (
      row_data->>'source' = 'app_user' or (TG_OP = 'UPDATE' and to_jsonb(OLD)->>'source' = 'app_user')
      or ((row_data->>'source' = 'w3_person' or (TG_OP = 'UPDATE' and to_jsonb(OLD)->>'source' = 'w3_person'))
        and exists (select 1 from identity.entity where entity_id = any(ids) and entity_type = 'org' and display_name = 'PL'))
    )) or (TG_TABLE_NAME = 'entity'
      and ((row_data->>'entity_type' = 'org' and row_data->>'display_name' = 'PL')
        or (TG_OP = 'UPDATE' and to_jsonb(OLD)->>'entity_type' = 'org' and to_jsonb(OLD)->>'display_name' = 'PL'))
      and exists (select 1 from identity.source_record where entity_id = any(ids) and source = 'w3_person')) then
    perform network.bump_at_commit('route_epoch');
  end if;
  return null;
end;
$$;

-- 017's body; only the restamp's match changes.
create or replace function network.apply_revision_bump() returns trigger language plpgsql as $$
declare r bigint;
begin
  if NEW.target = 'read' then
    update network.read_revision set revision = greatest(revision + 1, txid_current()),
        foreground = greatest(revision + 1, txid_current()) where singleton;
  elsif NEW.target = 'read_bg' then
    update network.read_revision set revision = greatest(revision + 1, txid_current()) where singleton;
  elsif NEW.target = 'edge' then
    update network.edge_revision set revision = greatest(revision + 1, txid_current()) where singleton;
  else
    update network.route_revision set revision = greatest(revision + 1, txid_current()),
        epoch = case when NEW.target = 'route' then epoch else greatest(epoch + 1, txid_current()) end
      where singleton returning revision into r;
    update network.route_changed_entity set revision = r where revision = -txid_current();
  end if;
  delete from network.revision_bump where txid = NEW.txid and target = NEW.target;
  return null;
end;
$$;
