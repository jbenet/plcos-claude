-- LP units (issues 0111, 0112; docs/23-lp-units.md). The LP is the committing unit: an
-- organisation, or a person in their own capacity. A pursuit is one LP unit × one vehicle.
-- A person at a firm is a contact on the firm's pursuit, not an LP of their own.

-- The capacity the LP unit commits in, where a rule or a person has established it. Only
-- 'personal' is written today (a person with evidence of investing on their own account);
-- an organisation's pursuit is organisational by its entity, whatever this says.
alter table strategy.pursuit
  add column lp_capacity text check (lp_capacity is null or lp_capacity in ('organisation', 'personal')),
  -- Why the re-point rule could not tell firm from personal: a question for a person.
  add column lp_review text;
-- A view keeps the columns it was created with: re-create it so active reads see the new ones.
create or replace view strategy.active_pursuit as select * from strategy.pursuit where merged_into is null;

-- The people who speak for an LP unit on one pursuit: its contacts and decision-makers. A
-- re-pointed person's pursuit leaves them here, with the role they hold at the organisation.
create table strategy.pursuit_contact (
  contact_id        uuid primary key default gen_random_uuid(),
  pursuit_id        uuid not null references strategy.pursuit(pursuit_id),
  person_entity     uuid not null references identity.entity(entity_id),
  role              text,
  -- The pursuit they came from (their own, when re-pointed), kept through later merges.
  origin_pursuit_id uuid not null,
  source            text not null,
  created_by        uuid references platform.app_user(id),
  created_at        timestamptz not null default now(),
  unique (origin_pursuit_id, person_entity)
);
create index pursuit_contact_pursuit_idx on strategy.pursuit_contact (pursuit_id);
create index pursuit_contact_person_idx on strategy.pursuit_contact (person_entity);
-- Page inputs read contacts (lib/build-cache.ts): a change to them is a new read revision.
create trigger network_reads_changed after insert or update or delete or truncate on strategy.pursuit_contact
  for each statement execute function network.invalidate_reads();

-- One row per decision the re-point rule (or a person) made about a person's pursuit, with the
-- exact changes it wrote, so each is reversible by compare-and-restore like a pursuit merge.
create table strategy.lp_repoint (
  id                  uuid primary key default gen_random_uuid(),
  pursuit_id          uuid not null,
  person_entity       uuid not null,
  vehicle_id          uuid not null,
  decision            text not null check (decision in ('moved', 'personal', 'review')),
  decided_by          text not null check (decided_by in ('rule', 'person')),
  org_entity          uuid,
  org_pursuit_id      uuid,
  created_org_pursuit boolean not null default false,
  reason              text not null,
  evidence            jsonb not null default '[]'::jsonb,
  rule                text not null check (rule = 'rule:lp-unit-repoint'),
  actor_id            uuid references platform.app_user(id),
  created_at          timestamptz not null default now(),
  changes             jsonb not null,
  reversed_at         timestamptz,
  reversed_by         uuid references platform.app_user(id),
  reversal_reason     text
);
create index lp_repoint_pursuit_idx on strategy.lp_repoint (pursuit_id, created_at desc);
