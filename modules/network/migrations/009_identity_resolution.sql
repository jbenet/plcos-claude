-- A redirect changes adjacency, source membership, target keys and live guard projections.
create function network.identity_resolution_changed() returns trigger language plpgsql as $$
begin
  update network.edge_revision set revision = txid_current() where singleton;
  update network.route_revision set revision = txid_current(), epoch = txid_current() where singleton;
  update network.read_revision set revision = txid_current() where singleton;
  return null;
end;
$$;
create trigger identity_redirect_changed after update of merged_into on identity.entity
  for each row when (OLD.merged_into is distinct from NEW.merged_into)
  execute function network.identity_resolution_changed();
create trigger identity_possible_changed after insert or update or delete on identity.possible_match
  for each row execute function network.identity_resolution_changed();

create trigger identity_possible_truncated after truncate on identity.possible_match
  for each statement execute function network.identity_resolution_changed();
