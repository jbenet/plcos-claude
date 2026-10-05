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
