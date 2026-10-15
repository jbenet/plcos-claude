-- PL's own staff edges by index (performance pass, 15 Oct 2026).
--
-- The sources list (network/repo.ts) reads the worked-together edges PL affiliation recorded. PL touches about
-- 167,000 edges, and the evidence test threw away all but about a hundred of them, row by row: 114 ms of every
-- cold LP page. These partial indexes hold only those edges (1.9 ms).

-- It rewrites or indexes a large table, so it may take longer than the web's 20 s statement limit at boot.
set local statement_timeout = 0;
create index edge_pl_from_idx on network.edge (from_entity)
  where evidence @> '[{"tie":{"kind":"worked_together","basis":"pl_affiliation"}}]'::jsonb;
create index edge_pl_to_idx on network.edge (to_entity)
  where evidence @> '[{"tie":{"kind":"worked_together","basis":"pl_affiliation"}}]'::jsonb;
