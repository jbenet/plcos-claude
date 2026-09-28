-- Links between our records and Linear's (Juan, 27 Sep 2026; docs/24-linear.md §4), and the
-- colours Linear shows on labels and projects.
--
-- A link is made by a person, once: a vehicle's projects are suggested by name on Developer →
-- Linear and accepted or turned down there. A turned-down suggestion is kept, so it is not offered
-- again. Nothing links by name alone. Linear is never written.
create table linear.link (
  target_kind text not null check (target_kind in ('vehicle', 'pursuit', 'move')),
  target_id text not null,
  linear_kind text not null check (linear_kind in ('project', 'issue')),
  linear_id text not null,
  status text not null check (status in ('accepted', 'rejected')),
  -- How it was proposed: 'name' (a suggestion from the vehicle's names) or 'person' (picked by hand).
  source text not null check (source in ('name', 'person')),
  basis text,
  as_of timestamptz not null default now(),
  confidence text not null default 'confirmed' check (confidence in ('confirmed')),
  last_verified_by uuid not null references platform.app_user(id),
  primary key (target_kind, target_id, linear_kind, linear_id)
);
create index link_linear_idx on linear.link (linear_kind, linear_id);

alter table linear.label add column color text;
alter table linear.project add column color text;
