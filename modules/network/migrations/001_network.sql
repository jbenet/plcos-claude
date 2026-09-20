-- network: relationships that outlive a single query.
--
-- No graph database (CLAUDE.md, "Do not build"). Recursive CTEs handle two- and three-hop
-- enumeration at this scale, and connector ask-load, evidence tiers and the
-- non-circumvention rule all need relationship state that survives past one search.

create schema if not exists network;

create type network.edge_kind as enum (
  'connector',          -- has introduced people for us before
  'colleague',          -- worked together
  'advisor',
  'board',              -- served on a board together
  'coinvestor',
  'family',
  'event_coattendee',   -- was in the same room. A clue.
  'social_public',      -- a public follow. A clue.
  'podcast_guest'
);

-- A–D, and what each tier is allowed to mean.
--   A  documented working relationship with evidence of interaction
--   B  documented association, one strong source, some interaction
--   C  shared affiliation only — same board, same firm, no evidence they ever spoke
--   D  proximity only — co-attendance, a public follow
-- C and D always require a human before the edge is trusted for routing.
create type network.evidence_tier as enum ('A', 'B', 'C', 'D');

create table network.edge (
  edge_id            uuid primary key default gen_random_uuid(),
  from_entity        uuid not null references identity.entity(entity_id),
  to_entity          uuid not null references identity.entity(entity_id),
  kind               network.edge_kind not null,
  tier               network.evidence_tier not null,
  -- 0..1. Stored because Affinity will supply it later; never rendered as a percentage
  -- of anything, because it is not one.
  strength           numeric,
  -- Computed band, not raw strength: routing prefers the moderate band deliberately.
  tie_band           text,
  evidence           jsonb not null default '[]'::jsonb,
  -- Required before a C or D edge may carry a route. Null means "not trusted yet".
  reviewed_by        uuid references platform.app_user(id),
  reviewed_at        timestamptz,
  review_note        text,
  -- Relationships sequence rather than simply exist.
  valid_from         date not null,
  valid_to           date,
  created_at         timestamptz not null default now()
);

create index edge_from_idx on network.edge (from_entity);
create index edge_to_idx on network.edge (to_entity);

-- Relationships are not directed in the world. Storage is; traversal is not.
create view network.link as
  select edge_id, from_entity as a, to_entity as b, kind, tier, strength, tie_band,
         evidence, reviewed_by, reviewed_at, valid_from, valid_to
    from network.edge
  union all
  select edge_id, to_entity as a, from_entity as b, kind, tier, strength, tie_band,
         evidence, reviewed_by, reviewed_at, valid_from, valid_to
    from network.edge;
