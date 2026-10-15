-- The prospect rows each LP was sourced from, by index (performance pass, 15 Oct 2026).
--
-- Strategic value (strategy/strategic.ts) reads, for every LP of a vehicle, the latest research.note whose data
-- came from a prospects import. Nothing indexed that test, so every vehicle's rebuild after a write scanned all
-- 104,000 notes: about 87 ms each, four or five times per write on the real data (37 ms with this).

-- It indexes a large table, so it may take longer than the web's 20 s statement limit at boot.
set local statement_timeout = 0;
create index note_prospect_idx on research.note (entity_id) where data->>'source' = 'prospects';
