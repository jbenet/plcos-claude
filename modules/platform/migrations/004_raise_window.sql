-- When each vehicle is raising, and what its name looks like in an email (N59).
--
-- Juan, 23 Sep, correcting the first reconciliation: meetings and emails that were not about
-- the raise were counted as though they were — a meeting years ago about something else, an
-- email from 2021 — "fundraising start for PLC Neurotech is 2026. perhaps we should add a date
-- range for each vehicle's fundraise", and an email should count only when "it should be clear
-- from context (should have the name of the vehicle, talk about a/the fund or investing, be
-- to/from @[the fundraising domain] addresses, or similar)".
--
-- So a vehicle has a raise window, open-ended when it is still raising, and aliases: the words
-- that name it in a subject line or a meeting title. Both come from the init file. A window
-- that is a guess says so in raise_window_note until someone confirms the dates.
--
-- Append-only: 001 to 003 are applied in the real database and cannot change.

alter table platform.vehicle
  add column raise_opens_on    date,
  add column raise_closes_on   date,
  add column raise_window_note text,
  add column aliases           text[] not null default '{}';
