-- Who works where, and in what capacity.
--
-- A person and the institution they sign for are separate entities, and neither is a
-- field on the other: the money, the mandate and the do-not-approach instruction do not
-- always attach to the same one. This table is the edge between them.
--
-- It is deliberately many-to-many and dated. People sit on two family offices, advise a
-- foundation while working at a fund, and leave — and a route planned through a role
-- somebody left eighteen months ago is the failure this prevents.
--
-- It is *not* network.edge. An edge says two people have a relationship we might route
-- through; an affiliation says a person acts for an organisation. Conflating them means a
-- CIO's employment reads as a warm tie to their employer, which is not a tie at all.

create type identity.affil_kind as enum (
  'principal',       -- it is their money or their foundation
  'decision_maker',  -- signs, or can kill it
  'staff',           -- works there, no decision right on file
  'adviser',         -- retained, not employed
  'board',
  'contact'          -- our counterpart, capacity not established
);

create table identity.affiliation (
  affiliation_id uuid primary key default gen_random_uuid(),
  person_entity  uuid not null references identity.entity(entity_id),
  org_entity     uuid not null references identity.entity(entity_id),
  kind           identity.affil_kind not null,
  -- Their title as they state it, not as we infer it.
  role           text not null,
  started_on     date,
  -- Set means former. A route through a former role is the classic stale-graph mistake.
  ended_on       date,
  -- Is this the organisation we deal with them through? At most one open row per person.
  is_primary     boolean not null default false,
  -- Same provenance discipline as every other externally-sourced field.
  source         text,
  as_of          date not null,
  certainty      text not null default 'known',
  note           text,
  check (person_entity <> org_entity)
);

create index affiliation_person_idx on identity.affiliation (person_entity);
create index affiliation_org_idx on identity.affiliation (org_entity);
