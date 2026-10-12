-- Touchpoints keep their own revision (performance pass, 12 Oct 2026).
--
-- Every LP list reads each vehicle's touchpoints (touchesOn in modules/strategy/vehicle.ts): every
-- meeting, call and email of every LP and their firm, about 1.4 s of a 2 s list rebuild at 3,000 LPs.
-- It was keyed by network.read_revision, which any write to ~30 tables moves, so moving one LP to
-- Selected threw it away and the list behind the move, and the next page opened, read them all again.
--
-- `touch` moves only on writes that can change what that read returns: the touchpoints themselves,
-- the people and firms they are joined through (entities, merges, affiliations, source records, a
-- pursuit's contacts), which pursuits a vehicle has, and the names it prints (vehicles, users). A
-- status, a next step or a score leaves it where it was. It moves at commit, like every revision here
-- (016), on an import worker's writes and a person's alike; the cache tells them apart by the shared
-- foreground revision (017).
alter table network.read_revision add column touch bigint not null default 0;

alter table network.revision_bump drop constraint revision_bump_target_check;
alter table network.revision_bump add constraint revision_bump_target_check
  check (target in ('read', 'read_bg', 'edge', 'route', 'route_epoch', 'route_all', 'touch'));

-- 018's body, with the touch branch added.
create or replace function network.apply_revision_bump() returns trigger language plpgsql as $$
declare r bigint;
begin
  if NEW.target = 'read' then
    update network.read_revision set revision = greatest(revision + 1, txid_current()),
        foreground = greatest(revision + 1, txid_current()) where singleton;
  elsif NEW.target = 'read_bg' then
    update network.read_revision set revision = greatest(revision + 1, txid_current()) where singleton;
  elsif NEW.target = 'touch' then
    update network.read_revision set touch = greatest(touch + 1, txid_current()) where singleton;
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

create function network.invalidate_touches() returns trigger language plpgsql as $$
begin
  perform network.bump_at_commit('touch');
  return null;
end;
$$;

-- Network migrates before strategy and meetings, so on a new database those tables do not exist yet:
-- like the read triggers (005, 007), these are installed where the table exists, now and after every
-- migration run (lib/db/migrate.ts calls install_read_triggers, which now installs these too).
create function network.install_touch_triggers() returns void language plpgsql as $$
declare relation text;
begin
  foreach relation in array array[
    'meetings.meeting', 'identity.entity', 'identity.affiliation', 'identity.source_record',
    'strategy.pursuit_contact', 'platform.vehicle', 'platform.app_user'
  ] loop
    if to_regclass(relation) is not null and not exists (
      select 1 from pg_trigger where tgrelid = to_regclass(relation) and tgname = 'network_touches_changed'
    ) then
      execute format('create trigger network_touches_changed after insert or update or delete or truncate on %s for each statement execute function network.invalidate_touches()', relation);
    end if;
  end loop;
  -- Which pursuits a vehicle has (strategy.active_pursuit joined to its owner), not their status or plan.
  if to_regclass('strategy.pursuit') is not null and not exists (
    select 1 from pg_trigger where tgrelid = to_regclass('strategy.pursuit') and tgname = 'network_touches_changed'
  ) then
    create trigger network_touches_changed after insert or delete or truncate on strategy.pursuit
      for each statement execute function network.invalidate_touches();
    create trigger network_touches_membership after update of entity_id, vehicle_id, merged_into, owner_id on strategy.pursuit
      for each statement execute function network.invalidate_touches();
  end if;
end;
$$;

-- 007's body, then the touch triggers.
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
  perform network.install_touch_triggers();
end;
$$;

select network.install_touch_triggers();
