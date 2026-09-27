# Activity performance — persisted file digests and background refresh

Developer → Connectors now serves the last saved activity aggregate with its original
`asOf`, without checking database generation or scanning research files on the request.
Next's startup hook starts the refresher; activity writes notify it, and a one-second
background generation poll catches imports from other processes. Refreshes share one
in-flight pass. An import during a pass leaves the prior aggregate available and the
next pass retries. Failed refreshes likewise retain the last dated result.

Two disposable, mode-0600 files live under the configured data root's `activity/` folder:
`digests-v1.json` and `aggregate-v1.json`. Per-file extractions are keyed by relative path,
size, modification time and change time. Unchanged research, ledgers, activity logs and
manifests are not reread. Research digests contain timestamps, query counts/byte counts
and normalized host counts, with no finding bodies, query text or full source URLs.
Ledger and manifest digests retain only metadata needed for counts and execution matching.
Page/JSONL byte sizes and intake files are statted, not parsed. Deleted files are pruned.
Integrity checks reject damaged entries; writes use atomic rename. The activity folder's
mtime is excluded from generation checks, so saving the cache cannot invalidate itself.

Research JSON parsing and URL enumeration run in a short-lived Node worker. Background
file processing yields with `setImmediate` between files, including cache hits; log folding
also yields in batches. Recombining the small extracted counts preserves exact cutoff and
run-ID deduplication, null quantities, estimates, EDGAR folding and basis text. A first-ever
installation without a usable aggregate returns an empty result with epoch `asOf` while
its first background build runs. Existing deployments hydrate the saved aggregate after
restart. No page layout or design changed.

## Timing

Measured locally on 27 September 2026 with
`node --import tsx scripts/activity-perf.ts`. The generator creates a new temporary,
entirely invented corpus: **1,200 raw JSON files, 142,106,054 bytes (135.5 MiB), 300 ledger
runs**, Dakota and warehouse manifests, activity logs and nested intake files. Raw files
range from roughly 32–96 KiB through 512 KiB to several 4–8 MiB findings. The persisted
file digests occupy **661,992 bytes (646 KiB)**. The benchmark removes its temporary corpus.
The standalone `node --import tsx scripts/activity-perf-fixture.ts` generator keeps a new
temporary corpus and prints its location; neither command accepts a destination path or
the real profile.

| Operation | Before: full uncached fixture scan | After | Source files reread after |
| --- | ---: | ---: | ---: |
| First aggregate construction | 439.80 ms on request | 479.09 ms in background | 1,218 initial extractions |
| Warm request | Generation checks on each request¹ | **0.030 ms** | 0 |
| Request just after import | 439.80 ms full rebuild | **0.005 ms**, serves dated prior aggregate | 0 |
| Generation-only background refresh | 439.80 ms full rebuild | **62.99 ms** | 0 |
| Changed 8 MiB finding plus appended ledger run | Full rebuild | **101.00 ms** | **2** |
| First request after process restart | Full rebuild | **0.480 ms**, saved aggregate | 0 |
| Refresh after restart using saved digests | Full rebuild | **63.41 ms** | 0 |

¹ The reported live baseline was **69 s first load / 4.8 s warm**. Those are the requester's
observations, not measurements taken during this change. The fixture has no live database
or server contention; no real files, database or live server were read. Live timings after
integration remain to be measured. The local fixture meets the **300 ms warm / 3 s after
import** targets; its largest observed cached-build event-loop delay was **8.08 ms**
(43.81 ms for the uncached scan). The one-second polling interval is a guessed coalescing
budget, not an external service guarantee.

## Verification

`npm run props` includes strict deep comparison of cached and uncached fixture outputs,
excluding only `asOf`. It also checks changed-file reuse, deletion, exact-time coverage,
concurrent single-flight refreshes, persistence across reader restart, malformed cache
recovery, private-text exclusion, failures retaining dated results, immediate reads while
a database refresh is blocked, and bounded work when an import races a pass.

Passed: `npx tsc --noEmit`, `npm run boundaries` (663 source files), and
`npm run props` (**858/858 properties**). The standalone benchmark passes all 19
activity performance and recovery assertions.
