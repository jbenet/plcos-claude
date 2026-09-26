-- These inputs are read live, not part of either expensive structural snapshot.
drop trigger if exists network_reads_changed on coordination.ask;
drop trigger if exists network_reads_changed on coordination.restriction;
drop trigger if exists network_reads_changed on pipeline.exposure;
drop trigger if exists network_reads_changed on network.standing;
create or replace function network.install_read_triggers() returns void language plpgsql as $$
declare relation text;
begin
  foreach relation in array array[
    'network.edge', 'identity.entity', 'identity.source_record', 'identity.affiliation',
    'platform.app_user', 'platform.vehicle', 'platform.source_sync',
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
