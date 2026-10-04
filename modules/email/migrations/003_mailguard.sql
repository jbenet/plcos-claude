-- Drafts reach Gmail through mailguard (Juan, 3 Oct 2026; docs/25-email-drafts.md §12). Each person
-- connects their own mailguard key, which acts on their own mailbox and must be drafts-only.
--
-- Which mailbox and tool each person connected, and what the last check of the key found. The key
-- itself is not here: it is in the Keychain on the Mac. email.gmail_account (001) is no longer
-- written: direct Gmail OAuth was removed the same day.

create table email.mailguard_account (
  user_id       uuid primary key references platform.app_user(id),
  -- The mailbox the key acts on, from mailguard's GET /api/v1/me.
  mailbox       text not null,
  -- The tool's name in mailguard.
  tool_name     text not null default '',
  -- The key's effective capabilities at the last check.
  capabilities  text[] not null default '{}',
  -- 'pasted' in Preferences, or 'keychain' (the item handed to the live server at start).
  source        text not null check (source in ('pasted', 'keychain')),
  connected_at  timestamptz not null default now(),
  checked_at    timestamptz not null default now(),
  -- The last check: drafts-only, or why not (scope.ts codes, or the error's kind).
  check_ok      boolean not null,
  check_code    text,
  last_used_at  timestamptz
);
