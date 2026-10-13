-- Two more Astra workflows (docs/30-astra-runner.md), so the night plan has work once profiles and strategies are all
-- written (Juan, 13 Oct 2026: "keep workflows running ALL night, to enrich/get more data on LPs ... keep improving
-- strategies"): w1s, "Search pass (W1)", re-researches pages-only findings with web search (enrich-batch --search);
-- w5r, "Revise strategies (W5)", rewrites strategies the critic's gates flag (enrich-batch --revise).
--
-- Append-only: 001 to 027 are applied in the real database and cannot change.
alter table platform.astra_job drop constraint astra_job_workflow_check;
alter table platform.astra_job add constraint astra_job_workflow_check check (workflow in ('w1w5','w1','w5','w5t','w1s','w5r'));
alter table platform.astra_runner drop constraint astra_runner_auto_workflow_check;
alter table platform.astra_runner add constraint astra_runner_auto_workflow_check check (auto_workflow in ('w1w5','w1','w5','w5t','w1s','w5r'));
