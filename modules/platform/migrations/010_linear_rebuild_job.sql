-- Rebuild the local replica without requesting any Linear records.
alter table platform.import_job drop constraint import_job_kind_check;
alter table platform.import_job add constraint import_job_kind_check
  check(kind in ('findings','prospects','duplicates','pursuits','lp-units','spv-stance','dakota','strategy-moves','affinity','network','export','linear','linear-rebuild'));

-- Pull and rebuild write the same files, including with PGlite workers. The existing
-- per-kind index still coalesces repeated clicks; this one rejects cross-kind overlap.
create unique index import_job_one_active_linear on platform.import_job ((1))
  where kind in ('linear','linear-rebuild') and status in ('queued','running');
