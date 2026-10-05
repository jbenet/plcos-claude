-- Cloud push (docs/deploy/railway.md §7; Juan, 4 Oct 2026, decision F: the Mac pushes research results up).
-- One row per accepted push, keyed by the SHA-256 of its content: the same output pushed twice is taken
-- once and answered with the first run (idempotency). Refused pushes are not kept here; the audit log has
-- them (mcp.call, via sync, outcome invalid). The sync scopes themselves need no column: like the outreach
-- scopes they ride in platform.mcp_token.tools (lib/sync/scopes.ts).
--
-- Append-only: 001–016 are applied in the real database and cannot change.
create table platform.sync_push (
  content_hash text primary key check (content_hash ~ '^[0-9a-f]{64}$'),
  run_id       uuid not null,
  token_id     uuid not null references platform.mcp_token(token_id),
  user_id      uuid not null references platform.app_user(id),
  workflow     text not null check (workflow in ('W1', 'W1c', 'W5')),
  files        integer not null check (files > 0),
  job_id       uuid,
  created_at   timestamptz not null default now()
);
