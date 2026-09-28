# Worker lifetime follows the server

Postgres import workers now have an IPC channel to their server and exit immediately
when it closes, stopping work and heartbeats after a server restart. A worker also
refuses to start without that channel. Open transactions roll back; committed steps
remain for review under the existing stopped-job recovery.

No worker PID column exists, so PID-based recovery was skipped without a migration.
Properties cover a busy child exiting on disconnect and refusal without IPC; the
Postgres child fixture now uses IPC too. Verified with `npx tsc --noEmit`,
`npm run boundaries`, and `npm run props` (PGlite). Postgres runs at merge.
