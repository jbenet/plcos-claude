-- "Sync Linear" runs as an import job on the live server (Juan, 27 Sep 2026; docs/24-linear.md).
alter table platform.import_job drop constraint import_job_kind_check;
alter table platform.import_job add constraint import_job_kind_check
  check(kind in ('findings','prospects','duplicates','pursuits','lp-units','spv-stance','dakota','strategy-moves','affinity','network','export','linear'));
