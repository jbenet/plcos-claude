-- What a connector is credible about, and to whom.
--
-- Report 6 §2 is the reason this table exists: **connector credibility is target-specific
-- and topic-specific, and it does not transfer.** A famous crypto investor is not a route
-- into a neuroscience foundation, and treating "well known" as a single scalar is how a
-- route planner recommends the most impressive name instead of the most useful one.
--
-- So standing is recorded per domain, with a basis, and the basis is what the UI shows.
-- "Strength 4" says nothing; "co-authored the memo the target publicly cited" says why.

create type network.standing_domain as enum (
  'neuro',        -- the science and the companies
  'crypto',       -- digital-asset infrastructure
  'allocators',   -- LPs, endowments, family offices — how capital gets placed
  'science',      -- research and philanthropy broadly
  'operating'     -- building and running companies
);

create table network.standing (
  standing_id uuid primary key default gen_random_uuid(),
  entity_id   uuid not null references identity.entity(entity_id),
  domain      network.standing_domain not null,
  -- 1–5. Not fame: how much weight their opinion carries *in this domain*.
  strength    int not null check (strength between 1 and 5),
  -- Why. A strength with no basis is a number somebody liked.
  basis       text not null,
  source      text,
  as_of       date not null,
  certainty   text not null default 'inferred',
  unique (entity_id, domain)
);

create index standing_entity_idx on network.standing (entity_id);
