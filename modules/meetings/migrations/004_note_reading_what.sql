-- What happened, as the note tells it (N56): one word per reading, so that each row of an LP's
-- timeline can show at a glance whether it was a meeting, a deck view, questions asked, a number
-- given, and so on. Juan, 23 Sep (issue 0001): "would be useful to have icons in each row that
-- describes what happened in that case. (meeting, deck view, questions, etc. things that make it
-- visually easy + fast to grok state)".
--
-- Like the summary, the word is a suggestion from whoever read the note. It is plain text,
-- checked against the list in lib/connectors/affinity/readings.ts when a file loads, so a new
-- word needs no migration. Null when the reading didn't say.
--
-- Append-only: 001 to 003 are applied in the real database and cannot change.

alter table meetings.note_reading add column what text;
