-- DocSend data-room visits, read only (Juan, 14–15 Oct 2026; docs/32-docsend.md). Read through DocSend's own
-- MCP server under one Admin's sign-in; nothing is written back to DocSend.
--
-- A visit is evidence of attention, never of interest: it moves no stage and no consent rung (docs/32 §3).
create schema docsend;

-- Whose DocSend sign-in the sync uses. One row at most; the tokens themselves are that person's secret
-- (platform.person_secret, purpose 'docsend'), never stored here.
create table docsend.connection (
  only_one      boolean primary key default true check (only_one),
  user_id       uuid not null references platform.app_user(id),
  connected_at  timestamptz not null default now(),
  last_error    text,
  last_error_at timestamptz
);

-- The Spaces (data rooms) the signed-in account can see, and how far back each has been read.
create table docsend.space (
  space_id      bigint primary key,
  name          text not null,
  seen_at       timestamptz not null default now(),
  -- Visits from this time on are all held: the start of the last read that reached the end or the overlap.
  read_through  timestamptz,
  read_at       timestamptz
);

-- Which vehicle a Space or a document belongs to. A document row wins over its Space's.
create table docsend.vehicle_map (
  kind        text not null check (kind in ('space', 'document')),
  key         text not null,
  vehicle_id  uuid not null references platform.vehicle(id),
  set_by      uuid references platform.app_user(id),
  set_at      timestamptz not null default now(),
  primary key (kind, key)
);

-- One row per visit. DocSend gives a visit no id, so visit_id is a hash of where, what, who and when.
create table docsend.visit (
  visit_id        text primary key,
  source          text not null check (source in ('mcp')),
  started_at      timestamptz not null,
  duration_sec    numeric,
  pages_viewed    int,
  page_count      int,
  percent_viewed  numeric,
  -- {"1": 9, "2": 6, …}: seconds on each page.
  page_seconds    jsonb,
  viewer_email    text,
  viewer_name     text,
  -- The LP, matched by email the way calendar guests are; null when no one on record has the address.
  entity_id       uuid,
  -- A visit by someone on our team: kept, never counted.
  internal        boolean not null default false,
  link_name       text,
  document_id     bigint,
  document_title  text,
  space_id        bigint,
  space_name      text,
  vehicle_id      uuid references platform.vehicle(id),
  raw             jsonb not null,
  received_at     timestamptz not null default now(),
  matched_at      timestamptz
);

create index visit_vehicle_idx on docsend.visit (vehicle_id, started_at desc);
create index visit_email_idx on docsend.visit (viewer_email);
create index visit_entity_idx on docsend.visit (entity_id) where entity_id is not null;
