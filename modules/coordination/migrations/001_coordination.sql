-- coordination: the table that prevents four raises colliding on one overlapping LP universe.

create schema if not exists coordination;

create type coordination.ask_status as enum
  ('proposed', 'blocked', 'approved', 'made', 'answered', 'withdrawn');

create type coordination.ask_outcome as enum
  ('opted_in', 'declined', 'no_reply', 'deferred');

create table coordination.ask (
  ask_id         uuid primary key default gen_random_uuid(),
  -- Who we want to reach.
  entity_id      uuid not null references identity.entity(entity_id),
  -- Who we would ask to make the introduction. Null for a direct approach.
  connector_id   uuid references identity.entity(entity_id),
  vehicle_id     uuid not null references platform.vehicle(id),
  status         coordination.ask_status not null default 'proposed',
  -- ONE owner per relationship. Enforced by the guard, not by a convention.
  owner_id       uuid not null references platform.app_user(id),
  ticket_id      uuid references governance.approval_ticket(id),
  purpose        text not null,
  scheduled_for  date,
  made_at        timestamptz,
  channel        text,
  outcome        coordination.ask_outcome,
  outcome_note   text,
  -- An override is permitted, but it must carry a reason and it writes an audit row.
  override_of    uuid references coordination.ask(ask_id),
  override_reason text,
  created_at     timestamptz not null default now()
);

create index ask_entity_idx on coordination.ask (entity_id, made_at desc);
create index ask_connector_idx on coordination.ask (connector_id, made_at desc);

-- A collision becomes a record with its own lifecycle, not a block.
-- Blocking protects the relationship and loses the deferred opportunity; a case with a
-- dated follow-up for the loser turns the block into a scheduled second bite.
create type coordination.conflict_status as enum ('open', 'adjudicated', 'withdrawn');

create type coordination.conflict_reason as enum
  ('closer_to_close', 'stronger_fit', 'owner_relationship', 'vehicle_priority', 'target_preference');

create table coordination.conflict_case (
  case_id           uuid primary key default gen_random_uuid(),
  entity_id         uuid not null references identity.entity(entity_id),
  window_days       int not null,
  status            coordination.conflict_status not null default 'open',
  opened_at         timestamptz not null default now(),
  -- The two claimants.
  claimant_a        uuid not null references coordination.ask(ask_id),
  claimant_b        uuid not null references coordination.ask(ask_id),
  winner_ask_id     uuid references coordination.ask(ask_id),
  loser_ask_id      uuid references coordination.ask(ask_id),
  reason_code       coordination.conflict_reason,
  -- Not nullable in practice: adjudication without a dated follow-up for the loser is the
  -- bug this table exists to prevent. Enforced in the service, checked here.
  loser_followup_at date,
  adjudicated_by    uuid references platform.app_user(id),
  adjudicated_at    timestamptz,
  note              text,
  constraint adjudication_is_complete check (
    status <> 'adjudicated' or (
      winner_ask_id is not null and loser_ask_id is not null
      and reason_code is not null and loser_followup_at is not null
    )
  )
);

create index conflict_open_idx on coordination.conflict_case (opened_at desc) where status = 'open';

-- Promoted out of research.note on purpose: a guard is a tool, and a tool needs a precise
-- input. This is test 3 of the promotion rule in modules/research/README.md.
--
-- The restriction attaches to the TARGET, not to an edge. Rule 8: a decline or
-- do-not-approach instruction changes the plan; it is never satisfied by substituting a
-- different connector toward the same prohibited approach.
create type coordination.restriction_scope as enum ('connector', 'channel', 'blanket');

create table coordination.restriction (
  restriction_id  uuid primary key default gen_random_uuid(),
  entity_id       uuid not null references identity.entity(entity_id),
  scope           coordination.restriction_scope not null,
  connector_id    uuid references identity.entity(entity_id),
  channel         text,
  instruction     text not null,
  -- The document this came from, so the guard can show its work.
  source          text references research.source_doc(doc_id),
  recorded_by     uuid references platform.app_user(id),
  recorded_at     timestamptz not null default now(),
  expires_at      date
);

create index restriction_entity_idx on coordination.restriction (entity_id);
