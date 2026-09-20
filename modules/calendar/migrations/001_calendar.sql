-- calendar: the working weeks between now and the close, and the ones that are not
-- working weeks at all.
--
-- For a raise with a December close this changes what the system says on roughly a third
-- of the remaining working days. A queue that nags into an empty office is not urgency,
-- it is noise, and it teaches people to ignore the queue.

create schema if not exists calendar;

create type calendar.period_kind as enum ('sprint', 'holiday', 'dead_zone', 'milestone');

create table calendar.period (
  period_id         uuid primary key default gen_random_uuid(),
  kind              calendar.period_kind not null,
  label             text not null,
  detail            text,
  starts_on         date not null,
  ends_on           date not null,
  vehicle_id        uuid references platform.vehicle(id),
  -- Inside a period with this set, the HUD stops using urgency language. It does not
  -- hide the work; it stops pretending someone is going to do it on 27 December.
  suppress_urgency  boolean not null default false,
  created_at        timestamptz not null default now()
);

create index period_range_idx on calendar.period (starts_on, ends_on);
