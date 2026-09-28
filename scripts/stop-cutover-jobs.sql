-- Only copied workers: terminal history stays unchanged. Counts only.
with stopped as (
  update platform.import_job set status='failed',error='stopped at cutover',
    phase='stopped at cutover',finished_at=clock_timestamp(),heartbeat_at=clock_timestamp()
  where status in ('running','queued') returning 1
) select count(*) as stopped_import_jobs from stopped;
