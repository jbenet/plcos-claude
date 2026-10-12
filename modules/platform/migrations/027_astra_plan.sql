-- A night plan for the Mac's Astra runner (docs/30-astra-runner.md). Juan, 12 Oct 2026, after the runner sat idle
-- for 6.6 hours of the night once the queued work ran out: "i asked you to keep it busy" and "would be good to come
-- up with a schedule". With Keep busy on, the server itself keeps the queue topped up through the night window from
-- an ordered list of steps (workflow, LPs per run, and optionally the vehicles to focus on), moving to the next step
-- when one has nobody left, so no Claude session has to be awake to queue.
--
-- Append-only: 001 to 026 are applied in the real database and cannot change.
alter table platform.astra_runner add column keep_busy boolean not null default false;
alter table platform.astra_runner add column plan jsonb not null default '[]'::jsonb check(jsonb_typeof(plan) = 'array');

alter table platform.astra_job add column focus text[] check(cardinality(focus) <= 8);
alter table platform.astra_job add column step integer check(step between 0 and 19);
alter table platform.astra_job drop constraint astra_job_source_check;
alter table platform.astra_job add constraint astra_job_source_check check (source in ('person','auto','plan'));
create index astra_job_plan_night on platform.astra_job(night, step) where source = 'plan';
