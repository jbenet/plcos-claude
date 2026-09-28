# Responsive server — PGlite and imports leave the request thread

27 September 2026 · `codex/responsive-server`

| | |
|---|---|
| ![Developer → Status, with the event-loop delay window](docs/changelog/shots/responsive-server/01-status-event-loop.webp) | Developer → Status now shows the latest `monitorEventLoopDelay` window (issue 0115: shot added after the fact — the branch's own sandbox could not start a server). |

PGlite's WASM execution and large file parsing shared the Next.js request thread.
Scheduling database work with promises did not isolate that synchronous computation.
The database now lives in a Node worker thread owned by the existing Next process.
The public `Db`/`Queryable` API, directory lock, transaction atomicity, SQL error codes,
structured values and `TooManyRows` refusal are preserved. A transaction ID pins every
statement through commit or rollback; `one()` refuses excess rows inside the worker.

Findings, prospects, identity merges, pursuit consolidation, network builds and research
exports now use the existing import-job receipts on PGlite too. Worker threads run their
parsing and computation and borrow the owner's database handle through a message port.
They cannot open a second PGlite writer. Progress polling reads a parent-side mirror while
the database is occupied. Interrupted transactions roll back; earlier committed batches
remain committed. A failed job is not automatically replayed. The Postgres path retains
its existing separate process runner and asynchronous connection pools.

Activity file scans and aggregation, plus the enrichment page’s findings/file summary,
also run in threads. Network jobs await identity resolution and route warmup before
closing their database proxy; those continuations cannot outlive the worker.
Idle database workers do not keep CLI processes alive, while outstanding queries do. The main process records
`monitorEventLoopDelay` p99 and maximum values every minute in
`activity/server-YYYY-MM-DD.jsonl`, independently of the DB, and displays the latest window
on Developer → Status. `/api/health` is a DB-free liveness route. Sampling resolution is
10 ms; this is event-loop delay, not page or database latency.

## Measurements and verification

All measurements use invented data. No real directories were read. The fixture has
1,100 research files and approximately 18 MB of connection records. The responsiveness
script uses a probe thread so a frozen request thread cannot hide queued requests.

This execution environment denies socket bind/connect with `EPERM`, including loopback
and Unix sockets. Consequently, the measured request dispatch and filesystem-journal
latencies below use the explicitly labelled `--dispatch` transport, not HTTP or a running
Next server. The default benchmark uses HTTP and enforces a 50 ms trivial-request p99
budget during the SQL test and a 200 ms budget during the import, plus a 200 ms journal
budget. Actual HTTP/Next measurements remain an integration check.

| Workload / metric | Historical main thread | Worker |
| --- | ---: | ---: |
| 60 s CPU SQL: trivial dispatch p99 | 59,449.89 ms | 0.34 ms |
| 60 s CPU SQL: trivial dispatch maximum | 59,955.25 ms | 1.45 ms |
| 60 s CPU SQL: filesystem journal p99 | 59,463.58 ms | 3.33 ms |
| 60 s CPU SQL: event-loop p99 / maximum | 60,028.88 / 60,028.88 ms | 12.32 / 24.97 ms |
| Findings + network import: trivial dispatch p99 | 1,520.09 ms | 0.13 ms |
| Import: filesystem journal p99 | 1,520.46 ms | 1.13 ms |
| Import: event-loop p99 / maximum | 52.99 / 1,533.02 ms | 12.60 / 19.76 ms |

The final query run handled 592 probes per route; the import handled 61 per route, with
zero probe errors. The import mapped all 1,100 findings and 1,100 connection paths, with
zero rejected findings, from an 18,235,792-byte connections fixture. Import elapsed time
was 5.837 seconds before and 6.064 seconds after. These runs use 10 ms histogram sampling.
The historical adapter also blocks on `pg_sleep`: a 25 ms timer fired after 253 ms during
250 ms SQL. An earlier incorrect baseline invocation was discarded; the table uses the
historical implementation and the final worker implementation.

Additional final worker profiles used 1,100 invented prospects, 100 actual identity merges
and 100 actual pursuit merges. These measure the parent event loop, using 5 ms sampling:

| Operation | Completed work | Duration | Parent p99 lag |
| --- | --- | ---: | ---: |
| Add prospects | 1,100 added | 5,641 ms | 6.05 ms |
| Merge duplicate identities | 100 merged | 237 ms | 5.88 ms |
| Consolidate pursuits | 100 merged | 1,532 ms | 6.38 ms |
| Export | 1,100 candidates | 248 ms | 6.25 ms |
| Network | 1,101 source nodes; 1,200 route warmups | 16,900 ms | 6.38 ms |

Activity aggregation on 1,101 files, including an 18,933,950-byte connections JSON, retained
identical aggregate counts. At 1 ms sampling, p99 lag fell from **64.16 to 1.43 ms** and
maximum lag from **124.85 to 1.76 ms**. Total elapsed time was 281 ms before and 319 ms after;
thread isolation frees the request loop rather than promising faster total completion.
P99 varies with filesystem scheduling; maximum lag also exposes individual stalls.

Reproduce these profiles with `node --import tsx scripts/profile-import-threads.ts` and
`node --import tsx scripts/bench-activity-responsiveness.ts`. Both use disposable invented
fixtures. The benchmark scripts reject the real profile; the property harness forces demo.

Validation:

- `npx tsc --noEmit`: passed.
- `npm run boundaries`: passed, 679 source files and 297 existing screenshots. The checker
  now also covers native `.mjs`/`.cjs` worker files.
- `npm run props` with `DATABASE_URL` unset: **856/856 passed**, normal process exit.
  Coverage includes transaction exclusion across awaits, rollback, exact `TooManyRows`,
  SQLSTATE, structured values, stale handles, disk reopen, idle/pending worker lifecycle,
  duplicate job starts, failure receipts, disconnect rollback and DB-free telemetry.
- `DATABASE_URL=postgres://plcos@127.0.0.1:5434/plcos_test_props npm run props`:
  attempted, **blocked before any properties ran** by `connect EPERM 127.0.0.1:5434`.
  Postgres runtime regression testing remains required before integration.
- Scaled import, activity and individual job profiles passed. HTTP/Next response-time
  claims remain unverified here because listening on a local socket was denied.

Reproduce the HTTP guard outside the restricted sandbox:

```sh
node --import tsx scripts/responsiveness.ts --baseline --seconds=60
node --import tsx scripts/responsiveness.ts --seconds=60
```

The baseline is the historical in-thread adapter, isolated in a benchmark-only file;
application code never selects it. The long-query benchmark uses CPU-bound SQL.

## Integration and live operation

Claude should run the Postgres property suite and the HTTP benchmark in an environment
that permits loopback sockets, then integrate and restart the existing live Next server.
Keep `DATABASE_URL` unset to stay on PGlite. No extra server or service is required.
The existing migration runner applies the new import-kind constraint migration; renumber
its new `006_responsive_jobs.sql` prefix if needed during integration, before first apply.
Worker entry files and the existing `tsx` runtime must remain available in the checkout.

Check Developer → Status after one minute, `/api/health` during an import, progress polling,
and a feedback submission on live. PGlite still has one connection: DB-backed pages can
wait or report busy behind a long transaction even though feedback and liveness continue.
This change does not claim concurrent PGlite queries or durable cloud orchestration.

No screenshot was captured: the sandbox cannot start a local HTTP preview. No live restart,
real-data rehearsal, migration of real records, fetch, pull or push was performed here.
