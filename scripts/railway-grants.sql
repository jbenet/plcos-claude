-- Grants for the cloud database (docs/deploy/railway.md §5), the same as the Mac's cluster
-- (docs/21-postgres.md "Roles"): plcos_app owns everything, plcos_ro reads everything and writes nothing.
--
-- cutover.sh restores with --no-owner --no-acl as plcos_app, so every object is plcos_app's, and then
-- runs this file (--grants scripts/railway-grants.sql) as plcos_app, in one transaction. Re-running it is
-- harmless. It names no database, so it also fits a rehearsal database.
do $$
declare s text;
begin
  execute format('grant connect on database %I to plcos_ro', current_database());
  for s in select nspname from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema' loop
    execute format('grant usage on schema %I to plcos_ro', s);
    execute format('grant select on all tables in schema %I to plcos_ro', s);
    execute format('grant select on all sequences in schema %I to plcos_ro', s);
    -- Future tables in existing schemas. A migration that adds a schema grants plcos_ro usage itself.
    execute format('alter default privileges for role plcos_app in schema %I grant select on tables to plcos_ro', s);
    execute format('alter default privileges for role plcos_app in schema %I grant select on sequences to plcos_ro', s);
  end loop;
end $$;
revoke create on schema public from public;
