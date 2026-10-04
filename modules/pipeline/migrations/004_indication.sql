-- An indication of interest, and the amount indicated (Juan, 4 Oct 2026, from the mail desk:
-- "wonder if IOI (indication of interest) and indicated amount (a single value or a range)
-- could be fields we associate with the LP in PLCOS"). docs/27-outreach-api.md §1.
--
-- Per LP per vehicle (a pursuit), for a fund or an SPV. A single number is low = high. It is
-- NOT soft money: it is shown beside soft and hard and never added to either (rule 1). It
-- becomes soft only when someone records a soft commitment on the close track. Nothing here is
-- read by vehicleTotals or any other sum of money.
--
-- The latest indication counts; an earlier one is kept, superseded, so a change ("now $5M") is
-- on the record with both dates. The source is the touchpoint where they said it — the email or
-- the call — when there is one. It is not a foreign key: meetings migrates after pipeline, so the
-- service checks the id instead.
--
-- Append-only: 001–003 are applied in the real database and cannot change.

create table pipeline.indication (
  indication_id        uuid primary key default gen_random_uuid(),
  pursuit_id           uuid not null references strategy.pursuit(pursuit_id),
  entity_id            uuid not null references identity.entity(entity_id),
  vehicle_id           uuid not null references platform.vehicle(id),
  low                  numeric(16,2) not null check (low >= 0),
  high                 numeric(16,2) not null,
  indicated_on         date not null,
  -- meetings.meeting(meeting_id): the email or call where they said it. Checked in the service.
  source_touchpoint_id uuid,
  -- The update (strategy.pursuit_update) that recorded it, when it came through the update box.
  update_id            uuid,
  -- 'us' when a person recorded it here; 'spv seat' is never written, only read (an IOI stage).
  source               text not null default 'us',
  recorded_by          uuid not null references platform.app_user(id),
  recorded_at          timestamptz not null default now(),
  superseded_at        timestamptz,
  constraint indication_range check (high >= low)
);

-- The latest unsuperseded indication per pursuit is the current one; the rest are history. Not a
-- unique index: a pursuit merge repoints rows generically, and two merged pursuits may each have one.
create index indication_current_idx on pipeline.indication (pursuit_id, recorded_at desc) where superseded_at is null;
create index indication_vehicle_idx on pipeline.indication (vehicle_id) where superseded_at is null;
