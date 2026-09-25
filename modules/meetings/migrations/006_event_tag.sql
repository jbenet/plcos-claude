-- Which vehicles each event is about (N81). Juan, 24 Sep: "some meetings or notes from affinity
-- are getting attributed to PLC Neurotech when they may be for PLC Rails, or they may just be
-- general catchups. Hmm maybe tag each event with which vehicles (if any) it involves".
--
-- The rules of N59 still read every record when it is translated. What changes is what an
-- untagged record about a raise counts for: one that names no vehicle no longer counts for every
-- vehicle raising on its date. It is "vehicle unclear" until someone says which. A tag, from
-- Claude or from a person, overrides the rules. One tag per event, keyed as Affinity keys it:
--
--   interaction:<type>:<id>   an email, meeting, call or message; every LP on it shares the tag
--   note:<id>                 a note
--
-- about     'raise' when it is about raising money with us, 'other' when it isn't.
-- vehicles  the vehicles it is about, by slug. Empty with about = 'raise': about a raise, which
--           one unclear.
-- basis     why, in a few words: the record's own words, or the person's reason.
-- by_kind   'rule' for what the rules read in a note, rewritten by every translation; 'claude'
--           for a tag read from the file Claude writes, loaded by translation like the note
--           readings; 'person' for one set on the LP's page. Each overrides the one before it,
--           and a person's stands, whatever the file says next time. An interaction's rule
--           reading is not kept here: it is on each of its touchpoints, as since N59.
--
-- meeting.about_by says where each touchpoint's about came from: 'rule', 'claude' or 'person'.
--
-- Append-only: 001 to 005 are applied in the real database and cannot change.

create table meetings.event_tag (
  source     text not null default 'affinity',
  ref        text not null,
  about      text not null check (about in ('raise', 'other')),
  vehicles   text[] not null default '{}',
  basis      text,
  by_kind    text not null check (by_kind in ('rule', 'claude', 'person')),
  tagged_by  uuid references platform.app_user(id),
  tagged_at  timestamptz not null default now(),
  primary key (source, ref)
);

alter table meetings.meeting
  add column about_by text check (about_by is null or about_by in ('rule', 'claude', 'person'));
