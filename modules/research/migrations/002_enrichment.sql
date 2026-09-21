-- How we could find out what we do not know.
--
-- Half the fit board rests on inferences and guesses, and the strategy board is explicit
-- that a ranking built on guesses ranks the guesses. This table is the option space for
-- fixing that: buy a database, attach a service, run a query, ask a person, watch something
-- public, or put the question in a first meeting.
--
-- Three things are recorded that a list of tools would not carry:
--
--   `produces_tier`  The best evidence tier this method can *justify*. A scraped follower
--                    graph produces tier D — a discovery clue — no matter how much of it
--                    there is. Recording that stops a bulk source being mistaken for proof.
--   `blocked_by`     What stops it today, in a sentence. A method nobody can run is still
--                    worth listing, because the blocker is often the cheaper thing to fix.
--   `limits`         The line this method must not cross. In a neurotech raise the obvious
--                    failure is prospect research drifting into health inference about
--                    people or their families (Report 4 §6.2). It is written on the row.

create type research.method_kind as enum (
  'buy',        -- a dataset or a subscription
  'integrate',  -- a service we query programmatically
  'query',      -- a search somebody runs, by hand or with a model
  'ask',        -- a direct question to a person who would know
  'observe',    -- something public, watched over time
  'interview',  -- a question put in a meeting or a first email
  'infer'       -- derived from data we already hold
);

create type research.method_status as enum ('available', 'blocked', 'in_use', 'rejected');

create table research.method (
  method_id     uuid primary key default gen_random_uuid(),
  kind          research.method_kind not null,
  name          text not null,
  detail        text not null,
  -- Which fit dimensions and gates this could fill, by their codes.
  yields        text[] not null default '{}',
  -- A | B | C | D. The best tier this method can justify, not the best it might luck into.
  produces_tier text not null,
  cost_usd      numeric,
  cost_basis    text,
  effort_days   numeric not null default 0,
  latency_days  int,
  -- universe | segment | one — how many targets one run of this touches.
  coverage      text not null default 'one',
  status        research.method_status not null default 'available',
  blocked_by    text,
  limits        text,
  certainty     text not null default 'inferred',
  source        text,
  as_of         date not null,
  sort          int not null default 0
);

create index method_kind_idx on research.method (status, kind, sort);
