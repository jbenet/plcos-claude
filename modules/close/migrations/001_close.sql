-- close: two rooms, because a fund close and an SPV close are not the same shape.
--
-- A fund close runs on a long clock with a committee and a subscription pack. An SPV
-- closes on a days-scale clock: invite → IOI → allocate → wire, with days-to-wire as the
-- number that matters. Giving the SPVs the fund's UI would have been a real mistake.

create schema if not exists close;

-- ---------------------------------------------------------------- module 18: fund close

create table close.cycle (
  cycle_id       uuid primary key default gen_random_uuid(),
  vehicle_id     uuid not null references platform.vehicle(id),
  label          text not null,
  target_date    date not null,
  target_amount  numeric(16,2),
  status         text not null default 'open',
  opened_at      timestamptz not null default now(),
  closed_at      timestamptz
);

create type close.condition_status as enum ('open', 'satisfied', 'waived', 'failed');

-- Conditions are the fund-level and investor-level things that must be true before the
-- close can happen. They are not tasks: each has an owner, a date and evidence.
create table close.condition (
  condition_id  uuid primary key default gen_random_uuid(),
  cycle_id      uuid not null references close.cycle(cycle_id),
  entity_id     uuid references identity.entity(entity_id),
  label         text not null,
  detail        text,
  owner_id      uuid references platform.app_user(id),
  due_on        date,
  status        close.condition_status not null default 'open',
  evidence_ref  text,
  satisfied_at  timestamptz,
  -- 506(c) vehicles carry verification obligations that a 506(b) one does not.
  compliance    boolean not null default false
);

create type close.pack_status as enum ('not_sent', 'sent', 'returned', 'countersigned');

-- The subscription pack, per investor. Countersigned here is the same event that moves an
-- exposure to the hard track — and it still does not mean the cash arrived.
create table close.pack_item (
  item_id           uuid primary key default gen_random_uuid(),
  cycle_id          uuid not null references close.cycle(cycle_id),
  entity_id         uuid not null references identity.entity(entity_id),
  document          text not null,
  status            close.pack_status not null default 'not_sent',
  sent_at           timestamptz,
  returned_at       timestamptz,
  countersigned_at  timestamptz,
  note              text,
  unique (cycle_id, entity_id, document)
);

-- ---------------------------------------------------------------- module 19: SPV war room

create type close.spv_stage as enum ('invited', 'ioi', 'allocated', 'wired', 'passed');

create table close.spv_seat (
  seat_id       uuid primary key default gen_random_uuid(),
  vehicle_id    uuid not null references platform.vehicle(id),
  entity_id     uuid not null references identity.entity(entity_id),
  stage         close.spv_stage not null default 'invited',
  amount        numeric(16,2),
  owner_id      uuid not null references platform.app_user(id),
  invited_at    timestamptz not null default now(),
  ioi_at        timestamptz,
  allocated_at  timestamptz,
  wired_at      timestamptz,
  note          text,
  unique (vehicle_id, entity_id)
);

create index spv_seat_vehicle_idx on close.spv_seat (vehicle_id, stage);
