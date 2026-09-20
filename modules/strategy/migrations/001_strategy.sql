-- strategy: where a target actually stands, per vehicle.
--
-- The consent ladder has six states and no implicit transitions. Each step up requires a
-- specific evidence record, and the current rung is derived from those records rather than
-- stored — there is no column anyone can set to "interested".

create schema if not exists strategy;

create type strategy.ladder_rung as enum (
  'connector_willing',     -- a connector said they would ask. Nothing more.
  'target_opted_in',       -- the target themselves said yes to a conversation
  'meeting_held',
  'indication_given',      -- a number or a range, from them
  'commitment_accepted',   -- signed and countersigned
  'cash_received'          -- the wire landed
);

create table strategy.pursuit (
  pursuit_id  uuid primary key default gen_random_uuid(),
  entity_id   uuid not null references identity.entity(entity_id),
  vehicle_id  uuid not null references platform.vehicle(id),
  owner_id    uuid not null references platform.app_user(id),
  headline    text,
  -- The next moves. Prose with a reason each; not yet worth a table (promotion rule).
  plan        jsonb not null default '[]'::jsonb,
  opened_at   timestamptz not null default now(),
  closed_at   timestamptz,
  close_reason text,
  unique (entity_id, vehicle_id)
);

-- One row per rung actually reached, with the evidence that justifies it.
create table strategy.ladder_event (
  event_id       uuid primary key default gen_random_uuid(),
  pursuit_id     uuid not null references strategy.pursuit(pursuit_id),
  rung           strategy.ladder_rung not null,
  -- What kind of thing is the evidence, and where is it.
  evidence_kind  text not null,
  evidence_ref   text not null,
  evidence_note  text not null,
  -- A STAGE ticket authorized this advance. Null only for the seed's historical rows.
  ticket_id      uuid references governance.approval_ticket(id),
  recorded_by    uuid not null references platform.app_user(id),
  occurred_at    timestamptz not null,
  created_at     timestamptz not null default now(),
  -- A rung is reached once. Recording it twice is a bug, not an update.
  unique (pursuit_id, rung)
);

create index ladder_pursuit_idx on strategy.ladder_event (pursuit_id, occurred_at);
