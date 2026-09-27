## Postgres preparation — separate import processes, live switch deferred

27 September 2026. Juan asked to prepare local Postgres after heavy imports repeatedly
blocked pages, with verification before a live switch. `DATABASE_URL` selects the Postgres
adapter; leaving it unset keeps PGlite. Both use the same query API and immutable migration
ledger. Postgres imports run in child processes with persisted progress and per-kind writer
locks, so imports can work while the page server answers reads.

The snapshot copy tool checks every table's row count and ordered-row checksum and refuses
non-empty targets without explicit replacement. The rehearsal launcher uses a disposable
local Postgres database on a non-live port, omits credentials, and skips init and seeding.
The [design and switch runbook](docs/21-postgres.md) covers snapshotting, verification,
rehearsal, smoke checks and rollback to the untouched PGlite database.

Validation: `npx tsc --noEmit` and `npm run boundaries` pass (645 source files).
`npm run props` with `DATABASE_URL` unset passes **767/767** properties.
`DATABASE_URL=postgres://plcos@127.0.0.1:5434/plcos_test_props npm run props` passes
**779/779** on Postgres **17.11**. Additional Postgres checks cover copy integration,
statement timeouts, concurrent readers, per-kind locks and simultaneous child starts.
The same application properties run on both adapters; file-lock/preview checks still
exercise PGlite's filesystem-specific contract. No applied SQL migration was changed.

Driver differences: bigint counts use the same safe numeric representation; multi-statement
queries return the last result; application Dates retain milliseconds. The copy avoids JS
Date/number decoding to preserve database microseconds and arbitrary numeric precision,
and sorts canonical SQL row digests rather than relying on heap or JSON key order.
Postgres migration passes serialize under an advisory transaction lock. Same-process
maintenance respects multi-query readers while separate foreground connections remain
concurrent. Independent worker commits cannot force infinite page/route cache rebuilds:
after two retries, the reader reports busy and discards mixed-revision output.
All development fixtures were invented. No real data was read, no connector was contacted,
and the live server was not switched. The provided development cluster remains invented-only;
Claude must provision private storage and rehearse on a real snapshot before switching.

Known limits: local process supervision is not durable cloud orchestration; Postgres does
not eliminate CPU/I/O contention or database locks. Copying the database does not copy file
inputs or attachments. Reverting after Postgres accepts writes requires reconciliation;
there is no automated reverse copy. Progress is phase-level except Dakota's record batches.
Unsupported copy features (including identity columns, custom grants and partitions) fail
closed; owners/comments are not migrated. The current complete application schema copies
successfully. Real-snapshot load/latency checks, credentialed Affinity execution and live
smoke/rollback verification remain Claude's gates before switching.
