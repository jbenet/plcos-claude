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
