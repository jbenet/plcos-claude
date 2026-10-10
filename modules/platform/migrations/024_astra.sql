-- Astra runs a person starts and watches from Developer → Astra (docs/30-astra-runner.md; Juan, 10 Oct 2026:
-- "a setup with Astra that I run ... where i can monitor and trigger workflows to astra directly", "should not
-- go through claude"). The server only queues and records; the Mac's runner (scripts/astra-runner.ts) claims a
-- job, cuts its batch, runs ChatGPT's codex and reports counts back. No names or record contents are stored here.
--
-- Append-only: 001 to 023 are applied in the real database and cannot change.
create table platform.astra_job (
  id uuid primary key default gen_random_uuid(),
  workflow text not null check(workflow in ('w1w5','w1','w5')),
  size integer not null check(size between 1 and 20),
  run_now boolean not null default false,
  source text not null check(source in ('person','auto')),
  night date,
  seq integer,
  actor uuid not null references platform.app_user(id),
  status text not null default 'queued' check(status in ('queued','claimed','running','done','failed','cancelled')),
  batch text,
  slot text,
  model text,
  counts jsonb not null default '{}'::jsonb,
  message text check(char_length(message) <= 300),
  created_at timestamptz not null default clock_timestamp(),
  claimed_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);
create index astra_job_recent on platform.astra_job(created_at desc);
create unique index astra_job_auto_night on platform.astra_job(night, seq) where source = 'auto';

-- One row: the runner's last word and the person's settings for it.
create table platform.astra_runner (
  id integer primary key default 1 check(id = 1),
  paused boolean not null default false,
  auto_on boolean not null default false,
  auto_workflow text not null default 'w1w5' check(auto_workflow in ('w1w5','w1','w5')),
  auto_batches integer not null default 4 check(auto_batches between 1 and 12),
  batch_size integer not null default 5 check(batch_size between 1 and 20),
  window_start integer not null default 22 check(window_start between 0 and 23),
  window_end integer not null default 7 check(window_end between 0 and 23),
  heartbeat_at timestamptz,
  host text,
  slots jsonb not null default '[]'::jsonb,
  in_window boolean,
  capacity_until timestamptz,
  note text check(char_length(note) <= 300),
  updated_by uuid references platform.app_user(id),
  updated_at timestamptz not null default clock_timestamp()
);
insert into platform.astra_runner(id) values (1);
