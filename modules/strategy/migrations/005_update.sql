-- Updates (N61, issue 0004): what someone on the team says about an LP, written on the LP's
-- page — "met them Tuesday, they want the deck", "passing for now, back in Q1". Juan, 24 Sep
-- 2026: "add a row at start with a text field to add an update. we should LLM process the
-- output to decide on what to do with the update (ie change status, etc). updates from here
-- should get their own icon too."
--
-- An update is ours, not contact with the LP, so it is not a touchpoint and never counts as a
-- touch. What it changes goes through the usual doors, inside the same transaction: a status
-- through setStatus, a meeting through logTouchpoint, a next step on the pursuit. It never
-- writes a rung (a STAGE ticket does) and never records money (the close track does).
--
--   status_from, status_to  the status before and after, when the update changed it
--   suggested               what the reader proposed for these words, pinned as it was then:
--                           the reader's name and version, each suggestion with its basis
--   applied                 what the person chose, and the ids of what it wrote
--   idempotency_key         one per form: a double click saves one update
--
-- In the strategy schema, not research.note: an LP's plan and money are the confidential plane.

create table strategy.pursuit_update (
  update_id        uuid primary key default gen_random_uuid(),
  pursuit_id       uuid not null references strategy.pursuit(pursuit_id),
  body             text not null check (length(btrim(body)) > 0),
  status_from      strategy.pursuit_status,
  status_to        strategy.pursuit_status,
  suggested        jsonb not null default '{}'::jsonb,
  applied          jsonb not null default '{}'::jsonb,
  created_by       uuid not null references platform.app_user(id),
  created_at       timestamptz not null default now(),
  idempotency_key  text not null unique
);

create index pursuit_update_pursuit_idx on strategy.pursuit_update (pursuit_id, created_at desc);
