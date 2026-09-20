-- platform: who is using the system, what vehicles exist, what they told us, what happened.
-- Schema-per-module. Nothing outside `platform` may be joined to from another module's
-- repo without going through that module's index.ts.

create schema if not exists platform;

create table platform.app_user (
  id          uuid primary key default gen_random_uuid(),
  handle      text not null unique,
  name        text not null,
  initials    text not null,
  role        text not null,
  email       text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create type platform.vehicle_kind as enum ('fund', 'spv', 'grant_rail');

create table platform.vehicle (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  name           text not null,
  kind           platform.vehicle_kind not null,
  -- The exemption is not decoration: it decides what may be said in public material.
  exemption      text not null,
  target_amount  numeric(16,2),
  sort_order     int not null default 0,
  created_at     timestamptz not null default now()
);

create type platform.feedback_kind as enum ('bug', 'request', 'question', 'chore');
create type platform.feedback_priority as enum ('P0', 'P1', 'P2', 'P3');
create type platform.feedback_status as enum
  ('open', 'triaged', 'agent-ready', 'in-progress', 'review', 'done');

-- The row is the record that someone complained; the markdown file in issues/ is the
-- tracker. The IssueSink writes the file and the ref lands back here.
create table platform.feedback (
  id           uuid primary key default gen_random_uuid(),
  issue_ref    text,
  issue_path   text,
  title        text not null,
  body         text not null,
  kind         platform.feedback_kind not null default 'bug',
  priority     platform.feedback_priority not null default 'P2',
  status       platform.feedback_status not null default 'open',
  reporter_id  uuid not null references platform.app_user(id),
  page         text not null,
  labels       text[] not null default '{}',
  context      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

-- Append-only. Not event sourcing: a record of what happened, alongside the tables that
-- hold what is true. See CLAUDE.md, "Do not build".
create table platform.audit_log (
  id            bigserial primary key,
  at            timestamptz not null default now(),
  actor_id      uuid references platform.app_user(id),
  action        text not null,
  subject_type  text not null,
  subject_id    text,
  detail        jsonb not null default '{}'::jsonb
);

create index audit_log_at_idx on platform.audit_log (at desc);

-- Every surface that renders external data must be able to say when it was last read.
-- 'not_connected' is a first-class state: no connector exists yet and the UI says so
-- rather than implying freshness.
create type platform.sync_status as enum ('ok', 'stale', 'failed', 'not_connected');

create table platform.source_sync (
  source        text primary key,
  label         text not null,
  status        platform.sync_status not null default 'not_connected',
  last_sync_at  timestamptz,
  detail        text
);
