# Local Postgres preparation — 27 September 2026

Juan asked to prepare Postgres after imports repeatedly stopped pages answering, then
verify everything before switching. This branch prepares that move. It does not switch the
live server. Claude owns the real-snapshot rehearsal, integration and eventual switch.
The development checks use invented records only.

## Database selection and process ownership

`DATABASE_URL` selects the `pg` adapter. Leaving it unset selects PGlite in a Node worker thread owned by the Next process,
with the existing directory lock. Import computation runs in additional threads that borrow
the owner’s database connection over message ports; they never open the directory themselves. Both adapters implement `Queryable` and use the
same immutable migration files and checksum ledger. `pg` stays inside `lib/db/`.

Postgres 17 runs on the same machine. The real profile accepts only loopback connections;
this is not permission to send real records to a hosted database. Postgres files and backups
containing real records must remain under the private `plcos-data/real` storage boundary.
The development cluster at `127.0.0.1:5434` is **invented data only**: never copy a real snapshot
into that cluster. Claude must provision a separate private local cluster for real rehearsal
and live use, with its data directory and backups under the private boundary.

Each process owns a bounded connection pool. The foreground defaults are eight connections,
a five-second connection wait, thirty-second idle eviction, and a twenty-second statement
timeout. These are tuning guesses to verify under the real workload. Import workers use
separate smaller pools and no statement timeout for long batches. Foreground statements
time out rather than holding a page indefinitely. Migration passes hold an advisory transaction lock so concurrent server boots cannot race the ledger.
A transaction uses one checked-out connection until commit or
rollback; it cannot hop between pool members. Imports use a separate child process and
separate connections. Postgres MVCC lets pages read committed rows while those imports
write. This removes PGlite's shared JavaScript/WASM execution bottleneck; it does not remove
CPU, I/O, locks, or expensive query costs. Page-input and structural-route caches recheck
their input revision after a load, retry at most twice, and return a controlled busy error
if an independent importer keeps changing the input. They never accept a mixed-revision
result just to meet the retry limit. Measure the actual pages during rehearsal.

`one()` still refuses more than one row; the adapter never silently truncates query results.
Application readers retain their existing explicit bounds. Migration execution is shared across both adapters. Applied migration
files must never be edited to accommodate a driver difference.

## Background imports

Import the findings, Add prospects, Merge duplicate identities, Consolidate pursuits,
Import Dakota, strategy moves, Affinity sync, network build and research export use background
jobs. On Postgres these run outside the Next process with independent pools. On PGlite they
run in worker threads inside the Next process, with database operations forwarded to its
single database worker. PGlite transactions still serialize database access; DB-free requests
and the parent’s active-job progress mirror remain available while they run.
The page polls `/api/import-jobs`. `platform.import_job` records `queued`, `running`,
`completed` or `failed`, phase, completed/total counters, heartbeat, result counts and a
sanitized error. Progress is phase-level except Dakota, which reports committed record batches.
Kinds are `findings`, `prospects`, `duplicates`, `pursuits`, `dakota`,
`strategy-moves`, `affinity`, `network` and `export`. The Postgres worker
uses an advisory lock for its job kind so repeated clicks or two server processes
cannot run that kind concurrently. The advisory lock must stay on one connection for the
whole job; releasing a pooled connection while retaining a session lock is unsafe.
PGlite uses its directory lock, a process-local launch guard and the same persisted
one-active-receipt-per-kind constraint. No separate process opens its database directory.

The parent starts only the job the human requested. Moving execution to a child grants no
new connector permissions: Affinity remains read-only, Dakota remains inside the private
system, and no workflow sends messages. A completed job means its operation finished, not
that an investor approved anything or that a workflow proposal was accepted.

This is local process supervision and database status, not durable cloud orchestration.
A normal server can recover a queued job; it marks a running job with a heartbeat older
than 60 seconds as failed only after confirming that its advisory lock is free. Interrupted
running work is never silently replayed. Rehearsal suppresses automatic recovery and Dakota
resumption; an explicit permitted action is required. Before retrying a failed or interrupted
job, inspect its progress and the operation's
idempotency rules. Do not assume a failed job rolled back every earlier committed batch.

## Copying a PGlite snapshot

The copy tool takes an explicit snapshot directory and an explicit Postgres URL. The
source is a **copy of the PGlite database directory**, not its parent data folder. It refuses
an actively locked source and refuses a non-empty target unless replacement is explicit.
Never use replacement against the live database. Stop all users of the disposable target
before replacing it.

Copying includes all application tables, migration ledger and sequence state. Rows are
copied in batches with dependency handling, then checked table by table using counts and
ordered-row checksums. The report contains identifiers, counts and checksums, never row
contents. A mismatch or copy failure blocks the switch. Keep reports about real snapshots
under the same private storage boundary as the source.

```sh
npm run pg:copy -- "$PGLITE_SNAPSHOT_DIRECTORY" "$REHEARSAL_DATABASE_URL"
# Explicitly replace only a disposable rehearsal database:
npm run pg:copy -- "$PGLITE_SNAPSHOT_DIRECTORY" "$REHEARSAL_DATABASE_URL" --replace
```

The tool creates a mode-0700 `.pg-copy-*` working directory beside the supplied snapshot
and removes it afterward. Replacement and copying run in one target transaction; checks
must match before commit. Checksums are SHA-256 over sorted SQL MD5 digests of each row's
JSONB representation, preserving duplicates and database timestamp precision. The source
snapshot must be closed, and its directory must have room for the private working clone.
The copy handles the application's enums, functions, tables, sequences, constraints,
indexes, views and triggers. Unsupported catalog features are refused explicitly: identity
columns, partitions, row security, domains/ranges, non-plpgsql extensions, materialized or
foreign tables, inheritance and aggregates. Owner/ACL and object comments are not copied;
verify destination ownership and grants before switching.

The tool is not a concurrent replication system. Stop the PGlite writer before taking the
snapshot: copying an open PGlite directory can capture inconsistent pages. Keep the original
PGlite database untouched. The copy tool opens a private working clone of the snapshot,
so PGlite's own startup/checkpoint writes do not alter the supplied snapshot.

## Rehearsal server

Use a dev worktree, a disposable local database named `plcos_rehearsal_<name>`, and a
non-live port. A real-snapshot rehearsal supplies the actual snapshot timestamp:

```sh
PORT=3218 npm run serve:pg -- "$REHEARSAL_DATABASE_URL" --snapshot-at "$SNAPSHOT_AT"
```

For an already populated invented-data database in the provided development cluster:

```sh
PORT=3218 npm run serve:pg -- postgres://plcos@127.0.0.1:5434/plcos_dev --demo
```

The launcher refuses the live checkout and live ports, binds `127.0.0.1`, isolates Next's
build directory, does not invoke a Keychain wrapper, and does not print the database URL.
Accepted database names are `plcos_dev`, `plcos_test_<name>`, and `plcos_rehearsal_<name>`.
It rejects non-loopback hosts and URL query overrides. The port defaults to this checkout's
preview port in `.ports.json`, or 3218 for an unregistered worktree.

`POSTGRES_REHEARSAL=1` suppresses automatic init and demo seeding. Populate the target with
the copy tool first. `--snapshot-at` selects the real profile and labels the page as a copy;
`--demo` selects the invented profile. Neither option takes a filesystem snapshot.

A database copy alone does not provide imports' file inputs, attachments, init configuration,
workflow manifests or local activity files. Claude must prepare an isolated private copy of
the required files under the rehearsal worktree's `data/real`, according to the existing
preview rules. That folder must not link to the live files. The launcher never copies or
opens the source folder itself. Keep real-snapshot screenshots and records out of git,
issues, agents' prompts and published artifacts. Explicit file-import actions are permitted against the Postgres rehearsal copy, including
Dakota; copied queued receipts are never automatically launched there. Rehearsal credentials
are omitted, so Affinity sync remains unavailable; test external sync execution separately
under the existing authorization and read-only rules.

## Switch runbook — Claude only, after rehearsal

1. **Prepare and record.** Integrate only after typecheck, boundaries, and both full property
   runs pass. Provision the private local Postgres 17 cluster. Record its loopback port,
   database name, code commit, migration inventory, backup locations, snapshot time and the
   intended rollback window privately. Confirm disk space for the original, snapshot, copy
   working directory and Postgres database. Keep the development cluster invented-only.
2. **Stop live.** Stop the live server and its import workers; verify no PGlite directory
   lock is held and no import is still writing files. Pause workflow imports for the switch.
3. **Snapshot PGlite.** Copy the complete stopped PGlite directory into a timestamped private
   snapshot directory. Leave the original database and all of its files untouched. Preserve
   the corresponding private file inputs separately. Do not manufacture an unlocked copy
   from a database whose writer is still running.
4. **Copy and verify.** Create a fresh empty target in the private local cluster. Run
   `pg-copy` on the snapshot; require matching counts and checksums for every table and a
   successful sequence/ledger check. Any failure stops the switch. An existing rehearsal
   database is disposable; a non-empty production target is a reason to stop and inspect.
5. **Rehearse.** Start the dev worktree with `serve:pg`, the copied database and snapshot
   timestamp. Run the verification below, including page reads during heavy imports. For
   the final switch, take a fresh stopped snapshot and copy again: never promote a database
   modified by rehearsal clicks or imports.
6. **Select Postgres.** In the live server's environment set `DATABASE_URL` to the verified
   local target. Unset `POSTGRES_REHEARSAL` and `PREVIEW_COPY_AT`. Preserve `DATA_PROFILE=real`
   through the existing real launcher and keep the private files at their existing paths.
   Do not put a credential-bearing URL into git or a public run log.
7. **Start and smoke.** Start the live server from the integrated master using the existing
   real-server launcher. Confirm the selected adapter, users/vehicles, headline totals,
   core pages and one reversible write. Check import status polling and page responsiveness.
   Keep workflow imports paused until the smoke check passes.
8. **Rollback if needed.** Stop the Postgres-backed server and all its workers. Unset
   `DATABASE_URL`, `POSTGRES_REHEARSAL` and `PREVIEW_COPY_AT`, then restart with the unchanged
   original PGlite directory and original private files. Verify the same smoke checks.
   Once Postgres has accepted writes, this restores the **pre-switch** state: it is not a
   lossless rollback. Before restarting PGlite, preserve Postgres and affected files, identify
   and reconcile every post-switch mutation, and avoid repeating non-idempotent actions.
   There is no automated Postgres-to-PGlite reverse copy in this preparation.

## Verification gates

- Run `npx tsc --noEmit`, `npm run boundaries`, `npm run props` with `DATABASE_URL` unset,
  and `DATABASE_URL=postgres://plcos@127.0.0.1:5434/plcos_test_props npm run props`.
  Never point destructive fixture tests at a real database or a copied real snapshot.
- Copy an invented fixture and verify every count/checksum, including empty tables, nulls,
  JSONB, arrays, timestamps, sequences, dependencies and the migration ledger. Confirm a
  repeated copy refuses the non-empty target and an active PGlite lock prevents copying.
- Verify that the original source snapshot's files remain unchanged and the copied ledger
  still passes immutable-migration checks. Compare SQL values at database precision: a JS
  `Date` loses sub-millisecond timestamp precision; unsorted rows and JSON object key order
  cannot be treated as stable output order.
- On the copied real snapshot, compare users, per-vehicle hard and soft totals, pipeline,
  LP identities, source freshness, routes, strategy, notes and relevant Dakota counts.
  Compare confidential details privately, not in the changelog.
- Run every listed heavy operation while repeatedly opening Today, Pipeline, Selection,
  a funder detail and Developer status. Record latency and failures. Check progress changes,
  successful results, a controlled worker failure, restart behavior and safe retry. Submit
  duplicate starts from two processes and prove only one writer for that job kind runs.
- Verify rollback before accepting live writes. Confirm the original PGlite still opens,
  and that the unset-URL path uses the PGlite worker without starting another server.

Preparation checks passed: **767/767 PGlite** and **779/779 Postgres 17.11** properties,
plus TypeScript and boundaries. The recorded details and remaining limitations are in
[the preparation changelog](changelog/entries/postgres-prep.md). A passing invented-data
suite is necessary; the private snapshot rehearsal and switch remain Claude's work.

## Running it day to day (Juan, 27 Sep 2026)

Live has run on Postgres since 27 Sep 19:57 UTC. `data/real/postgres.url` selects it; delete the file to go back to PGlite.
- **Starting:** `npm run dev:start` starts the cluster (`data/real/postgres`) if it's down. `npm run dev:real` also starts it if needed.
- **Restarts:** restarting or killing the dev server never stops Postgres.
- **Stopping:** `npm run dev:stop` (live folder only) stops the dev server, then Postgres. Use it when you stop development.
- **Checking:** `npm run dev:status` says what's running.
- **No login item:** nothing starts at boot. After a reboot, run `npm run dev:start` or `npm run dev:real`.

## Scope and access (Juan, 27 Sep 2026: "scope it just to this project … lock it down with auth")

**This project's own cluster.** It is not a machine-wide server. Its files are in `plcos-data/real/postgres`, it listens on 127.0.0.1:57433, and its socket lives in that folder, not `/tmp`. Homebrew's default cluster is never started. Another project runs its own cluster from the same binaries: `initdb -D <its folder>`, a different port, and its own `pg_ctl`. Astra's test cluster (`plcos-pg-dev`, port 5434, invented data only) is separate again.

**Roles.** Each role's password is in the login Keychain under service `plcos-postgres`, with accounts `app`, `ro` and `admin`. No password is ever written in a file.

| Role | Can | Used by |
|---|---|---|
| `plcos_app` | Owns every schema and table in `plcos_live`; no superuser | The live server. The launcher sets `PGPASSWORD` from the Keychain; `postgres.url` names the role only. |
| `plcos_ro` | `SELECT` on every table and sequence, including future ones via default privileges | Scripts, agents and backups (`pg_dump`). Writes are refused. |
| `plcos` | Superuser (the bootstrap role) | Admin by hand only |

**Authentication.** `pg_hba.conf` requires SCRAM passwords for every connection, loopback only. The old trust file is kept as `pg_hba.conf.trust.bak`.

**New schemas.** A migration that creates a new schema must grant `plcos_ro` usage on it; the default privileges cover tables inside existing schemas only.

**Backups.** `npm run backup` dumps `plcos_live` with `pg_dump -Fc` as `plcos_ro` and skips the stale PGlite folder. The first dump backup was 624 MB, against 2 GB for the PGlite clones.
