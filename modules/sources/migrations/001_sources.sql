-- sources: what was asked of an external system, and what came back (N39, docs/15).
--
-- Affinity is the first. Everything lands here raw before anything is translated into our
-- model, so a mapping mistake is fixed by re-running the translation, not by spending the
-- monthly request budget again.
--
-- In the real profile these tables hold real data and live only in data/real/. The real
-- database cannot be reset, so this file must never change once applied: add 002_… instead.

create schema if not exists sources;

-- One row per request, sent or refused. The path is stored without its query string, and
-- never a body or a header — those are where names, filters and the key live.
create table sources.request_log (
  id              bigserial primary key,
  at              timestamptz not null default now(),
  source          text not null,
  -- The allowlisted template it matched (/v2/lists/{listId}), or what was refused.
  endpoint        text not null,
  path            text not null,
  outcome         text not null check (outcome in ('sent', 'refused', 'network_error', 'rate_limited')),
  status          int,
  duration_ms     int,
  user_remaining  int,
  org_remaining   int,
  note            text
);
create index request_log_at_idx on sources.request_log (at desc);

-- A connection test: whose key it is, which account, and what the account's limits say
-- about its plan tier. The answer to open question 1, measured instead of remembered.
create table sources.connection_test (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  source       text not null,
  ok           boolean not null,
  tested_by    uuid references platform.app_user(id),
  tenant       jsonb,
  key_user     jsonb,
  grant_info   jsonb,
  per_minute   jsonb,
  -- Null when the account has no monthly cap, which is itself the answer.
  per_month    jsonb,
  tier         text,
  error        text
);
create index connection_test_at_idx on sources.connection_test (source, at desc);

-- Raw records, exactly as they arrived. The Connector contract's idempotency key is
-- (source, source_id, source_updated_at); where a source gives no change clock — Affinity's
-- list metadata has only createdAt — the payload's hash stands in, so fetching an unchanged
-- record twice stores it once.
create table sources.raw_record (
  id                 bigserial primary key,
  source             text not null,
  kind               text not null,
  source_id          text not null,
  source_updated_at  timestamptz,
  payload_hash       text not null,
  payload            jsonb not null,
  fetched_at         timestamptz not null default now(),
  unique (source, kind, source_id, payload_hash)
);
create index raw_record_kind_idx on sources.raw_record (source, kind, fetched_at desc);
