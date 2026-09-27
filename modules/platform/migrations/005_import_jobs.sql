-- Local Postgres children report independently of page requests. PGlite keeps its old path.
create table platform.import_job (
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('findings','prospects','duplicates','pursuits','dakota','strategy-moves','affinity')),
  actor uuid not null references platform.app_user(id),
  input jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check(status in ('queued','running','completed','failed')),
  phase text not null default 'Waiting for worker',
  done integer not null default 0 check(done >= 0),
  total integer check(total >= 0),
  result jsonb,
  error text,
  created_at timestamptz not null default clock_timestamp(),
  started_at timestamptz,
  heartbeat_at timestamptz,
  finished_at timestamptz
);
create unique index import_job_one_active_kind on platform.import_job(kind) where status in ('queued','running');
create index import_job_recent on platform.import_job(created_at desc);
