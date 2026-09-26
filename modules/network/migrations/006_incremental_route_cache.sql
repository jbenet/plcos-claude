-- Keep 005 immutable. Page-input revisions and route topology revisions are distinct:
-- changing an ask must never evict an expensive graph search.
create table network.route_revision (
  singleton boolean primary key default true check (singleton),
  revision bigint not null,
  epoch bigint not null
);
insert into network.route_revision values (true, txid_current(), txid_current());
create table network.route_changed_entity (
  entity_id uuid primary key,
  revision bigint not null
);
create index route_changed_revision on network.route_changed_entity(revision);
alter table network.route_cache add column input_revision bigint not null default 0;
-- Drop derived oversized v1 payloads, never source records. TRUNCATE also reclaims storage.
truncate network.route_cache;

create function network.route_entity_changed() returns trigger language plpgsql as $$
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
  if TG_TABLE_NAME = 'source_record' and
    (row_data->>'source' in ('app_user', 'w3_person') or
     (TG_OP = 'UPDATE' and to_jsonb(OLD)->>'source' in ('app_user', 'w3_person'))) then
    update network.route_revision set epoch = txid_current() where singleton;
  end if;
  return null;
end;
$$;
create function network.route_all_changed() returns trigger language plpgsql as $$
begin
  update network.route_revision set revision = txid_current(), epoch = txid_current()
    where singleton;
  return null;
end;
$$;
do $$ declare relation text; begin
  foreach relation in array array['network.edge','identity.entity','identity.source_record','identity.affiliation'] loop
    execute format('create trigger route_entity_changed after insert or update or delete on %s for each row execute function network.route_entity_changed()', relation);
    execute format('create trigger route_all_changed after truncate on %s for each statement execute function network.route_all_changed()', relation);
  end loop;
end $$;
create trigger route_roster_changed after insert or update or delete or truncate on platform.app_user
  for each statement execute function network.route_all_changed();

create table network.route_warmup (
  singleton boolean primary key default true check (singleton),
  status text not null check (status in ('idle','running','complete','superseded','failed')),
  total integer not null default 0,
  completed integer not null default 0,
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  elapsed_ms integer not null default 0,
  error text
);
insert into network.route_warmup (singleton, status) values (true, 'idle');
