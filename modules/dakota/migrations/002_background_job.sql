-- A single local-server job. Effects and its next cursor commit in the same transaction.
-- Inputs pin complete-replica hashes; no source rows are copied outside the database.
create table dakota.translation_job (
  singleton boolean primary key default true check(singleton),
  id uuid not null default gen_random_uuid(),
  actor uuid not null references platform.app_user(id),
  status text not null check(status in ('queued','running','failed','completed')),
  started_at timestamptz not null default now(),
  last_batch_at timestamptz,
  finished_at timestamptz,
  state jsonb,
  error text
);

-- Invalidate the worker's in-memory matching index when any of its inputs changes.
-- Rebuilding uses short reads outside the import transaction; the revision is checked
-- again under the writer locks before using it. Own committed batches keep the cache.
create table dakota.identity_revision (
  singleton boolean primary key default true check(singleton),
  revision bigint not null
);
insert into dakota.identity_revision values(true,txid_current());
create function dakota.invalidate_identity_index() returns trigger language plpgsql as $$
begin
  update dakota.identity_revision set revision=txid_current() where singleton;
  return null;
end;
$$;
do $$ declare relation text; begin
  foreach relation in array array['identity.entity','identity.source_record','identity.external_identifier',
    'identity.match_assertion','research.claim','research.note'] loop
    execute format('create trigger dakota_identity_changed after insert or update or delete or truncate on %s for each statement execute function dakota.invalidate_identity_index()',relation);
  end loop;
end; $$;
