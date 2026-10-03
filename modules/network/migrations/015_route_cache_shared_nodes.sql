-- Routes through X (2 Oct 2026). "LPs reachable only through X" read every stored search's candidate
-- paths on each page view: 100 LPs ran past five minutes on the real cache (8K searches, 222 MB). The
-- store now records what every candidate path shares, so the question is a primary-key read.
-- Null until a search is next stored; the daily generation change re-stores every row within a day.
alter table network.route_cache
  add column candidate_count integer,
  add column shared_nodes uuid[];
