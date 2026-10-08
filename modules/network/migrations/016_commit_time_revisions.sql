-- Revisions move at commit, not at the first write (performance pass, 8 Oct 2026).
--
-- Each revision is one row. Until now a write to any of ~30 tables updated that row at once, so the
-- writing transaction held the row's lock until it committed. An import that writes research notes
-- or identities inside a long transaction therefore made every other write to those tables wait for
-- it: moving an LP to Selected waited for the import, or failed at the 20 s statement limit.
--
-- Now a write only notes "this transaction changes revision X" in network.revision_bump (its own
-- row, keyed by transaction, so writers never wait on each other), and a deferred trigger moves
-- the revision while the transaction commits. Readers see the new revision exactly when they see
-- the data, as before. The new value is the next number in commit order (greatest(old + 1, txid)),
-- and the entities a transaction changed take that same value, so a route cache that read revision
-- R and later asks "what changed after R" sees every later commit, including a long one that
-- started earlier.
create table network.revision_bump (
  txid bigint not null,
  target text not null check (target in ('read', 'edge', 'route', 'route_epoch', 'route_all')),
  primary key (txid, target)
);

create function network.bump_at_commit(what text) returns void language sql as $$
  insert into network.revision_bump values (txid_current(), what) on conflict do nothing;
$$;

create function network.apply_revision_bump() returns trigger language plpgsql as $$
declare r bigint;
begin
  if NEW.target = 'read' then
    update network.read_revision set revision = greatest(revision + 1, txid_current()) where singleton;
  elsif NEW.target = 'edge' then
    update network.edge_revision set revision = greatest(revision + 1, txid_current()) where singleton;
  else
    update network.route_revision set revision = greatest(revision + 1, txid_current()),
        epoch = case when NEW.target = 'route' then epoch else greatest(epoch + 1, txid_current()) end
      where singleton returning revision into r;
    update network.route_changed_entity set revision = r where revision = txid_current();
  end if;
  delete from network.revision_bump where txid = NEW.txid and target = NEW.target;
  return null;
end;
$$;
create constraint trigger revision_bump_at_commit after insert on network.revision_bump
  deferrable initially deferred for each row execute function network.apply_revision_bump();

create or replace function network.invalidate_reads() returns trigger language plpgsql as $$
begin
  perform network.bump_at_commit('read');
  return null;
end;
$$;

create or replace function network.invalidate_edge_summary() returns trigger language plpgsql as $$
begin
  perform network.bump_at_commit('edge');
  return null;
end;
$$;

create or replace function network.route_all_changed() returns trigger language plpgsql as $$
begin
  perform network.bump_at_commit('route_all');
  return null;
end;
$$;

create or replace function network.identity_resolution_changed() returns trigger language plpgsql as $$
begin
  perform network.bump_at_commit('edge');
  perform network.bump_at_commit('route_all');
  perform network.bump_at_commit('read');
  return null;
end;
$$;

-- 008's body, with its two revision updates now made at commit.
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
