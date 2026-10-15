-- The ask's vehicle and unit as stored columns (performance pass, 15 Oct 2026).
--
-- Every LP list picks each pursuit's latest suggestion whose ask names its vehicle (or none), and the LP headings
-- read the ask's unit. Both came out of `data`, the whole strategy jsonb (41 MB for 8,600 suggestions on the real
-- data), read again for every candidate: 90–440 ms per page. Generated from `data`, so no writer changes.
alter table strategy.suggestion
  add column ask_vehicle text generated always as (nullif(lower(trim(data #>> '{ask,vehicle}')), '')) stored,
  add column ask_unit text generated always as (data -> 'ask' ->> 'unit') stored;
