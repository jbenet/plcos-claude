-- Ephemeral derived results: the source records and live action guards remain authoritative.
create table network.read_revision (
  singleton boolean primary key default true check (singleton),
  revision bigint not null
);
insert into network.read_revision values (true, txid_current());
create table network.route_cache (
  target_id uuid not null references identity.entity(entity_id) on delete cascade,
  vehicle_kind text not null,
  revision text not null,
  computed_at timestamptz not null,
  search jsonb not null,
  primary key (target_id, vehicle_kind)
);
create function network.invalidate_reads() returns trigger language plpgsql as $$
begin
  update network.read_revision set revision = txid_current()
   where singleton and revision <> txid_current();
  return null;
end;
$$;
-- The migration runner calls this after ALL modules migrate: some dependencies are
-- later in manifest order on a fresh database. Repeated installation is a no-op.
create function network.install_read_triggers() returns void language plpgsql as $$
declare relation text;
begin
  foreach relation in array array[
    'network.edge', 'network.standing', 'identity.entity', 'identity.source_record',
    'identity.affiliation', 'platform.app_user', 'platform.vehicle', 'platform.source_sync',
    'coordination.ask', 'coordination.restriction', 'pipeline.exposure',
    'strategy.pursuit', 'strategy.ladder_event', 'strategy.suggestion',
    'fit.assessment', 'fit.gate', 'fit.dimension', 'fit.value_item', 'fit.perception',
    'fit.engagement', 'fit.link', 'fit.firm_profile', 'meetings.meeting',
    'research.note', 'research.source_doc'
  ] loop
    if to_regclass(relation) is not null and not exists (
      select 1 from pg_trigger where tgrelid = to_regclass(relation) and tgname = 'network_reads_changed'
    ) then
      execute format('create trigger network_reads_changed after insert or update or delete or truncate on %s for each statement execute function network.invalidate_reads()', relation);
    end if;
  end loop;
end;
$$;
select network.install_read_triggers();
