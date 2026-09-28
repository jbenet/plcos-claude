## Daily timer — 28 Sep 2026

`SCHEDULE_DAILY_AT=03:00` enables a UTC daily timer: Affinity slice refresh, Linear sync,
then SPV stance, through the existing import queue. Each waits for completion; failure stops
the sequence. `BACKUP_COMMAND`, when set, runs after all three complete.
An existing Postgres advisory lock excludes another scheduler; scheduled job `created_at`
prevents same-day replay, including failed attempts. Startup catches up after the deadline;
an interrupted sequence is not replayed. With the schedule unset, server behavior is unchanged.
No tables or dependencies added. Two invented-data properties cover order, backup, daily
deduplication, the UTC deadline, failure, and the disabled default.
Verified: `npx tsc --noEmit`, `npm run boundaries`, and all 1,109 PGlite properties pass.
Postgres runs at merge.
