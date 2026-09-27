-- 0082: numeric planning inputs and per-vehicle human decisions need precise types.
create table strategy.move (
  id text primary key,
  title text not null,
  category text not null,
  detail text not null,
  evidence jsonb not null,
  file_hash text not null,
  imported_at timestamptz not null default now()
);
create table strategy.move_vehicle (
  move_id text not null references strategy.move(id),
  vehicle_id uuid not null references platform.vehicle(id),
  estimates jsonb not null,
  state text not null default 'proposed' check (state in ('proposed','chosen','dismissed')),
  position integer check(position between 1 and 10000),
  version integer not null default 0,
  primary key(move_id,vehicle_id)
);
