-- The stored route searches carry their own summary (performance pass, 15 Oct 2026).
--
-- strategyRouteSummaries reads, for every target of a vehicle kind, only each route's endpoints, tier and hop
-- names, but building that from `search` read the whole jsonb of every search: 195 MB for the fund kind on the
-- real data, about 650 ms of every cold LP or plan page. The summary is kept beside the search by a trigger, in
-- the shape the reader built (network/strategy-summary.ts, Flat), so any write of `search` keeps it current and
-- the read touches a few KB per target. '[]' is a search without routes; null is a row not yet summarized.
alter table network.route_cache add column summary jsonb;

create function network.route_cache_summary() returns trigger language plpgsql as $$
begin
  new.summary := coalesce((select jsonb_agg(jsonb_build_array(r->'fromEntity', r->'fromName', r->'weakestTier', r->'viaContact',
      jsonb_path_query_array(r, '$.hops[*].toEntity'), jsonb_path_query_array(r, '$.hops[*].toName')))
    from jsonb_array_elements(coalesce(new.search->'routes','[]'::jsonb)) r), '[]'::jsonb);
  return new;
end $$;

create trigger route_cache_summary before insert or update of search on network.route_cache
  for each row execute function network.route_cache_summary();

-- Rows already stored: the same summary, without rewriting their searches.
update network.route_cache c set summary = coalesce((select jsonb_agg(jsonb_build_array(r->'fromEntity', r->'fromName', r->'weakestTier', r->'viaContact',
    jsonb_path_query_array(r, '$.hops[*].toEntity'), jsonb_path_query_array(r, '$.hops[*].toName')))
  from jsonb_array_elements(coalesce(c.search->'routes','[]'::jsonb)) r), '[]'::jsonb);
