-- Read calendars (issue 0021, Juan 8 Oct 2026: read only): each person's Google Calendar through mailguard.
--
-- Append-only: 001 to 022 are applied in the real database and cannot change.
alter table platform.import_job drop constraint import_job_kind_check;
alter table platform.import_job add constraint import_job_kind_check
  check(kind in ('findings','prospects','duplicates','pursuits','lp-units','spv-stance','dakota','strategy-moves','affinity','network','export','linear','linear-rebuild','calendar'));
