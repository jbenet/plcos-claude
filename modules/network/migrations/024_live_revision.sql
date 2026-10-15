-- The money, restrictions and claims behind the cached plans move a revision of their own (15 Oct 2026).
--
-- A vehicle's plan, the pipeline list, LP stats and conversion are cached per read revision (lib/build-cache.ts),
-- but four tables they read never moved it: exposures and their commitment events, restrictions and research
-- claims. 007 took exposures and restrictions off the read triggers on purpose, so that a new ask or commitment
-- does not rebuild the routes' structural snapshots, and research.claim was never on them. So a new hard
-- commitment, a do-not-contact restriction or a corrected claim showed on those pages only after some other write.
--
-- `live` moves on writes to those tables alone, at commit, like every revision here (016), and a person's write also
-- moves the foreground (017), so the page they open next is rebuilt first. Only the caches that read these tables
-- key on it (liveRevisions); the routes and every other cache are unchanged.
alter table network.read_revision add column live bigint not null default 0;

alter table network.revision_bump drop constraint revision_bump_target_check;
alter table network.revision_bump add constraint revision_bump_target_check
  check (target in ('read', 'read_bg', 'edge', 'route', 'route_epoch', 'route_all', 'touch', 'routes', 'live', 'live_bg'));

-- 021's body, with the live branches added.
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
  elsif NEW.target = 'routes' then
    update network.read_revision set routes = greatest(routes + 1, txid_current()) where singleton;
  elsif NEW.target = 'live' then
    update network.read_revision set live = greatest(live + 1, txid_current()),
        foreground = greatest(foreground + 1, txid_current()) where singleton;
  elsif NEW.target = 'live_bg' then
    update network.read_revision set live = greatest(live + 1, txid_current()) where singleton;
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

create function network.invalidate_live() returns trigger language plpgsql as $$
begin
  perform network.bump_at_commit(case when current_setting('plcos.background', true) = 'on' then 'live_bg' else 'live' end);
  return null;
end;
$$;

-- Network migrates before pipeline, coordination and research, so on a new database those tables do not exist yet:
-- installed where the table exists, now and after every migration run (install_read_triggers calls this).
create function network.install_live_triggers() returns void language plpgsql as $$
declare relation text;
begin
  foreach relation in array array[
    'pipeline.exposure', 'pipeline.commitment_event', 'coordination.restriction', 'research.claim'
  ] loop
    if to_regclass(relation) is not null and not exists (
      select 1 from pg_trigger where tgrelid = to_regclass(relation) and tgname = 'network_live_changed'
    ) then
      execute format('create trigger network_live_changed after insert or update or delete or truncate on %s for each statement execute function network.invalidate_live()', relation);
    end if;
  end loop;
end;
$$;

-- 020's body, then the live triggers.
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
  perform network.install_live_triggers();
end;
$$;

select network.install_live_triggers();
