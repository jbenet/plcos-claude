-- signals: external change detection, on fixtures until connectors exist at L13.
--
-- Module 06 deliberately has no screen of its own. A dedicated signals page before any
-- connector exists would render invented change detection, which is worse than nothing.
-- Signals appear where they are actionable: on Today, and on the target they concern.

create schema if not exists signals;

create type signals.signal_kind as enum (
  'personnel_change',
  'allocation_announced',
  'mandate_change',
  'filing',
  'public_statement',
  'event_attendance',
  'fund_close'
);

create type signals.disposition as enum ('new', 'claimed', 'acted', 'dismissed');

create table signals.signal (
  signal_id          uuid primary key default gen_random_uuid(),
  entity_id          uuid references identity.entity(entity_id),
  kind               signals.signal_kind not null,
  headline           text not null,
  detail             text,
  -- Provenance, same tuple discipline as every other externally-sourced field.
  source             text not null,
  source_ref         text,
  observed_at        timestamptz not null,
  confidence         research.confidence not null default 'medium',
  -- The rule that made this a signal rather than noise, stated on the row. A signal whose
  -- threshold cannot be named is a notification.
  threshold_label    text not null,
  threshold_detail   text not null,
  disposition        signals.disposition not null default 'new',
  claimed_by         uuid references platform.app_user(id),
  claimed_at         timestamptz,
  note               text,
  -- Idempotency: re-reading the same fixture must not create a second row.
  source_key         text not null unique,
  created_at         timestamptz not null default now()
);

create index signal_entity_idx on signals.signal (entity_id, observed_at desc);
create index signal_new_idx on signals.signal (observed_at desc) where disposition = 'new';
