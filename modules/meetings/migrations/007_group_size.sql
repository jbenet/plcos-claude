-- How many parties of ours an Affinity interaction is with (N81): a firm, or a person with none.
-- Four or more makes it an event, not a meeting (modules/meetings, GROUP_EVENT). Computed at every
-- query first, it made a long LP page three times slower, so translation now writes it here.
--
-- Append-only: 001 to 006 are applied in the real database and cannot change.

alter table meetings.meeting add column group_size int not null default 1;
