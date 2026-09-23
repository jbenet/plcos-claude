-- What a note says, read (N55, docs/17 §4): a one-sentence summary, their read if the note
-- gives one, and the words the read rests on.
--
-- Juan, 23 Sep: "the notes have info to start populating the reads ... give it a shot to see
-- what it looks like. we can always scratch and re-map." So the first readings are Claude's,
-- made in a working session from the landed notes, and each is a suggestion: it shows as one,
-- counts for nothing a person has not confirmed where the pipeline shows a read, and a person
-- can confirm it or say it is wrong. A reading a person dismissed is not suggested again.
--
-- A note that mentions a person's or a family's health is never read into this table
-- (Report 4 §6.2); the importer refuses it, whatever the file says.
--
-- Append-only: 001 and 002 are applied in the real database and cannot change.

create table meetings.note_reading (
  source         text not null default 'affinity',
  note_id        text not null,
  summary        text,
  read           meetings.read,
  -- What in the note the read rests on, in a few words.
  basis          text,
  -- Who read it: 'claude' for a suggestion made in a working session, else a user's handle.
  read_by        text not null,
  read_at        timestamptz not null default now(),
  confirmed_by   uuid references platform.app_user(id),
  confirmed_at   timestamptz,
  dismissed_by   uuid references platform.app_user(id),
  dismissed_at   timestamptz,
  primary key (source, note_id)
);
