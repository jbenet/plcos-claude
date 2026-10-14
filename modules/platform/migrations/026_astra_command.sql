-- Commands for the Mac's Astra runner from Developer → Astra (docs/30-astra-runner.md; Juan, 11 Oct 2026: "built some
-- RC type thing for the runner on the Mac so you can help admin it"). A person, or an Admin token, asks for one of
-- three fixed commands; the runner takes it on its next poll and reports back: Check (the checkout's state), Restart,
-- Update (fast-forward to master, then restart). The runner also says which code it started on.
--
-- Append-only: 001 to 025 are applied in the real database and cannot change.
create table platform.astra_command (
  id uuid primary key default gen_random_uuid(),
  op text not null check(op in ('diagnose','restart','update')),
  actor uuid not null references platform.app_user(id),
  status text not null default 'queued' check(status in ('queued','sent','done','failed')),
  result jsonb not null default '{}'::jsonb,
  message text check(char_length(message) <= 300),
  created_at timestamptz not null default clock_timestamp(),
  sent_at timestamptz,
  finished_at timestamptz
);
create index astra_command_recent on platform.astra_command(created_at desc);

alter table platform.astra_runner add column code text check(char_length(code) <= 40);
alter table platform.astra_runner add column code_started_at timestamptz;
