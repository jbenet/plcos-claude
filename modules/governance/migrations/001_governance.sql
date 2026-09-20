-- governance: the gate that sits in front of a mutation, not the record taken after it.
--
-- Five kinds, a closed set. Every mutating command in those families takes a ticketId and
-- fails closed without an approved, unexpired one. "Who approved this" is unanswerable by
-- omission rather than reconstructible after the incident.

create schema if not exists governance;

create type governance.approval_kind as enum
  ('SEND', 'INTRO_ASK', 'MONEY', 'STAGE', 'ALLOCATION_EXCEPTION');

create type governance.approval_decision as enum
  ('approve', 'reject', 'request_changes', 'defer');

create table governance.approval_ticket (
  id             uuid primary key default gen_random_uuid(),
  kind           governance.approval_kind not null,
  subject_type   text not null,
  subject_id     uuid not null,
  -- Human-readable subject, so the queue is legible before the module that owns the
  -- subject has a screen of its own. Not a substitute for the foreign key.
  subject_label  text not null,
  -- The bounded action this approval authorizes, stated. Never an opaque bundle.
  scope          jsonb not null,
  vehicle_id     uuid references platform.vehicle(id),
  requested_by   uuid not null references platform.app_user(id),
  decided_by     uuid references platform.app_user(id),
  decision       governance.approval_decision,
  decision_note  text,
  expires_at     timestamptz,
  created_at     timestamptz not null default now(),
  decided_at     timestamptz
);

-- One open ticket per subject per kind. Two people cannot be asked to approve the same
-- thing twice and disagree.
create unique index approval_open_unique
  on governance.approval_ticket (kind, subject_type, subject_id)
  where decision is null;

create index approval_open_idx on governance.approval_ticket (created_at desc) where decision is null;
