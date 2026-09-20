-- identity: the canonical node every other module points at.
-- Identity churn poisons everything downstream, so the discipline here matters more than
-- the schema: the id is a surrogate, minted once, and never derived from cluster contents.

create schema if not exists identity;

create type identity.entity_type as enum ('person', 'org', 'family', 'foundation', 'vehicle');

create table identity.entity (
  entity_id     uuid primary key default gen_random_uuid(),
  entity_type   identity.entity_type not null,
  display_name  text not null,
  -- On a merge one id survives and the other redirects. Ids are never reused.
  merged_into   uuid references identity.entity(entity_id),
  created_at    timestamptz not null default now(),
  retired_at    timestamptz
);

create index entity_name_idx on identity.entity (lower(display_name));

-- One row per record we saw in any source system. The join between "what a source calls
-- this" and "who we think it is".
create table identity.source_record (
  source       text not null,
  source_id    text not null,
  entity_id    uuid not null references identity.entity(entity_id),
  confidence   numeric,
  -- rule:email | splink:v3 | human:juan — never just "matched"
  resolved_by  text not null,
  resolved_at  timestamptz not null default now(),
  primary key (source, source_id)
);

-- Human adjudications as hard constraints. Applied before and over any probabilistic
-- model, so a re-run can never silently reverse a person's decision.
create type identity.assertion_kind as enum ('same_as', 'not_same_as');

create table identity.match_assertion (
  assertion_id     bigserial primary key,
  kind             identity.assertion_kind not null,
  left_source      text not null,
  left_source_id   text not null,
  right_source     text not null,
  right_source_id  text not null,
  asserted_by      uuid references platform.app_user(id),
  asserted_at      timestamptz not null default now(),
  note             text
);
