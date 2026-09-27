-- "Derive SPV stance" runs as its own import job (Developer → Enrich) and inside Import the findings
-- (Juan, 27 Sep 2026; strategy/011_spv_stance.sql).
alter table platform.import_job drop constraint import_job_kind_check;
alter table platform.import_job add constraint import_job_kind_check
  check(kind in ('findings','prospects','duplicates','pursuits','lp-units','spv-stance','dakota','strategy-moves','affinity','network','export'));
