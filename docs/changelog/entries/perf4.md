## perf4 — Scaled page-query profiling

Added a repeatable, invented performance fixture and removed repeated recursive identity
planning from page queries. Page design and copy are unchanged.

The fixture adds 900 researched LPs, 500 strategies, 10,200 research paths and 10,200
cached graph routes across 600 LPs, plus 5,000 Dakota accounts and 10,000 contacts.
It also has 10,000 affiliations and 7,200 claims; the existing demo contributes nine
more Neurotech pursuits. No real records were read. No fetch, pull, push or live-server
operation was performed.

### Measurements

Measured on the same machine with Node 26 and local PGlite, comparing the starting
`master` checkout with this branch against copies of the same fixture. Three measured
runs follow a warm-up. These are synthetic results: the fixture **does not reproduce**
the reported live 2.2–6.6 second latency. Live performance remains to be verified by
the integrator after merging.

Complete production Next responses were rendered through Next's request handler into
in-memory HTTP request/response streams. The sandbox refuses listening sockets, so
these include server rendering and complete response serialization, but exclude
network transfer and browser hydration. Both builds use webpack.

| Page | Before, warm SSR | After, warm SSR |
| --- | ---: | ---: |
| `/neurotech/routes` | 327 ms | 197 ms |
| `/neurotech/visualizations` | 148 ms | 125 ms |
| `/neurotech/strategy` | 386 ms | 284 ms |
| `/neurotech/selection` | 32 ms | 33 ms |
| `/neurotech/pipeline` | 44 ms | 41 ms |

The second measurement invalidates the page-input revision **before every request**,
so it measures warm database reads while rebuilding page caches, including pipeline
and selection. This excludes React rendering. It holds the request clock fixed;
every stored evidence and provenance date remains in the comparison.

| Page loader | Before | After | Slowest after SQL |
| --- | ---: | ---: | ---: |
| Routes | 487 ms | 341 ms | 69 ms |
| Visualizations | 130 ms | 150 ms | 39 ms |
| Strategy | 307 ms | 209 ms | 50 ms |
| Selection | 644 ms | 428 ms | 58 ms |
| Pipeline | 644 ms | 433 ms | 58 ms |

### Changes and verification

- `identity/006_canonical_lookup.sql`: replace the recursive SQL function with a
  statement-stable indexed lookup loop. Unmerged roots return after one lookup;
  aliases still resolve through arbitrary merge chains. Missing IDs and cycles
  still return null, and undoing a merge takes effect immediately.
- `dakota/003_capacity_reads.sql`: index account/contact entity IDs and invalidate
  the existing page-input revision when either replica table changes. Capacity reads
  traverse only requested roots and their aliases and select the three ticket fields
  used by the calculation, preserving employer attribution and fallback ordering.
- Opt-in SQL timing inside the PGlite adapter measures execution separately from queue
  wait and records no parameters or result data. The profiler writes every query timing
  to its local JSON report.
- Full fixture loader-output hashes match before and after. Separate properties compare
  identity resolution and Dakota capacity results with their original queries, including
  multi-hop merges, missing IDs, cycles, undone merges, employer records, tied dates and
  unusable latest tickets. No UI, workflow permission or capital semantics changed.
- `npx tsc --noEmit`, `npm run boundaries`, and `npm run props` pass: **602/602 properties**.
  `npm run perf4:guards` passes **14/14** safety checks.

### Reproduce

```sh
npm run perf4:seed -- --dir /private/tmp/my-invented-perf4
npm run perf4:profile -- --dir /private/tmp/my-invented-perf4 --samples 3 --invalidate yes --check yes
npm run perf4:guards
DATA_PROFILE=demo npx next build --webpack
node scripts/perf4-render.mjs /private/tmp/my-invented-perf4
```

The seed creates a new marked scratch directory, never resets an existing directory,
and refuses the real profile, database environment overrides, real-data path components
and symlinks. The profiler and renderer require that invented marker. The profiler
supports `--out report.json` and `--compare before.json`; `--check yes` requires every
warm loader sample below 1,500 ms and every measured warm query below 500 ms. For a
before/after comparison, seed once, close the database, copy the marked fixture, and
profile each checkout against its own copy after applying that checkout's migrations.
No old migration was modified. Migration numbers remain subject to assignment at merge.
