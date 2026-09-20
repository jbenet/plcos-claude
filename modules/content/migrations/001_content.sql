-- content: one canonical asset, many audience variants, and a gate in front of sending.
--
-- Two rules shape this schema. Lineage: a variant records which claims it rests on, so a
-- changed claim marks its derivatives for refresh rather than waiting for someone to
-- notice. Wrap: what may be said depends on the vehicle and the instrument, checked at
-- send time, with wrong-wrap sends = 0 as a hard KPI.

create schema if not exists content;

create type content.audience as enum (
  'lp_memo', 'grant_framing', 'public_primer', 'seminar_outline',
  'social_post', 'video_script', 'ddq_response'
);

-- How far a piece of material may travel. Ordered: public ⊃ accredited_only ⊃ internal.
create type content.permitted_use as enum ('public', 'accredited_only', 'internal');

create type content.asset_status as enum ('draft', 'approved', 'needs_refresh', 'withdrawn');

create table content.asset (
  asset_id      uuid primary key default gen_random_uuid(),
  title         text not null,
  -- A canonical asset has no parent. A variant has exactly one.
  parent_id     uuid references content.asset(asset_id),
  audience      content.audience,
  vehicle_id    uuid references platform.vehicle(id),
  version       int not null default 1,
  owner_id      uuid not null references platform.app_user(id),
  permitted_use content.permitted_use not null,
  summary       text not null,
  body          text not null,
  status        content.asset_status not null default 'draft',
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  -- A variant must name its audience; a canonical asset must not.
  constraint variant_has_audience check ((parent_id is null) = (audience is null))
);

create index asset_parent_idx on content.asset (parent_id);

-- What an asset rests on. This is the lineage: change a claim, and everything downstream
-- is marked for refresh.
create table content.claim_ref (
  asset_id  uuid not null references content.asset(asset_id),
  claim_id  uuid not null references research.claim(claim_id),
  primary key (asset_id, claim_id)
);

create table content.refresh_flag (
  flag_id     uuid primary key default gen_random_uuid(),
  asset_id    uuid not null references content.asset(asset_id),
  claim_id    uuid references research.claim(claim_id),
  reason      text not null,
  flagged_at  timestamptz not null default now(),
  cleared_at  timestamptz,
  cleared_by  uuid references platform.app_user(id)
);

create index refresh_open_idx on content.refresh_flag (asset_id) where cleared_at is null;

-- The wrong-wrap matrix. Vehicle (by exemption) × instrument → what may be said.
-- A 506(b) vehicle may not be publicly solicited for; a grant rail may not be pitched as
-- an LP opportunity. These are not style rules.
create table content.wrap_rule (
  rule_id            uuid primary key default gen_random_uuid(),
  exemption          text not null,
  instrument         pipeline.instrument not null,
  allowed_audiences  content.audience[] not null,
  max_permitted_use  content.permitted_use not null,
  note               text not null,
  unique (exemption, instrument)
);

create type content.send_status as enum ('proposed', 'approved', 'sent', 'refused');

create table content.send (
  send_id      uuid primary key default gen_random_uuid(),
  asset_id     uuid not null references content.asset(asset_id),
  entity_id    uuid not null references identity.entity(entity_id),
  vehicle_id   uuid not null references platform.vehicle(id),
  instrument   pipeline.instrument not null,
  status       content.send_status not null default 'proposed',
  ticket_id    uuid references governance.approval_ticket(id),
  requested_by uuid not null references platform.app_user(id),
  -- Populated when the wrap check refused. Kept, because a refusal is the record that
  -- makes "wrong-wrap sends = 0" mean something.
  refusal      text,
  requested_at timestamptz not null default now(),
  sent_at      timestamptz
);
