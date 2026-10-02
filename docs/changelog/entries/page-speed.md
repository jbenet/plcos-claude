# Page speed — the slow first click after a data change

2 October 2026 · `claude/page-speed`

Juan, 2 Oct: "sometimes loading pages is a bit slow ... clicking a random LP can take a bit to load".
Measured on live first (plain GETs and read-only queries as `plcos_ro`; LPs counted, never named), then fixed.

## What was slow

Over the live server's log since its last start (1 day 20 h, about 300 page requests), Next's own
work, including compiling a route on first use in `next dev`, was **6.5–7%** of page time. The
application code was **93%**. Half of all page time (54%) was requests running above their route's
usual time. The 13% of requests that took over 2 s carried 45% of it.

| Live, per page | median | p90 | max |
| --- | ---: | ---: | ---: |
| LP page, whole log | 520 ms | 2.2 s | 11.0 s |
| LP page, idle server, first visit to that LP (15) | 436 ms | 905 ms | 1.0 s |
| LP page, idle server, repeat visit (30) | 468 ms | 765 ms | 1.1 s |
| LP page, first visit during a findings import (10) | 641 ms | 2.0 s | 2.1 s |
| Pipeline, whole log | 575 ms | 2.5 s | 2.8 s |
| Today, whole log | 445 ms | 1.1 s | 3.9 s |

On an idle server a first visit to an LP costs about what a repeat does: the per-LP work is small.
What is slow is the **first page after any write**. Every write to the 25 tables pages read changes
`network.read_revision` and empties the shared page caches; a write to entities, edges, affiliations
or source records also changes `network.route_revision`. The next person to open a page then rebuilds
them. Profiled on live data (read-only, one fresh process per LP, six LPs), an LP page's data with
every cache cold took **6.8 s** sequentially:

| Rebuilt after a write | before | share | after |
| --- | ---: | ---: | ---: |
| Route identity topology (`route-policy.ts`) | 4.45 s | 66% | 0.26 s |
| The vehicle's whole pipeline (`pipelineData`; an LP page reads it for its LP-unit and people cards) | 1.15 s | 17% | 1.15 s |
| Route signatures (`revisionFor`: contacts and sources) | 0.58 s | 8% | 0.58 s |
| The LP's own loaders | 0.6 s | 9% | 0.6 s |

The topology cost was a bug. It reads all 118K entities in pages of 2,048 with
`select entity_id::text … order by entity_id`. A bare ORDER BY name resolves to the output column,
which is the text cast, so Postgres could not walk the primary key: every page seq-scanned and
top-N-sorted the whole table (72 ms × 58 pages). Ordering by `e.entity_id` makes it an index walk:
2.5 ms a page.

Two causes are not fixed here:

- **Development mode.** Live runs `next dev`. On the demo, the same pages served from a production
  build were 4–7× faster once warm: Today 110 → 20 ms, pipeline 63 → 9 ms, overview 101 → 23 ms,
  routes 162 → 30 ms, an LP page 126–148 → 35–39 ms. Live's warm pages spend about 400–500 ms. Data
  is roughly half of that, so a production build should save **about 150–300 ms on every page**. That
  figure is an estimate: live was not switched to check it. The live dev server also held
  4–6.5 GB resident after 44 hours. The demo's production server held 0.7 GB, with much less data.
- **Stalls.** The server's event-loop log shows the main thread blocked for 5–300 s 39 times on
  30 Sep and 20 times on 1 Oct, excluding gaps longer than 5 minutes, which are the Mac asleep. One
  37.6 s routes request in this sample coincided with a 37 s stall just after the Mac woke, with
  17 GB of swap in use. A smaller process is the likely fix, which again means a production build.
  This is not established.

## What changed

- **Topology query** (`modules/network/route-policy.ts`): it orders by the uuid column. The cold
  rebuild of the topology takes **4.45 s → 0.26 s** (six cold runs each on live data, read-only). An
  LP page's cold data takes **6.8 s → 2.6 s** (median). The same shadowing in identity resolution's
  possible-match paging (an import path, 13 ms a page) and in the API request log's tiebreak
  (a bigint sorted as text) is fixed too.
- **Page warm-up** (`lib/page-warm.ts`, started from `instrumentation.ts`). Every 5 s the server
  reads the two revisions with one query. When they change and then hold still for a look, it requests
  its own main pages over loopback: Today, then each active vehicle's pipeline and routes. That way the
  rebuild happens before anyone clicks, and a click during it joins the same in-flight work. At start
  it also opens one LP page, so `next dev` compiles that route. It waits while an import job is
  queued or running, keeps warm-ups at least 30 s apart, and makes GET requests only (all three
  numbers are guesses, labelled in the code). `PAGE_WARM=0` turns it off. It requests pages rather
  than calling the loaders because Next gives `instrumentation.ts` its own module instances: a demo
  probe showed two instances of `lib/build-cache.ts`, so a cache filled from there is one the pages
  never read. On the demo server the start warm-up took 14 pages in 3.2 s (`next dev`, compiling) and
  0.8 s from a production build. It did not repeat on its own, so the warm-up's own requests write
  nothing that would trigger it again.
  On live, a warm-up should take roughly the sum of those pages' cold times, about 5–10 s after the
  data settles (an estimate). Until it finishes, a click pays at most the remaining 2.6 s instead
  of 6.8 s.
- **Guard** (`lib/dev/sql-order-shadow.ts`, `scripts/sql-shadow-scan.ts`). A property scans lib,
  modules and app for an ORDER BY on a `::text` output column that shadows its source. Three reviewed
  small-table cases are listed. Another property checks the topology query's plan on 20,000 invented
  entities (an index scan with no sort, while the old query sorts) and that pages are consecutive.
  Others check the warm-up's decision rules. Run them alone with
  `npx tsx scripts/page-speed-props.ts`.
- **Profiler** (`scripts/lp-page-profile.ts`). It times each LP-page loader against a database whose
  connection it forces read-only, and prints loader names, milliseconds and SQL prefixes, never rows.

## For Juan to decide

**Run live from a production build** (`npm run build:real`, then `npm run start:real`, which serve.ts
already supports). For: about 150–300 ms off every page (estimated from the demo), a server
roughly a tenth the size, which should mean fewer stalls under swap, no route compiling, and no
`WATCHPACK_POLLING` file-polling. Against: a merge reaches live only after a rebuild and restart
(about 10 s for the demo build plus a restart, and each restart asks the Keychain for the Affinity
key). Migrations added while running are no longer picked up without a restart. Errors show
production messages. Until then, the warm-up and the query fix apply under `next dev` too.

Not done: a `loading.tsx` for the LP page, so a click shows the page frame at once instead of
waiting. The pipeline page's HTML is 6.2 MB on live, which costs hydration time on the iPad.

Validation: `bash scripts/gate.sh` passes: types, boundaries, 1,416 PGlite and 1,424 Postgres
properties (17 new, invented data). Measurements used plain GETs and `plcos_ro` queries only. No live
restart, no writes, and no real names in this entry.
