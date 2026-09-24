-- What a touchpoint is about (N59): the raise, or something else. Decided once, when it is
-- translated, from what the record itself says — an email's subject and addresses, a meeting's
-- title and who from the team was there, a note's text — and kept with the words it rests on.
--
-- about           'raise' when it speaks of a vehicle or of the fund, investing, the data room
--                 and so on, or is to or from the team's fundraising domain; 'other' when it
--                 does none of that; null for one logged here, which is about the raise by being
--                 logged here.
-- about_vehicles  the vehicles it names by name or alias. Empty when it names none: then it
--                 counts for any vehicle raising on its date.
-- about_basis     what the decision rests on, in a few words, for the page and for a correction.
--
-- Nothing is dropped: a touchpoint about something else stays, and is counted on the LP's own
-- page as contact history, not on the pipeline of a raise. Juan, 23 Sep: "email unrelated to the
-- fundraise may still be useful for intelligence gathering."
--
-- Append-only: 001 to 004 are applied in the real database and cannot change.

alter table meetings.meeting
  add column about          text check (about is null or about in ('raise', 'other')),
  add column about_vehicles text[] not null default '{}',
  add column about_basis    text;
