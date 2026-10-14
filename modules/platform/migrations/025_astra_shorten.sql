-- One more Astra workflow (docs/30-astra-runner.md): w5t, "Shorten strategies (W5)", rewrites strategies written
-- before W5 1.13 to its length caps, Committed first and back to Selected (Juan, 11 Oct 2026: "summarize strategies /
-- make them fit with new model for the top LPs in each vehicle ... start further down the pipeline and work way
-- back to selected ones"). The rows already taken are unchanged.
--
-- Append-only: 001 to 024 are applied in the real database and cannot change.
alter table platform.astra_job drop constraint astra_job_workflow_check;
alter table platform.astra_job add constraint astra_job_workflow_check check (workflow in ('w1w5','w1','w5','w5t'));
alter table platform.astra_runner drop constraint astra_runner_auto_workflow_check;
alter table platform.astra_runner add constraint astra_runner_auto_workflow_check check (auto_workflow in ('w1w5','w1','w5','w5t'));
