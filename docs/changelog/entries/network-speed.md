# Network speed — invented scale benchmark

Route warming now joins three-hop paths from the target's neighborhood, preserving edge order, source exclusions and the 300-path cap. Record ties reuse two date formatters. No new tables, configuration or rebuild mode.

`scripts/network-perf.ts` generates seeded, invented data: 43,000 people, 69,000 meetings, 100,000 email payloads and translated records, 2,000 LPs, 2,800 findings and 14,000 W3 paths. It opens only a fresh scratch database; `DATABASE_URL` uses the existing loopback `plcos_test_*` guard. Run `node --cpu-prof --cpu-prof-dir=/tmp --import tsx scripts/network-perf.ts` (`--small` for a smoke run).

Baseline (`8e565d0`) on PGlite: 263.9 seconds including identity resolution and all 2,000 route searches; tie transaction 9.5 seconds. CPU profiling found 30.6 seconds in path enumeration and 2.6 seconds constructing date formatters. The fixture does not reproduce the reported live 30–90-minute duration; real data was not accessed. Identity resolution's existing pauses and SQL remain part of the awaited total.

After: **227.5 seconds total**, **7.2 seconds** for the tie transaction; sampled CPU in path enumeration fell from **30.6 seconds to 0.05 seconds**. All **56,209 semantic edge rows** have the same SHA-256 checksum and build counts, and all **2,000 LP route searches** completed. The total includes the unchanged identity-resolution pauses and SQL, so the CPU improvement is larger than the elapsed-time improvement.

Two properties compare the indexed walk with the old enumeration across 216 seeded cases, and complete record-edge rows with the old calculation across 97 invented ties. They cover ordering, caps, parallel ties, cycles, source exclusions/overlaps and date-span formatting. `npx tsc --noEmit`, `npm run boundaries` and `npm run props` pass (1,126/1,126 properties); Postgres runs at merge.
