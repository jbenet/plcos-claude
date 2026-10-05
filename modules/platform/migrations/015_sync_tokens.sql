-- Cloud pull and push (docs/deploy/railway.md §6–§7, Juan 4 Oct 2026, decisions G and F).
-- A token row now has a scope. 'mcp' is every token made before this migration: the MCP endpoint.
-- 'snapshot' reads the whole database through GET /api/sync/snapshot; only an Admin makes one.
-- 'push' hands the server one finished research output through POST /api/sync/push; a GP or an Admin.
-- A token has exactly one scope, so a push token cannot pull and an MCP token can do neither.
alter table platform.mcp_token add column scope text not null default 'mcp'
  check (scope in ('mcp', 'snapshot', 'push'));

-- One row per accepted push, keyed by the SHA-256 of its content: the same file pushed twice is
-- accepted once and answered with the first run (idempotency). Rejected pushes are not recorded here;
-- the audit log has them (sync.call, outcome rejected).
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
