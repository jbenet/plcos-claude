-- Pages stay fast while an import writes (performance pass, 8 Oct 2026).
--
-- Every write moves network.read_revision, and every page cache keyed by it (the pipeline, the
-- strategy plans…) then rebuilds on the next view. An import commits every few seconds for half an
-- hour or more, so while one ran each page view rebuilt from scratch. Now the revision also records
-- which writes were people's: `foreground` moves only for writes outside an import worker (whose
-- connections set plcos.background), and when an import job ends. A page cache whose foreground is
-- unchanged may answer with its last build and rebuild behind (lib/build-cache.ts); a person's own
-- change still rebuilds before the page answers.
alter table network.read_revision add column foreground bigint not null default 0;
update network.read_revision set foreground = revision;

alter table network.revision_bump drop constraint revision_bump_target_check;
alter table network.revision_bump add constraint revision_bump_target_check
  check (target in ('read', 'read_bg', 'edge', 'route', 'route_epoch', 'route_all'));

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
    update network.route_changed_entity set revision = r where revision = txid_current();
  end if;
  delete from network.revision_bump where txid = NEW.txid and target = NEW.target;
  return null;
end;
$$;

-- An import worker's session sets plcos.background (lib/db/postgres.ts); anything else is a person's.
create or replace function network.read_target() returns text language sql stable as $$
  select case when current_setting('plcos.background', true) = 'on' then 'read_bg' else 'read' end;
$$;

create or replace function network.invalidate_reads() returns trigger language plpgsql as $$
begin
  perform network.bump_at_commit(network.read_target());
  return null;
end;
$$;

create or replace function network.identity_resolution_changed() returns trigger language plpgsql as $$
begin
  perform network.bump_at_commit('edge');
  perform network.bump_at_commit('route_all');
  perform network.bump_at_commit(network.read_target());
  return null;
end;
$$;
