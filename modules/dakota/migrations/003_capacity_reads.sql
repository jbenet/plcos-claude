-- Resolve only the accounts and employer records belonging to the requested LPs.
create index account_entity_idx on dakota.account(entity_id);
create index contact_entity_idx on dakota.contact(entity_id);

-- Capacity is an input to the pipeline's revision-keyed projection. A vendor-only
-- update must invalidate it even when no identity, pursuit or research row changes.
create trigger network_reads_changed after insert or update or delete or truncate
  on dakota.account for each statement execute function network.invalidate_reads();
create trigger network_reads_changed after insert or update or delete or truncate
  on dakota.contact for each statement execute function network.invalidate_reads();
