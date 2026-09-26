-- Aggregate coverage is cached per database and edge revision, never for a timed TTL.
-- A build, review, import or deletion invalidates it, including writes outside buildNetwork.
-- One revision change per transaction keeps a large build's per-edge inserts inexpensive.
create table network.edge_revision (
  singleton boolean primary key default true check (singleton),
  revision bigint not null
);
insert into network.edge_revision values (true, txid_current());

create function network.invalidate_edge_summary() returns trigger language plpgsql as $$
begin
  update network.edge_revision set revision = txid_current()
   where singleton and revision <> txid_current();
  return null;
end;
$$;
create trigger edge_summary_changed after insert or update or delete or truncate on network.edge
  for each statement execute function network.invalidate_edge_summary();
