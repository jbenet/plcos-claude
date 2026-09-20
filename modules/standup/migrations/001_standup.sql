-- The daily standup.
--
-- The hard part is not the list. It is that **a past day must still read the way it read
-- that morning.** A standup page that recomputes its numbers when you open it in November
-- is not a record of what the team decided on — it is a new opinion wearing an old date,
-- and it makes "we agreed this on the 19th" unfalsifiable.
--
-- So the numbers are pinned into `metrics` when the day is captured, and a past day never
-- recomputes. Today is live and says so, in as many words, until somebody pins it. This is
-- the same discipline as the agent runtime pinning resolved config into a run record.

create schema if not exists standup;

create type standup.horizon as enum ('today', 'week');
create type standup.item_status as enum ('open', 'done', 'carried', 'dropped');
-- Both of these are fixtures today. Neither connector exists before L13, and the source is
-- named on every row so nobody mistakes a fixture for a sync.
create type standup.external_source as enum ('linear', 'affinity');

create table standup.day (
  day          date primary key,
  -- Null until somebody pins it. An unpinned day shows live numbers and says so.
  captured_at  timestamptz,
  captured_by  uuid references platform.app_user(id),
  -- The numbers exactly as they read at capture. Never recomputed, never migrated.
  metrics      jsonb,
  headline     text
);

create table standup.item (
  item_id      uuid primary key default gen_random_uuid(),
  day          date not null references standup.day(day) on delete cascade,
  horizon      standup.horizon not null,
  title        text not null,
  detail       text,
  owner_id     uuid references platform.app_user(id),
  vehicle_id   uuid references platform.vehicle(id),
  status       standup.item_status not null default 'open',
  -- Set when this item came forward from an earlier day. Carrying is visible on purpose:
  -- an item on its fourth day is a different conversation from one on its first.
  carried_from date,
  sort         int not null default 0
);

create index item_day_idx on standup.item (day, horizon, sort);

create table standup.action (
  action_id    uuid primary key default gen_random_uuid(),
  day          date not null references standup.day(day) on delete cascade,
  rank         int not null,
  title        text not null,
  -- Why it is on the list at all. An action with no reason is a task somebody wrote down.
  why          text not null,
  owner_id     uuid references platform.app_user(id),
  vehicle_id   uuid references platform.vehicle(id),
  -- Null when nothing is in the way. Set means this cannot start, and says what stops it.
  blocker      text,
  blocked_on   text,
  due_on       date,
  -- The approval this will need before it can happen, if any. Named here so the standup
  -- cannot quietly propose something that would fail closed at the command.
  gate         text
);

create index action_day_idx on standup.action (day, rank);

create table standup.external (
  external_id  uuid primary key default gen_random_uuid(),
  day          date not null references standup.day(day) on delete cascade,
  source       standup.external_source not null,
  ref          text not null,
  title        text not null,
  state        text not null,
  who          text,
  detail       text,
  occurred_at  timestamptz not null,
  url          text
);

create index external_day_idx on standup.external (day, source, occurred_at desc);
