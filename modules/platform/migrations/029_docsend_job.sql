-- Read DocSend's data-room visits (Juan, 14–15 Oct 2026; docs/32-docsend.md), read only, as an import job.
--
-- Append-only: 001 to 028 are applied in the real database and cannot change.
alter table platform.import_job drop constraint import_job_kind_check;
alter table platform.import_job add constraint import_job_kind_check
  check(kind in ('findings','prospects','duplicates','pursuits','lp-units','spv-stance','dakota','strategy-moves','affinity','network','export','linear','linear-rebuild','calendar','docsend'));
