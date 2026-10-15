-- Notes by kind (performance pass, 15 Oct 2026).
--
-- research.note holds about 104,000 notes of a dozen kinds, and many reads ask for one small kind (calendar
-- candidates, public profiles, context). Its only index leads with entity_id, so a read by kind walked all of it:
-- the calendar candidates, 3 rows, took 55 ms of every page that shows them (5 ms with this and the alias lookup).

-- It indexes a large table, so it may take longer than the web's 20 s statement limit at boot.
set local statement_timeout = 0;
create index note_kind_idx on research.note (kind);
