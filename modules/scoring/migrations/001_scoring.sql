-- scoring: a rubric, not a model.
--
-- Four dimensions, weights that are visible and editable, and a factor row that carries
-- the sentence explaining where its number came from. Nothing here is learned, nothing is
-- inferred, and a target with missing factors is reported as unscored rather than scored
-- on the half we happen to have.

create schema if not exists scoring;

create table scoring.weights (
  weights_id        uuid primary key default gen_random_uuid(),
  label             text not null,
  capacity          numeric not null,
  affinity          numeric not null,
  propensity        numeric not null,
  time_to_decision  numeric not null,
  active            boolean not null default false,
  created_by        uuid references platform.app_user(id),
  created_at        timestamptz not null default now(),
  -- A weight set that does not sum to one is a bug, not a preference.
  constraint weights_sum_to_one check (
    abs(capacity + affinity + propensity + time_to_decision - 1) < 0.0001
  )
);

create unique index weights_one_active on scoring.weights (active) where active;

create type scoring.dimension as enum ('capacity', 'affinity', 'propensity', 'time_to_decision');

create table scoring.factor (
  factor_id    uuid primary key default gen_random_uuid(),
  entity_id    uuid not null references identity.entity(entity_id),
  vehicle_id   uuid not null references platform.vehicle(id),
  dimension    scoring.dimension not null,
  -- 0..1. Rendered as a band and a sentence, never as a percentage of anything.
  value        numeric not null check (value >= 0 and value <= 1),
  -- Why this number. Required: a factor without a reason is a guess with a decimal point.
  basis        text not null,
  source       text references research.source_doc(doc_id),
  as_of        date not null,
  recorded_by  uuid references platform.app_user(id),
  unique (entity_id, vehicle_id, dimension)
);
