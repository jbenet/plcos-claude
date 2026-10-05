-- The email schema (001_drafts) was created without granting the read-only role, so pg_dump as plcos_ro
-- failed and the daily backups stopped on 2 Oct 2026 ("permission denied for schema email"). docs/21: a
-- migration that creates a schema grants plcos_ro usage on it. Guarded: PGlite and demo have no such role.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'plcos_ro') then
    grant usage on schema email to plcos_ro;
    grant select on all tables in schema email to plcos_ro;
    grant select on all sequences in schema email to plcos_ro;
    if exists (select 1 from pg_roles where rolname = 'plcos_app') then
      alter default privileges for role plcos_app in schema email grant select on tables to plcos_ro;
      alter default privileges for role plcos_app in schema email grant select on sequences to plcos_ro;
    end if;
  end if;
end $$;
