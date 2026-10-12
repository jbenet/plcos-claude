-- The stored route searches keep their own revision (performance pass, 12 Oct 2026).
--
-- Every vehicle's plan reads its LPs' stored route searches (strategyRouteSummaries): the jsonb of
-- every route of ~5,000 targets, about 120 ms of each rebuild. Any write moved the read revision and
-- so threw that read away, though only a route computation changes network.route_cache. `routes`
-- moves on those writes alone, at commit, like every revision here (016).
alter table network.read_revision add column routes bigint not null default 0;

alter table network.revision_bump drop constraint revision_bump_target_check;
alter table network.revision_bump add constraint revision_bump_target_check
  check (target in ('read', 'read_bg', 'edge', 'route', 'route_epoch', 'route_all', 'touch', 'routes'));

-- 020's body, with the routes branch added.
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

create function network.invalidate_routes() returns trigger language plpgsql as $$
begin
  perform network.bump_at_commit('routes');
  return null;
end;
$$;

create trigger network_routes_changed after insert or update or delete or truncate on network.route_cache
  for each statement execute function network.invalidate_routes();
