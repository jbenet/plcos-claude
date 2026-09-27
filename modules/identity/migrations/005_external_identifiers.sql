-- Match identifiers belong to the identity module; provenance is source-owned.
create table identity.external_identifier (
  entity_id uuid not null references identity.entity,
  kind text not null check(kind in ('domain','linkedin','crd','cik')),
  value text not null,
  source text not null,
  as_of timestamptz not null,
  confidence text not null,
  last_verified_by uuid not null references platform.app_user(id),
  primary key(entity_id,kind,value,source)
);
create index external_identifier_lookup on identity.external_identifier(kind,value);
