-- The stored route searches carry their own summary (performance pass, 15 Oct 2026).
--
-- strategyRouteSummaries reads, for every target of a vehicle kind, only each route's endpoints, tier and hop
-- names, but building that from `search` read the whole jsonb of every search: 195 MB for the fund kind on the
-- real data, about 650 ms of every cold LP or plan page. The summary is written beside the search, in the same
-- shape the reader built (network/strategy-summary.ts, Flat), so the read touches a few KB per target.
alter table network.route_cache add column summary jsonb;

update network.route_cache c set summary = coalesce((select jsonb_agg(jsonb_build_array(r->'fromEntity', r->'fromName', r->'weakestTier', r->'viaContact',
    jsonb_path_query_array(r, '$.hops[*].toEntity'), jsonb_path_query_array(r, '$.hops[*].toName')))
  from jsonb_array_elements(coalesce(c.search->'routes','[]'::jsonb)) r), '[]'::jsonb);
