-- Touchpoints (N51, docs/17): every dated contact with an LP — a meeting, a call, an email,
-- an intro, an event, a research pass. The table keeps its name; a meeting is the commonest
-- touchpoint, and the meeting pages still read only meetings and calls.
--
-- What it adds to a meeting row:
--   channel     what kind of contact it was
--   direction   who reached out: we did, they did, or both were in it (a meeting)
--   read        their read after it — very interested, interested, not very — recorded by
--               whoever was there, dated by the row. Never computed (docs/17 §4).
--   source      'us' when logged here; 'affinity' when read from a note or from a list
--               entry's interaction dates, with source_ref saying which
--
-- A touchpoint may be about one vehicle, or about none in particular: most of what Affinity
-- records is tied to a person, not to a raise. Such a touchpoint counts for every open
-- pursuit of that LP, and says so.
--
-- Append-only: 001 is applied in the real database and cannot change.

create type meetings.channel as enum ('meeting', 'call', 'email', 'message', 'intro', 'event', 'research');
create type meetings.read as enum ('very_interested', 'interested', 'not_very_interested');

alter table meetings.meeting
  alter column kind drop not null,
  alter column vehicle_id drop not null,
  add column channel     meetings.channel not null default 'meeting',
  add column direction   text check (direction is null or direction in ('ours', 'theirs', 'both')),
  add column read        meetings.read,
  add column read_by     uuid references platform.app_user(id),
  add column source      text not null default 'us',
  add column source_ref  text,
  add column created_by  uuid references platform.app_user(id);

-- One row per thing read from a source, so translating again changes nothing.
create unique index meeting_source_ref_idx on meetings.meeting (source, source_ref) where source_ref is not null;
