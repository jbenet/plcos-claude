-- compliance: the part every alternate design left out.
--
-- Four of five vehicles here are 506(c). That is not a footnote: it means the fund may
-- advertise, and it means every subscriber must be verified as accredited by reasonable
-- steps rather than by ticking a box. It also means a public claim needs substantiation
-- on file, and a general-solicitation record needs to exist before anyone asks for one.

create schema if not exists compliance;

create type compliance.channel as enum
  ('website', 'deck', 'email', 'podcast', 'conference', 'social', 'press');

create type compliance.claim_status as enum ('in_use', 'needs_review', 'withdrawn');

-- Every claim we make in public, and what backs it.
create table compliance.public_claim (
  claim_id            uuid primary key default gen_random_uuid(),
  statement           text not null,
  channel             compliance.channel not null,
  asset_id            uuid references content.asset(asset_id),
  vehicle_id          uuid references platform.vehicle(id),
  first_used_on       date not null,
  -- What makes the statement true. A claim with no substantiation is a liability.
  substantiation      text not null,
  substantiation_ref  text,
  reviewed_by         uuid references platform.app_user(id),
  reviewed_on         date,
  status              compliance.claim_status not null default 'in_use'
);

create type compliance.verification_method as enum
  ('income', 'net_worth', 'third_party_letter', 'registered_professional', 'self_certified', 'none');

create type compliance.verification_status as enum
  ('not_started', 'requested', 'received', 'verified', 'failed', 'not_required');

-- 506(c) requires reasonable steps. self_certified is recorded as a method and is
-- explicitly not sufficient for a 506(c) vehicle — the gate checks the status, not the
-- existence of a row.
create table compliance.accreditation (
  record_id    uuid primary key default gen_random_uuid(),
  entity_id    uuid not null references identity.entity(entity_id),
  vehicle_id   uuid not null references platform.vehicle(id),
  method       compliance.verification_method not null default 'none',
  status       compliance.verification_status not null default 'not_started',
  evidence_ref text,
  verified_by  uuid references platform.app_user(id),
  verified_on  date,
  expires_on   date,
  note         text,
  unique (entity_id, vehicle_id)
);

-- Who was solicited, through what, when. A 506(b) vehicle appearing here is an incident.
create table compliance.solicitation (
  event_id     uuid primary key default gen_random_uuid(),
  vehicle_id   uuid not null references platform.vehicle(id),
  channel      compliance.channel not null,
  audience     text not null,
  occurred_on  date not null,
  asset_id     uuid references content.asset(asset_id),
  recorded_by  uuid not null references platform.app_user(id),
  note         text
);

create table compliance.side_letter (
  letter_id   uuid primary key default gen_random_uuid(),
  entity_id   uuid not null references identity.entity(entity_id),
  vehicle_id  uuid not null references platform.vehicle(id),
  provision   text not null,
  -- Most-favoured-nation. Every later side letter has to be read against these.
  mfn         boolean not null default false,
  risk        text not null,
  signed_on   date,
  reviewed_by uuid references platform.app_user(id)
);
