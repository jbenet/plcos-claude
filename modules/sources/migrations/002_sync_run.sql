-- One row per run against a source: a discovery, a slice, later a poll (N41, docs/15).
--
-- The request log says what was asked; this says what a run was for, how it ended, and
-- what it landed. A run that failed halfway is still a row, with what it got before it
-- stopped, because "we have 40 of 60 lists" is different from "we have the lists".
--
-- Append-only, like every migration from N38: never edit this file once applied.

create table sources.sync_run (
  id            bigserial primary key,
  source        text not null,
  kind          text not null,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  status        text not null default 'running' check (status in ('running', 'ok', 'failed')),
  run_by        uuid references platform.app_user(id),
  requests      int not null default 0,
  records       int not null default 0,
  new_records   int not null default 0,
  note          text
);
create index sync_run_started_idx on sources.sync_run (source, kind, started_at desc);
