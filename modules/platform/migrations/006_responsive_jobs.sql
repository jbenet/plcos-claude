-- PGlite threads share the owner's handle; Postgres retains its independent import pools.
alter table platform.import_job drop constraint import_job_kind_check;
alter table platform.import_job add constraint import_job_kind_check
  check(kind in ('findings','prospects','duplicates','pursuits','dakota','strategy-moves','affinity','network','export'));
