-- MCP access tokens (docs/26-mcp.md). One row per token a person makes in Preferences.
-- The secret is never stored: only its SHA-256, and a short prefix so a person can tell
-- their tokens apart. Each row is also the token's work envelope: the tools it may call,
-- the vehicles it may see (never wider than its owner's), a daily call budget and an expiry.
create table platform.mcp_token (
  token_id     uuid primary key default gen_random_uuid(),
  user_id      uuid not null references platform.app_user(id),
  label        text not null check (length(label) between 1 and 80),
  token_hash   text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  prefix       text not null,
  -- Tool names from lib/mcp/tools.ts. A name that is not registered there grants nothing.
  tools        text[] not null,
  -- Narrows the owner's vehicles; null means all of the owner's own. Never widens them.
  vehicles     uuid[] default null,
  calls_per_day integer not null check (calls_per_day between 1 and 100000),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_used_at timestamptz,
  revoked_at   timestamptz,
  revoked_by   uuid references platform.app_user(id)
);

create index mcp_token_user_idx on platform.mcp_token (user_id, created_at desc);
