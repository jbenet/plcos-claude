-- pipeline: money, and the two tracks it lives on.
--
-- Rule 1 from CLAUDE.md is the reason this schema looks the way it does. Soft and hard
-- never blend. They are not a status column on one row — they are a column the arithmetic
-- reads, and every query that produces a headline filters on it.

create schema if not exists pipeline;

create type pipeline.instrument as enum ('lp_commitment', 'spv', 'grant', 'pri', 'mri', 'direct');

-- Two tracks. There is no third value, and no view anywhere sums across them.
create type pipeline.track as enum ('soft', 'hard');

create table pipeline.exposure (
  exposure_id      uuid primary key default gen_random_uuid(),
  entity_id        uuid not null references identity.entity(entity_id),
  vehicle_id       uuid not null references platform.vehicle(id),
  instrument       pipeline.instrument not null,
  track            pipeline.track not null,
  amount           numeric(16,2) not null check (amount >= 0),
  -- Only meaningful on the soft track. Used for the convertible estimate, which is shown
  -- and never added to hard.
  probability      numeric check (probability is null or (probability >= 0 and probability <= 1)),
  owner_id         uuid not null references platform.app_user(id),
  -- What makes this hard. A hard row with no evidence is a bug.
  evidence_ref     text,
  hardened_at      timestamptz,
  hardened_ticket  uuid references governance.approval_ticket(id),
  -- Cash is a separate state from an accepted commitment. Always.
  cash_received_at timestamptz,
  opened_at        timestamptz not null default now(),
  closed_at        timestamptz,
  unique (entity_id, vehicle_id, instrument),
  constraint hard_needs_evidence check (track <> 'hard' or evidence_ref is not null)
);

create index exposure_vehicle_idx on pipeline.exposure (vehicle_id, track);

-- The conserved capital pool. One budget per actor, across every vehicle they appear in.
-- A scenario engine that lets the same dollar appear in two vehicles is worse than no
-- scenario engine, so the budget lives here and code does the arithmetic.
create table pipeline.capital_pool (
  entity_id   uuid primary key references identity.entity(entity_id),
  budget      numeric(16,2) not null,
  source      text not null,
  as_of       date not null,
  -- An unverified budget is excluded from the check rather than guessed at.
  verified_by uuid references platform.app_user(id),
  note        text
);
