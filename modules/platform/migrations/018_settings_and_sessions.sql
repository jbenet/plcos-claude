-- Settings kept in the app, and Google sign-in sessions (docs/deploy/railway.md §3, Juan, 4 Oct 2026).
--
-- platform.setting holds what an admin enters in /setup or Settings → Connections: the public address,
-- the Google OAuth client, connector keys, tokens. A secret row's value is AES-256-GCM ciphertext under a
-- key derived from PLCOS_SECRET, which never enters the database; a plain row's is the value itself. The
-- registry in lib/settings/registry.ts says which keys exist; an unknown key is refused before it gets here.
create table platform.setting (
  key         text primary key check (key ~ '^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$'),
  value       text not null check (length(value) between 1 and 8000),
  secret      boolean not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references platform.app_user(id)
);

-- A Google session is a signed cookie naming the user and this number. Raising it signs that person out
-- everywhere at once, with no session table.
alter table platform.app_user add column session_epoch integer not null default 0;

-- Deactivating a person raises their epoch too, so the cookies they held do not come back to life if they
-- are made active again later. Every path that deactivates someone gets it, not only the app's own.
create function platform.retire_sessions_on_deactivate() returns trigger
language plpgsql as $$
begin
  if old.active and not new.active then
    new.session_epoch := old.session_epoch + 1;
  end if;
  return new;
end;
$$;

create trigger app_user_retire_sessions
before update of active on platform.app_user
for each row execute function platform.retire_sessions_on_deactivate();

-- Secrets that belong to one person (their mailguard key): each AES-256-GCM under a subkey of PLCOS_SECRET
-- for this purpose, bound to the person and the purpose, so a row moved to someone else does not decrypt.
-- Only the person reads or replaces their own; an admin can neither (lib/settings/person-secrets.ts).
create table platform.person_secret (
  user_id     uuid not null references platform.app_user(id),
  purpose     text not null check (purpose ~ '^[a-z][a-z0-9.-]{1,40}$'),
  value       text not null check (length(value) between 1 and 8000),
  updated_at  timestamptz not null default now(),
  primary key (user_id, purpose)
);
