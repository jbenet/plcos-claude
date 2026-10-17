-- Tell Astra runners apart by a random per-process instance id (red team, 17 Oct 2026): two runners on one Mac share a
-- host name, so both passed the one-runner check and failed each other's runs as lost. The runner row keeps the live
-- instance; each job keeps the instance that claimed it, and a report naming an instance must be that one's. Runners
-- from before this send none: both columns stay null and the host decides, as before.
--
-- Append-only: 001 to 029 are applied in the real database and cannot change.
alter table platform.astra_runner add column instance text;
alter table platform.astra_job add column claimed_by text;
