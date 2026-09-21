-- The strategy board: the space of things we could do, and what we picked.
--
-- The problem this exists for is not "what is happening" — six other modules answer that.
-- It is **"given everything we know, what is the next best use of a week?"** A fundraise
-- has a large action space and a small team, and the failure mode is not laziness: it is
-- doing the visible thing (send another email) instead of the load-bearing one (get the
-- marks independently verified, which unblocks four prospects at once).
--
-- Three disciplines are baked into the schema:
--
--   1. **A play must cite what put it on the list.** `because` is not null. An action with
--      no finding behind it is a task somebody thought of in the shower.
--   2. **Suggesting is not assigning.** A play is `proposed` until a person assigns it, and
--      assignment is a separate command that writes a handoff. Nothing here fills anyone's
--      queue by being written down.
--   3. **Long-horizon work is a separate horizon, not a low priority.** Ranked against
--      short-term work it always loses, which is exactly how compounding effort starves.

create schema if not exists plays;

/** Which lever a play pulls. The list is closed so the board can be counted by lever. */
create type plays.lever as enum (
  'source',     -- add names to the universe
  'enrich',     -- learn more about names we already have
  'segment',    -- go after a specific better-fitting slice
  'materials',  -- make what we send clearer or more credible
  'reach',      -- be findable without a route
  'route',      -- find a warm path to a specific target
  'convince',   -- answer a stated objection with evidence
  'validate',   -- third-party proof we cannot supply ourselves
  'convene',    -- events, workshops, podcasts — relationship at low pressure
  'process',    -- our own machinery: verification, close mechanics, ops
  'ask'         -- make the ask, advance the rung
);

create type plays.horizon as enum ('now', 'compounding');
create type plays.play_status as enum ('proposed', 'assigned', 'committed', 'done', 'dropped');

create table plays.play (
  play_id         uuid primary key default gen_random_uuid(),
  vehicle_id      uuid not null references platform.vehicle(id),
  -- Null means the play is about the whole vehicle rather than one funder.
  entity_id       uuid references identity.entity(entity_id),
  horizon         plays.horizon not null,
  lever           plays.lever not null,
  title           text not null,
  detail          text not null,
  -- The finding that put this on the list. Not nullable on purpose.
  because         text not null,
  -- 1–5. How likely this is to move anything at all, not how much we like it.
  likelihood      int not null check (likelihood between 1 and 5),
  -- Person-days. The denominator of every ranking on the board.
  effort_days     numeric not null check (effort_days > 0),
  -- How many targets it touches. A play that unblocks four prospects is worth four.
  reach           int not null default 1 check (reach >= 1),
  -- What it buys, in a sentence. For a compounding play this is the second-order effect.
  payoff          text not null,
  certainty       text not null default 'inferred',
  suggested_owner uuid references platform.app_user(id),
  status          plays.play_status not null default 'proposed',
  assigned_to     uuid references platform.app_user(id),
  assigned_at     timestamptz,
  -- The approval this would need before it could actually happen, if any.
  gate            text,
  sort            int not null default 0
);

create index play_board_idx on plays.play (vehicle_id, horizon, status);
create index play_entity_idx on plays.play (entity_id);

/**
 * What a target needs before they can say yes.
 *
 * The needs shape the strategy, and they are not the same as the fit reading. Fit says
 * whether they *should* want this; a need says what is missing between here and a yes —
 * and "they do not understand the domain" and "they do not believe we can get into the
 * deals" call for completely different work.
 */
create type plays.need_kind as enum (
  'know_domain',      -- understand the field at all
  'know_us',          -- know who we are
  'believe_returns',  -- believe the asset class can return
  'believe_access',   -- believe we get into the right deals
  'validation',       -- someone they trust saying it
  'mechanics',        -- structure, fees, terms, verification
  'timing',           -- their own window
  'permission'        -- a mandate, a committee, a gate
);

create table plays.need (
  need_id     uuid primary key default gen_random_uuid(),
  vehicle_id  uuid not null references platform.vehicle(id),
  entity_id   uuid not null references identity.entity(entity_id),
  kind        plays.need_kind not null,
  statement   text not null,
  -- How we know. A need with no evidence is a theory about somebody.
  evidence    text not null,
  -- Null means nobody has established it either way.
  met         boolean,
  source      text,
  as_of       date not null,
  sort        int not null default 0
);

create index need_target_idx on plays.need (vehicle_id, entity_id, sort);

/**
 * What somebody wrote down and committed to.
 *
 * The text is kept exactly as typed, and anything parsed out of it lives *beside* it in
 * `parsed` rather than replacing it. A commitment that has been rewritten by a parser is
 * a commitment nobody can be held to.
 */
create table plays.commitment (
  commitment_id uuid primary key default gen_random_uuid(),
  vehicle_id    uuid not null references platform.vehicle(id),
  entity_id     uuid references identity.entity(entity_id),
  body          text not null,
  written_by    uuid not null references platform.app_user(id),
  written_at    timestamptz not null default now(),
  parsed        jsonb
);

/**
 * The integration point, made visible.
 *
 * Assigning a play or committing to something should open a Linear issue. No Linear client
 * is installed and none will be before L13, so instead of pretending, the exact payload we
 * would send is written here with `state = 'pending'`. When the connector arrives it drains
 * this table; until then the UI can show what would have gone out, which is the difference
 * between a stub and a lie.
 *
 * See docs/14-linear-integration-points.md.
 */
create table plays.handoff (
  handoff_id    uuid primary key default gen_random_uuid(),
  play_id       uuid references plays.play(play_id) on delete cascade,
  commitment_id uuid references plays.commitment(commitment_id) on delete cascade,
  provider      text not null default 'linear',
  payload       jsonb not null,
  -- pending | sent | failed. Nothing is ever 'sent' before a connector exists.
  state         text not null default 'pending',
  external_ref  text,
  note          text,
  created_at    timestamptz not null default now(),
  check (play_id is not null or commitment_id is not null)
);

create index handoff_state_idx on plays.handoff (state, created_at desc);
