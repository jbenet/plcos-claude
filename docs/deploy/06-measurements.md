# 06 — Demo production measurements (B1)

28 September 2026. **Partial: build and tracing measured; HTTP runtime and Postgres measurements blocked by the execution sandbox.** This is not a staging capacity sign-off. No real records, secrets, external services, or live server were used. No page design changed.

## Scope and reproducibility

Work envelope: measure a demo production build and invented import fixtures; change tracing configuration, its guard/properties, and this report only. Allowed evidence: tracked code, installed dependencies, isolated demo output and test databases. Allowed commands: local build/start, tests, tracing audit and resource measurement; no fetch/pull/push or real-data access. Budget: this bounded session; deadline: handoff to Claude. Acceptance: measured numbers with limitations, forbidden-path checks, both backend suites attempted, committed report. Escalation owner: Juan/Claude for runtime execution permissions. B1 remains incomplete until the blocked measurements below are filled in.

Source baseline: `670dbcb7bee6e41224d614279ef27cd31a2c47c5`, plus this branch's tracing changes. A `git archive HEAD` was extracted into a new `/tmp/plcos-prod-build-*` folder; only task changes were overlaid. Dependencies were APFS-cloned from the installed local dependency tree, without network access. No data directory or environment file was copied. The successful clean build began with no `.next` directory.

Environment: macOS 15.1.1 arm64, Node 26.0.0, Next 16.3.5 (Turbopack), React 19.3.0, PGlite 0.5.8, pg 8.23.0. Lockfile SHA-256: `d534954522761a7db003de3638a1d5404090abb7a6d3f42ff0f1e67e3b1838e8`. Local machine, unrestricted CPU for the build, no container memory limit. Other local work/property tests could contend for CPU; these timings are not single-core platform predictions.

Build environment explicitly set `DATA_PROFILE=demo`, `DATABASE_URL=postgres://plcos@127.0.0.1:5434/plcos_test_prod`, and `NEXT_TELEMETRY_DISABLED=1`. Build success does **not** prove database connectivity: pages are dynamic and the build did not seed or connect to that database.

## Build results

| Run | Elapsed | Peak child-process RSS | Logical `.next` output | Result |
| --- | ---: | ---: | ---: | --- |
| Clean `next build`, empty `.next` | 9.974 s | 1,934,442,496 B (1,844.8 MiB / 1.80 GiB) | 319,459,367 B (304.7 MiB), 2,606 files | Exit 0 |
| Earlier warm retry | 6.390 s | 1,970,814,976 B (1,879.5 MiB / 1.84 GiB) | 337,029,684 B (321.4 MiB), 2,616 files | Exit 0 |

Elapsed time used Python `time.monotonic()` around a waited child; RSS used `resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss` in a fresh Python process (bytes on macOS). The clean run invoked `node node_modules/next/dist/bin/next build`, the same Next build as the npm script. RSS is the largest child-process high-water mark, **not the simultaneous sum of the build process tree**, page cache, or container memory. Output is summed file sizes, including build cache; it is not a deploy ZIP or standalone image size. The tracing audit is separate from these timings.

An initial exclusion `../plcos-data/**` was rejected by Turbopack because it escapes the project root; it was removed before the successful runs. The remaining exclusions are root-relative. `/usr/bin/time -l` could not report resources (`sysctl kern.clockrate: Operation not permitted`), so its RSS was not used.

## Runtime results and explicit gaps

| Requested measurement | Postgres demo | PGlite demo |
| --- | --- | --- |
| Fresh demo database + production server | Blocked before database creation/seed | `next start` blocked before listening |
| Idle Next RSS | Unavailable | Unavailable |
| Every-page walk, 10 concurrent for 300 s | Not run | Not run |
| Per-page p50/p95, request/status counts | Unavailable | Unavailable |
| RSS under load / post-load recovery | Unavailable | Unavailable |
| Observed database connections | Unavailable | Not applicable |
| Import-job **child process** RSS during browsing | Unavailable | PGlite uses worker threads, not that Postgres child |
| 384 MiB enforced runtime cap | Not run | Not run |

Evidence: `psql` and the Postgres property suite return `connect EPERM 127.0.0.1:5434`. Both `npm start` attempts return `listen EPERM` creating tsx's IPC socket. Direct `node .../next start -H 127.0.0.1 -p 3215` also returns `listen EPERM`, confirming that avoiding the CLI IPC socket does not make HTTP available. The launcher labels any failed bind as a busy port; that message alone is not evidence of another server. No long-lived server or database was started by these attempts.

Pool configuration, **not a measurement**: `lib/db/postgres.ts` allows 8 foreground connections. `scripts/import-worker.ts` permits 2, plus its separate advisory-lock connection: a configured ceiling of 11 for one foreground pool plus one import child. Other workers/processes can add their own connections; do not treat 11 as a measured whole-app maximum.

## Supplemental PGlite import measurement

The existing `scripts/profile-import-threads.ts` ran successfully against its own temporary, invented fixture. It creates 1,100 people, imports 1,100 prospect rows, merges 100 identity pairs and 100 pursuit groups, then exports and builds the network. All five jobs reported `completed`.

Default-heap run: **31.268 s, 1,253,490,688 B peak RSS (1,195.4 MiB / 1.17 GiB)**. Individual job times: prospects 6,986 ms; duplicate merges 342 ms; pursuit merges 1,008 ms; export 543 ms; network 20,343 ms. RSS includes the PGlite driver and worker threads in that process. This is neither a Next HTTP measurement nor Postgres import-child memory, and the fixture is larger than the basic demo seed.

With `node --max-old-space-size=256 --import tsx scripts/profile-import-threads.ts`, all five jobs also completed: **32.688 s, 1,243,873,280 B peak RSS (1,186.2 MiB / 1.16 GiB)**. The 256 MiB V8 old-space limit did not bound whole-process RSS to 384 MiB. No cgroup-like RSS enforcement was available in this session.

## Tracing boundary

`next.config.ts` excludes `data/**`, `**/data/**`, `issues/inbox/**`, and `**/plcos-data/**` for all routes. `npm run build` now runs `npm run build:traces` after Next succeeds. The guard also accepts an explicit output directory:

```sh
npm run build:traces -- /path/to/isolated-build/.next
```

It audits every `*.nft.json` entry, resolved relative to its manifest, and all output paths, including a standalone subtree if present. It refuses lexical paths, symlink targets, chained/dangling aliases, traversal through aliases, and case variants under `data/real` or `plcos-data`. It inspects link metadata before accessing destinations and never opens a forbidden file. Missing, empty, malformed and unknown-version inventories fail closed. Diagnostics contain counts, not private filenames.

The clean production output passed: **94 manifests, 180,204 traced entries, 0 forbidden paths, 0 malformed inventories**. Counts include repeated dependencies across manifests. The audit also follows safe output symlinks; its file count can therefore exceed a plain directory walk.

This build uses Next's ordinary output; no standalone artifact was generated or smoke-tested. Standalone leaks are covered by invented guard fixtures. The clean archive prevents real bytes from entering the build in the first place; tracing exclusions and a path audit do not detect private content copied under an unrelated filename. Continue to build from a clean tracked-file tree and audit the final packaging step separately.

## Recommendation for PL

Retain **2 GiB runtime / 1 CPU as a provisional request**, with imports on the Mac, pending the Postgres runtime run. There is no measured Next idle/load number in this report that establishes the right runtime allocation. The PGlite import fixture exceeds 384 MiB by over three times; it demonstrates why a small V8 heap is not a process-memory budget, but cannot size a pg-backed team-only server.

For builds, request **4 GiB headroom or use a clean prebuilt artifact** (engineering headroom, not a measured requirement). A single process already reached about 1.84 GiB; the 2 GiB platform budget covers the entire container, not just that process. These measurements do not prove the build fits 2 GiB, nor establish the earlier plan's 2.5 GB observation as a universal floor. A macOS prebuild is not automatically Linux-compatible: package native dependencies for the target architecture and validate the final image there.

The existing **10 GB database-storage request is unchanged and unvalidated here**. This task accessed no real database and provides no new storage evidence. Do not deploy on the strength of this partial run.

## Claude's completion steps (demo only)

Run in a session permitted to connect/listen locally; no live-data operation is required.

1. Make a new clean tracked-file build tree with this commit and installed dependencies; never copy `data/real`, `plcos-data`, or environment files. Create `plcos_test_prod` on the **dev** cluster at `127.0.0.1:5434`; creation should fail if it already exists, so any replacement is deliberate. Set `DATA_PROFILE=demo` and that exact `DATABASE_URL`. Run `npm run db:seed`, then `npm run build`. For PGlite use a separate fresh demo directory with `DATABASE_URL=''` and `PGLITE_DIR=<fresh-demo-path>`.
2. Start each backend separately with `PORT=3214` (pg) or `3215` (PGlite), `npm start`. Verify those ports are available first. Measure after initial database boot/seed and warmup. Record the Next PID and all descendant PIDs; sample individual and summed RSS at least every second, including a 60-second idle and post-load interval.
3. Inventory every `app/**/page.tsx`. Map static pages through `canonicalPath` in `lib/paths.ts`, enumerate the demo vehicles, and supply seeded IDs for dynamic detail routes. Walk all pages once, then loop the complete list with 10 concurrent requests for 300 seconds, consuming entire response bodies. Report per-route p50/p95, counts and status failures; distinguish expected demo-empty/404 cases from successful page coverage. This is a server-response test, not browser hydration or client-render performance.
4. During pg load, run one actual invented import through `createImportJob` and `scripts/import-worker.ts`, then verify its terminal status/result. A `strategy-moves` job uses `fixtures/strategy-moves.json`; a tiny fixture is only a lower bound. Sample the child RSS separately and include it in total process-tree RSS. Poll `pg_stat_activity` scoped to the exact test database, excluding the observer connection; record idle/load/import counts rather than the configured maxima above.
5. Repeat with `NODE_OPTIONS=--max-old-space-size=256`. A heap limit is not an RSS cap. The requested 384 MiB cap needs a Linux/container memory limit or an explicitly labelled sampled RSS watchdog; neither is claimed by this Mac session. Record termination, request failures and recovery, not just the successful prefix of a run.
6. Run both property suites and update this report with observed runtime numbers before presenting a final resource ask. No live migration, seed, restart or secret change is required for this branch.

## Checks

- `npm run props`: **1,027 / 1,027 pass**, including 19 tracing cases.
- `DATABASE_URL=postgres://plcos@127.0.0.1:5434/plcos_test_prod_build npm run props`: blocked before any properties execute (`connect EPERM`), **0 executed; not a pass**.
- `npx tsc --noEmit`: pass.
- `npm run boundaries`: pass, 757 source files and 297 screenshot assets checked.
- Clean demo `next build`: pass. Full `npm run build` with its post-build tracing gate also passed on the isolated demo tree (94 manifests, 180,204 entries, no violations).
- `git diff --check`: pass.

The missing pg suite, HTTP measurements, pool observation, import-child measurement and capped runtime test are required follow-up, not waived acceptance criteria.

## 28 September 2026 (follow-up) — runtime measurements complete

This session was permitted to bind and connect locally, so it completes the "Claude's completion
steps" above. **Invented/demo data only**, throughout: `data/demo/database` (PGlite) and a
just-created, just-dropped `plcos_test_measure` database on the shared **dev/test** Postgres
cluster at `127.0.0.1:5434` (never `data/real`, `plcos-data/real`, port 3000/3001, or the real
cluster at `57433`). Work envelope: measure demo production RSS and latency, idle and under a
10-way/3-minute page walk, on both backends, plus one demo import job's child RSS against
Postgres; change this report and the wishlist's memory rows only; no fetch/pull/push. Budget: one
bounded session; deadline: this handoff. Escalation owner: Juan/Claude.

Same source baseline as above (`35db4f8` on `claude/main`, no code changes this pass), same
lockfile SHA-256 (`d534954522761a7db003de3638a1d5404090abb7a6d3f42ff0f1e67e3b1838e8`), same
dependency versions (Next 16.3.5 Turbopack, React 19.3.0, PGlite 0.5.8, pg 8.23.0). `node_modules`
came from `npm ci` in the worktree — a symlink to a sibling checkout's `node_modules` was tried
first, but Turbopack refuses a `node_modules` symlink that resolves outside the project root
(`Symlink [project]/node_modules is invalid, it points out of the filesystem root`), so this
worktree got its own install. Machine: Apple M3 Max, 16 logical CPUs, 48 GiB RAM, macOS 15.1.1
(24B91), Node v26.0.0 (`sysctl hw.model hw.ncpu hw.memsize machdep.cpu.brand_string`, `sw_vers`).
No container memory limit; other local work can contend for CPU, so timings are not a single-core
platform prediction.

### Build

A clean `rm -rf .next` followed by `DATA_PROFILE=demo NEXT_TELEMETRY_DISABLED=1 npm run build`
(which chains `next build && npm run build:traces`), wrapped in `/usr/bin/time -l` for rusage:

| Metric | Value |
| --- | --- |
| Elapsed | 84.92 s real (81.97 s user, 52.73 s sys) |
| Peak child RSS (`ru_maxrss`, largest single process in the tree) | 2,170,191,872 B — **2,069.7 MiB / 2.02 GiB** |
| `.next` output | 317 MB, 2,736 files |
| Build-traces guard | 94 manifests, 194,067 entries, 0 forbidden paths, 0 violations — pass |

This exceeds the two builds in the partial run above (1.80 GiB and 1.84 GiB) and took far longer
than the 9.974 s/6.390 s recorded there; both prior runs may have hit warm OS/module caches this
clean run did not. Treat 2.02 GiB as the current best measured peak, not a ceiling — build memory
depends on what changed. `ru_maxrss` is still the largest single process, not the summed tree.

### HTTP walk: page list, method, and per-backend results

Every `app/**/page.tsx` was inventoried (`lib/paths.ts` route table, `fixtures/vehicles.json` for
vehicle slugs). The walk hits 31 GET routes: `/today`, `/orgs/g/lps`, `/developer/enrich`, and
`{pipeline,selection,strategy,overview}` for each of the 7 demo vehicles (`neurotech`, `rails`,
`spv-cortex`, `spv-lattice`, `spv-halo`, `spv-meridian`, `grants` — `fixtures/vehicles.json`).
Vehicle module addresses are proxy-rewritten server-side (`proxy.ts` + `lib/paths.ts`
`MODULE_PAGES`) to flat pages (e.g. `/neurotech/pipeline` → `/targets`); `strategy` is served
directly from `app/[vehicle]/strategy`. No cookie or user-switcher setup was needed: an
unauthenticated request falls back to the first seeded demo user (`lib/auth/local.ts`).

A small Node script (`fetch`, no dependency added) sent 10 concurrent workers in a tight
round-robin over the 31 pages for 180 s per backend, recording per-page latency and status;
`redirect: 'manual'` so a 307 counts as itself, not as a followed 200. In parallel, a Python
sampler summed `ps -o rss=` over the whole descendant tree of the launcher PID once per second.
Both backends used the same `.next` build (the demo profile's dist dir does not depend on
`DATABASE_URL`, only `DATA_PROFILE`, so no separate PGlite/Postgres build was needed). All 31
pages were curled once first to warm compilation/caches before every measurement window.

**PGlite** (`PORT=3110 DATA_PROFILE=demo npm start`, default `./data/demo/database`, freshly
reset+seeded — 5 users, 7 vehicles, 5 sources):

| Window | RSS |
| --- | --- |
| Idle, 60 s post-warmup | 385.7–421.6 MiB, avg 409.0 MiB |
| Peak during the 180 s / 10-way walk | 861,600 KiB — **841.4 MiB (0.822 GiB)** |
| Plateau near the end of the walk | ~816.3 MiB |
| Post-load, 60 s (recovery) | 800.6 MiB → **366.6 MiB** by second 60 |

Load result: **14,927 requests, 0 errors, 82.93 req/s**, all 200s. Slowest pages: `/developer/enrich`
(p50 212.5 ms, p95 226.5 ms), the four `strategy` pages (p50 178–192 ms, p95 197–215 ms), then
`overview` (p50 130–151 ms, p95 152–167 ms); `pipeline`/`selection` were fastest (p50 67–78 ms, p95
78–90 ms); `/today` and `/orgs/g/lps` were ~107–137 ms p95. Full per-page numbers are in
`/tmp/measure-logs/load-pglite-results.json` (this machine, not committed — ephemeral).

**Postgres** (`PORT=3111 DATA_PROFILE=demo DATABASE_URL=postgres://plcos@127.0.0.1:5434/plcos_test_measure npm start`
— an empty database created for this run only, migrated and demo-seeded automatically on first
boot by the same `getDb()`/`boot()` path the server always uses, dropped again at the end):

| Window | RSS | Postgres connections (`pg_stat_activity`, this DB) |
| --- | --- | --- |
| Idle, 60 s post-warmup | 189.6–246.0 MiB, avg 221.9 MiB | 0 (pool's 30 s `idleTimeoutMillis` had already closed them) |
| Peak during the 180 s / 10-way walk | 758,720 KiB — **741.0 MiB (0.724 GiB)** | 8 (the configured foreground pool max, `lib/db/postgres.ts`) |
| Post-load, 60 s (recovery) | 582.4 MiB → **240.4 MiB** by second 60 | 0 |

Load result: **25,089 requests, 0 errors, 139.38 req/s** — notably higher throughput and lower
latency than PGlite at the same concurrency (e.g. `/developer/enrich` p50 151.5 ms/p95 183.1 ms vs.
212.5/226.5; the `strategy` pages p50 66–102 ms/p95 86–140 ms vs. 178–192/197–215; most other pages
under 100 ms p95). This one machine, one run: real Postgres served this walk faster than PGlite's
in-process engine at 10-way concurrency, plausibly because PGlite serializes more under concurrent
access than a real backend with a real connection pool — not yet confirmed across repeated runs.

Both backends: **zero request errors or non-200s across both 180 s runs** (40,016 requests total).

### Import-child RSS (Postgres only — PGlite has no such child)

`scripts/import-worker.ts` requires `config.db.url` and a queued `platform.import_job` row; it
does not run against PGlite (that path uses in-process worker threads instead, per the gap table
above). A `strategy-moves` job (`fixtures/strategy-moves.json`, wholly invented) was queued via
`createImportJob` against `plcos_test_measure` while the Postgres 10-way walk above was still
running, then the worker was launched exactly as `launchImportJob` does — same script, same args,
same `PLCOS_IMPORT_WORKER=1` env — but wrapped directly in `/usr/bin/time -l` so a short-lived
process's peak is still captured:

| Metric | Value |
| --- | --- |
| Elapsed | 0.17 s |
| Peak RSS (`ru_maxrss`) | 80,855,040 B — **77.1 MiB** |
| Peak memory footprint | 43,445,440 B — 41.4 MiB |
| Result | `completed` |

This fixture has 1 move across a few vehicles — a **lower bound only**, smaller and structurally
different from the 1,100-record PGlite fixture in the section above (1.17–1.25 GiB, which includes
PGlite's own embedded engine and worker threads, not a Postgres child). Neither figure sizes a
Postgres-backed worker doing a realistically large import (e.g. a full Affinity or Dakota sync);
that remains unmeasured. Both are real measurements of different things — do not average them.

### Checks (this pass)

- `npm run props`: **1,107 / 1,107 pass**.
- `npx tsc --noEmit`: pass.
- `npm run boundaries`: pass — 63 authorized actions, 13 authorized handlers, 801 files checked,
  297 screenshot assets.
- `git diff --check`: pass.
- Every server started this pass (PIDs and their full descendant trees) was sent `SIGTERM` and
  confirmed gone; `plcos_test_measure` was dropped; ports 3110/3111 and the scratch database are
  free again. Ports 3000, 3001 and 57433 were never touched.

### What is still not measured

- A realistically-sized import against Postgres (the fixture above is a lower bound by design).
- The 384 MiB enforced-runtime-cap / `NODE_OPTIONS=--max-old-space-size` test: still needs a
  Linux/container memory limit or an explicit RSS watchdog, which this Mac session has neither;
  cgroup-limited behavior (OOM-kill vs. graceful degradation) is unproven. Note that the observed
  peaks above (741–841 MiB) already exceed 384 MiB before any cap is even applied.
- Sustained (>3 minute) behavior, multi-hour soak, and repeated runs for variance — this is one
  180 s sample per backend, not a distribution.
- Client-side render/hydration cost: this walk measures server response time only.

## Real-volume rehearsal (28 September 2026, Claude)

What was run: `plcos_live` dumped as `plcos_ro`, restored into a scratch `plcos_rehearsal` on the same
local cluster (57433), served by a `git archive claude/main` production build (`8e565d0`) with
`DATA_PROFILE=real`, `NEXT_DIST_DIR=.next`, and a stand-in LabOS `/me` on 127.0.0.1:3299 (two invented tokens).
Working files were copied into a private rehearsal folder and linked in as `data/real`; the config has no
env override for the data root (it is `data/<profile>` under the working directory), so the container's
volume must mount at `/app/data`. No connector was called, `SCHEDULE_DAILY_AT` was unset, the live server
and `plcos_live` were not written. Everything was deleted afterwards (database dropped, dump, copy and
build removed). This section contains counts, timings and function names only. Machine: M3 Max, 16 CPUs, 48 GiB.
The live server kept running throughout, so its imports shared the machine.

### Cutover legs

| Leg | Result |
|---|---|
| `pg_dump -Fc` of `plcos_live` (1,449 MB on disk) | **15.3 s**, 199.6 MB file, pg_dump RSS 181 MiB; 119 tables in `--list` |
| `pg_restore --no-owner --no-acl --exit-on-error --single-transaction` | **39.5 s**, restored database 1,053 MB |
| Row counts, 119 tables, 1,214,017 rows | all 119 equal the counts taken just before the dump; one cache table (`network.route_cache`) had changed on live by the time the dump ended |
| `scripts/pg-verify.ts` (live vs. restored, both as `plcos_ro`) | **38 s**, 216 MiB; MISMATCH on 3 tables only (`route_cache`, `route_warmup`, `import_job`), all written by live after the dump (live was not frozen); objects, sequences, indexes, constraints all equal |
| Working files to copy | **2,119 MiB, 33,132 files** after excluding `postgres/`, `database/` (6.9 GB PGlite), `dakota/`, `logs/`, `postgres.url`, and the hidden `.real-copy-rehearsal` / `.real-copy-switch` snapshots (6.9 + 7.0 GB) |
| Dakota in the database | `dakota` schema: 7 tables, 19,571 rows; plus 14,353 `identity.source_record` rows with source `dakota` |
| A copied `import_job` row in `running` | blocks that job kind on the target until failed by hand |

### Build (`git archive` → `npm ci` → `next build` with `DATA_PROFILE=demo`, as the Dockerfile)

npm ci 3 s (warm cache). `next build` **81 s and 73 s** (two clean builds); summed process-tree peak RSS
**3.53 GiB and 2.13 GiB**. Build-traces guard: 95 manifests, 198,385 entries, 0 violations.
Starting that build with `DATA_PROFILE=real` fails: Next looks for `.next-real` (next.config.ts
`distDir`), so the runtime needs `NEXT_DIST_DIR=.next`.

### Pages at real volume (6 vehicles, 27 GET routes: `/today`, `/orgs/g/lps`, `/developer/enrich`, and overview/pipeline/selection/strategy per vehicle)

- `/health` 200 in 1–5 ms, ready in under 1 s. `/` with no cookie or an unknown token: the LabOS sign-in text,
  HTTP 200, 57 ms.
- Token 1 (unknown uid): a new `viewer` row was created (`labos-…` handle). Every page returned 200, but in
  **12.5–13.8 s** each: `scopedReadData` runs its Affinity-note metadata query
  (`lib/authz/read/scoped-data.ts:23`) on every page for restricted users.
- Token 2 after `labos_uid` was set on the admin row: admin. Sequential walk 16 ms–2.3 s, but
  `/developer/enrich` returned **500 every time** (`DbBusyError`).
- Cause: `resolveLabosUser` (`modules/platform/repo.ts:31`) runs `insert … on conflict do nothing` on every
  request. The statement-level trigger on `platform.app_user` bumps `network.read_revision` on each one
  (one enrich request moved it by 53), so `buildCache`'s revision check fails, retries twice and gives up.
- **10-way, 180 s, as admin, current code:** 1,734 requests, **438 non-200 (25%)**, peak RSS **1.21 GiB**.
- During the findings import the same insert waited on the row lock the import held on the admin row: pages
  took 20 s (the statement timeout), then 500.
- **Same walk with a local, uncommitted patch** (select first, insert only when unknown): **4,811 requests,
  0 errors**, 26.7 req/s, peak RSS **1.25 GiB** (1,315,904 KiB), idle 75–78 MiB before and 351 MiB 60 s after.
  p50 by page 65–1,163 ms, p95 240–1,460 ms. The heaviest were the first vehicle's strategy (p50 1.16 s),
  pipeline (0.91 s) and selection (0.80 s), and `/developer/enrich` (p50 0.77 s, p95 1.24 s).
  A 2-way walk during the import: 749 requests, 0 errors.
- Writes: a POST to `/api/identity/entity-type` as admin returned **403 "Change real data on the live
  server."** Outside the live folder's `.ports.json` row (the container's `/app` has none), every real-data
  write, the Linear and Dakota jobs, and the recovery of queued jobs are refused.

### Imports (worker launched as `launchImportJob` does, wrapped in `/usr/bin/time -l`)

| Job | Duration | Child peak RSS |
|---|---|---|
| Export the research set | **149 s**, completed (live's last run: 117 s) | **603 MiB** |
| Import the findings | **stopped at 30 min**, still in "Rebuilding research ties" | **2.43 GiB** (process tree) |

The findings phases took: repair and importing findings ~180 s, re-point and SPV stance ~30 s, and
`buildNetwork` from about 212 s on.

### buildNetwork profile (real volume)

Two CDP CPU profiles (1 ms sampling): the findings import's worker (30 min), and `buildNetwork({awaitBackground:
true})` alone through a small tsx script on the worker's kind of handle (20 min). Line numbers are the original
TypeScript lines, mapped through tsx's source maps. Async frames lose their callers after an `await`, so the
call paths are given from the code where the profile cannot show them.

**Phase 1: identity resolution, about 13 minutes, 98–99% idle.** Busy time per minute was 1–2%, and
no SQL was active when sampled. The time goes to `resolveIdentities` → `resolvePass`
(`modules/identity/resolution.ts:69`), whose loops `await pause()` (`resolution.ts:23`, a 50 ms
`setTimeout`) every 50 groups (`:161`) and every 50 comparisons (`:165`), from `config.identityResolution`
`{batchSize: 50, pauseMs: 50}` (both GUESS). That pacing was meant to yield to page requests. In the import
child it only adds sleep. CPU time in this phase: `identityEvidence` (`modules/identity/resolution-input.ts:7`)
5.9 s, its callback at `:53` 1.3 s, `importNetworkNodes` (`modules/network/nodes.ts:225`) 1.3 s.

**Phase 2: route precompute, 94–100% CPU (the state live was seen in).** Call path:
`buildNetwork` (`modules/network/build.ts:65`) → `precomputeRoutes` (`modules/network/cache.ts:169`), then for
each of **5,418 targets** → `calculateRoutes` (`modules/network/service.ts:66`) → `enumeratePathsFromSources`
(`modules/network/repo.ts:129`, which calls it at `:140` and `:142`) → `pathsFromSnapshot`
(`modules/network/path-search.ts:131`).

| # | Self time (findings run, warmup window / alone, whole run) | Function |
|---|---|---|
| 1 | 670.3 s, 84.1% / 294.9 s, 24.6% | `pathsFromSnapshot` `modules/network/path-search.ts:131`: the 3-hop loop (source → first edge → every neighbour of that node → tails); the 300-path cap only stops it when paths are found |
| 2 | 64.4 s / 42.0 s | `(program)` (V8 and native) |
| 3 | 17.4 s / 820.7 s | `(idle)`: in the alone run this is phase 1's pauses |
| 4 | 18.1 s whole run / 7.0 s | `(garbage collector)` |
| 5 | 10.6 s / 5.1 s | `runMicrotasks`, resuming after `yieldRouteWork` (`path-search.ts:15`, a `setImmediate` each ≥12 ms slice) |
| 6 | 6.6 s / 3.7 s | `needsYield`, anonymous at `path-search.ts:137` ← `pathsFromSnapshot` |
| 7 | 5.9 s (alone) | `identityEvidence` `modules/identity/resolution-input.ts:7` ← `buildNetwork` `build.ts:65` |
| 8 | 1.3 s | `importNetworkNodes` `modules/network/nodes.ts:225` (callback `:287`, 0.8 s) ← `build` `build.ts:107` |
| 9 | 1.3 s | anonymous `modules/identity/resolution-input.ts:53` ← `identityEvidence` |
| 10 | 1.2 s / 1.0 s | `sourceEdges` `modules/network/repo.ts:246` |
| 11 | 1.1 s / 0.8 s | `calculateRoutes` `modules/network/service.ts:66` |
| 12 | 0.8 s | `parseRow` `pg/lib/result.js:63` (reading rows) |
| 13 | 0.8 s | `decode` `modules/network/cache.ts:46` ← `cache.ts:111` |
| 14 | 0.7 s / 0.6 s | `edgesByIds` `modules/network/repo.ts:67` |
| 15 | 0.6 s | `enumeratePathsFromSources` `modules/network/repo.ts:129` |

The warmup rate was 367 targets in 802 s in the findings run (2.2 s each) and 330 in 380 s alone (1.15 s each).
At 5,418 targets, **the precompute alone projects to 1.7–3.3 hours**, after about 13 minutes of paced
identity resolution. That matches live's 100+ minutes at ~100% CPU in "Rebuilding research ties".
`pathsFromSnapshot` is where to optimise: bound the hub expansion in the 3-hop loop, or skip targets
with no tails early.

### What this rehearsal did not cover

A restore over the network into RDS; the container itself (no Docker here) and its memory limit; Kaniko's
2 GiB/1 CPU build; a finished findings import at real volume.

## Rehearsal 2 (strip + fixes) (28 September 2026, Claude)

What was run: `plcos_live` dumped as `plcos_ro` (an import was running on live; live was only read), restored as
`plcos_app` into a scratch `plcos_rehearsal2` on the same cluster, frozen, stripped of Dakota as
`scripts/cutover.sh` step 6 does, copied jobs stopped, thawed. Then a `git archive claude/main` build (`5b67946`)
served it with `next start`, `DATA_PROFILE=real`, `NEXT_DIST_DIR=.next`, a stand-in LabOS `/me` (two invented
tokens) and the runbook §3c working-file set copied into a private folder and linked as `data/real`. No connector
was called; no key was in the server's environment. Everything was deleted afterwards (database dropped, dump,
copy, scripts and build removed). Counts, timings and table names only.

### Cutover legs

| Leg | Result |
|---|---|
| `pg_dump -Fc` as `plcos_ro` (1,467 MB database) | **15.7 s**, 213 MB file, RSS 205 MiB; 119 tables of data listed = 119 tables |
| `pg_restore --no-owner --no-acl --exit-on-error --single-transaction` as `plcos_app` | **37.3 s**, restored database 1,080 MB, 119 tables, 1,214,359 rows |
| Working files (runbook §3c exclusions) | `rsync` **14 s**, 2,126 MiB, 33,385 files |

### Dakota strip (`scripts/strip-dakota.ts`, exactly as `cutover.sh` runs it on the frozen target)

**It stopped, in 1.3 s, with the target still read-only** — not on ambiguous provenance but on an ordering bug in
the LP re-point undo. The script's own output is the generic "strip-dakota failed; transaction rolled back"; a
wrapper printing only the error's code/table/constraint showed `23503` on `strategy.pursuit_contact`
(`pursuit_contact_pursuit_id_fkey`), raised by `restoreChanges` while deleting an organisation pursuit a re-point
had created.

Cause: 17 re-points match the strip's selection (all by the Dakota reason text; 0 `identity.affiliation` rows
have source `dakota`). They share only **3 distinct `created_at` values** (written in batches, one transaction
timestamp each), so `order by created_at desc, id desc` falls back to random uuid order within a batch. The 4th
re-point in that order created an org pursuit that two re-points of the **same timestamp**, undone later in that
order, had added contacts to. Undoing "newest first" is not actually newest first. Fix needed: undo in true
application order (a sequence or `clock_timestamp()` column, or the journal's own order), or retry FK-blocked
undos after the others.

To measure the rest, a local copy of the script (rehearsal-only, not committed) retried FK-blocked undos after
the others (2 passes, 1 deferred) and was otherwise identical. That run **committed in 479 s** (repoints 1 s,
`strip-dakota.sql` 478 s, one transaction, client RSS 86 MiB); none of the SQL's review stops fired (mixed
prose, mixed inference/journal provenance, unhandled JSON or scalar provenance). `stop-cutover-jobs.sql` then
failed 1 copied `running` job.

| Table | Before → after |
|---|---|
| `dakota.account` / `contact` / `claim` / `identity_revision` / `replica` (`employment`, `translation_job` 0) | 5,100 / 9,253 / 5,215 / 1 / 2 → 0 |
| `identity.source_record` | 124,362 → 110,009 (−14,353) |
| `identity.external_identifier` | 14,644 → 0 (all were Dakota) |
| `identity.possible_match` | 64,736 → 3,079 (−61,657) |
| `identity.match_assertion` | 4,672 → 4,254 (−418); 418 merge redirects cleared |
| `strategy.pursuit` | 6,871 → 6,557 (302 Dakota pursuits, 12 org pursuits created by undone re-points) |
| `strategy.lp_repoint` / `pursuit_contact` / `pursuit_owner` / `pursuit_update` | −17 each |
| `strategy.spv_evidence` | 884 → 797 (−87) |
| `platform.audit_log` | 6,513 → 6,495 (−18) |
| `network.route_cache` | 7,257 → 0 (recomputable) |
| All other tables | unchanged; total rows 1,214,359 → 1,095,972 |

Independent check afterwards: every text/enum column named like `source`/`origin` (plus `kind`, `action`,
`evidence_ref`, `evidence_kind`, `provenance_note`, `aum_basis`) and every JSON column scanned for a
`source`/`origin`/`file`/`*_source` key valued Dakota: **0 rows** (before: 8 scalar and 2 JSON columns, led by
61,657 `possible_match.signals` and 14,644 identifiers). Names survived: `identity.entity` 18,599 orgs and
98,950 people before and after, all named; unmerged rose by 193 orgs and 225 people (the cleared redirects).

### Build (`git archive` → `npm ci` → `npm run build` + `check-build-traces`, Dockerfile env)

npm ci 3 s (warm cache). Build plus traces check **139 s** wall; largest process RSS **2.0 GiB**; traces check
95 traces, 201,813 entries, 0 violations. 24 warning lines (Turbopack tracing), no errors.

### Pages (`next start`, ready in 0.65 s at 143 MiB)

No cookie: the LabOS sign-in text. Unknown uid: a new `viewer` row (once). Mapped uid: admin.
Sequential, 1 warm-up + 8 timed per page, 27 pages (`/today`, `/orgs/g/lps`, `/developer/enrich`,
overview/pipeline/selection/strategy × 6 vehicles), all 200:

| Role | p50 | p95 | Slowest |
|---|---|---|---|
| admin | 13–329 ms | 15–347 ms | largest vehicle's strategy (329 / 347 ms); `/developer/enrich` 269 / 279 ms |
| viewer | 199–745 ms | 203–770 ms | LP stats (745 / 770 ms); every non-strategy page ~0.5 s (was 12.5–13.8 s) |

10-way, 180 s walks over the same 27 pages:

| Walk | Requests | Non-200 | Rate | p50 / p95 by page | Peak RSS (process tree) |
|---|---|---|---|---|---|
| all admin | 6,215 | **0** | 34.5/s | 39–1,205 ms / 112–1,284 ms (largest vehicle's pipeline slowest) | **1.63 GiB** (1,668,944 KiB); 1.19 GiB 60 s after |
| 7 admin + 3 viewer | 1,944 | **0** | 10.8/s | admin 45–1,971 / 1,222–2,137 ms; viewer 312–1,662 / 640–2,462 ms (LP stats slowest) | 1.49 GiB; 645 MiB 60 s after |

Three concurrent viewers cut throughput to a third and pushed admin p95 past 2 s: viewer pages are no longer
13 s, but under load they still cost several times an admin page.

### F3 and F4

- **F3:** `addUpdateAction` (an LP update, i.e. a note) posted as a form to a vehicle page on a test pursuit
  created for it: admin **200**, the row written (0.36 s); viewer refused (`AuthorizationError`, shown as HTTP 500
  on the no-JS form path). The test pursuit, its update and its entity were deleted afterwards.
- **F4:** `platform.app_user` 12, `network.read_revision` unchanged, and the database's total
  insert+update+delete counter unchanged across the timing pass and both walks (8,645 requests);
  they moved only for the deliberate write.

### Still not covered

The re-point ordering fix itself; the strip's 8-minute single transaction on RDS (it holds the target frozen);
the container, Kaniko and RDS as before.
