-- Ordinary application writes can append history, never rewrite or erase it.
-- Statement triggers also refuse empty-table operations and TRUNCATE. Works on
-- PGlite and Postgres, including the single-owner setup used by the local app.
create function platform.refuse_audit_rewrite() returns trigger
language plpgsql as $$
begin
  raise exception 'platform.audit_log is append-only' using errcode = '42501';
end;
$$;

create trigger audit_log_append_only
before update or delete or truncate on platform.audit_log
for each statement execute function platform.refuse_audit_rewrite();

revoke update, delete, truncate on platform.audit_log from public;
do $$
begin
  execute format('revoke update, delete, truncate on platform.audit_log from %I', current_user);
  -- The live Postgres app role; absent on a fresh PGlite/demo database.
  if exists (select 1 from pg_roles where rolname = 'plcos_app') then
    revoke update, delete, truncate on platform.audit_log from plcos_app;
  end if;
end;
$$;

-- The table owner can still deliberately disable triggers or grant privileges.
-- A separate migration owner is required to protect against arbitrary owner DDL.
