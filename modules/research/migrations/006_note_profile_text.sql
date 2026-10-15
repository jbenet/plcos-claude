-- A public profile's text, stored (performance pass, 15 Oct 2026).
--
-- Strategic value (strategy/strategic.ts) looks for a vehicle's words in every LP's public profile on each rebuild of
-- a vehicle's lists. Turning the profile jsonb into text for that test was most of the read: about 50 ms of the
-- 4,400 profiles (10 MB) per vehicle, after every write. Generated from `data`, so no writer changes (19 ms).

-- It rewrites a large table, so it may take longer than the web's 20 s statement limit at boot.
set local statement_timeout = 0;
alter table research.note add column profile_text text generated always as ((data -> 'profile')::text) stored;
