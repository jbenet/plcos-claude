-- "Re-point pursuits to their LP" runs as its own import job (issues 0111, 0112; docs/23).
alter table platform.import_job drop constraint import_job_kind_check;
alter table platform.import_job add constraint import_job_kind_check
  check(kind in ('findings','prospects','duplicates','pursuits','lp-units','dakota','strategy-moves','affinity','network','export'));
