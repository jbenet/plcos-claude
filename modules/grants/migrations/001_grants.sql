-- grants: sourced, not applied for.
--
-- The no-unsolicited gate is a state machine guard, not advice. Outreach on the grants
-- rail is blocked until a funder invitation exists, and the invitation is a record with a
-- reference and a date rather than a recollection that someone was encouraging.

create schema if not exists grants;

create type grants.funder_status as enum ('sourced', 'invited', 'applied', 'awarded', 'declined');

create table grants.funder (
  funder_id      uuid primary key default gen_random_uuid(),
  entity_id      uuid not null references identity.entity(entity_id),
  programme      text not null,
  cycle          text,
  status         grants.funder_status not null default 'sourced',
  -- The gate. Null means no invitation exists, and no amount of enthusiasm substitutes.
  invitation_ref text,
  invited_on     date,
  invited_by     text,
  fit_note       text,
  owner_id       uuid references platform.app_user(id),
  created_at     timestamptz not null default now(),
  unique (entity_id, programme),
  -- A funder cannot be past 'invited' without an invitation on file.
  constraint invitation_required check (
    status in ('sourced') or invitation_ref is not null
  )
);
