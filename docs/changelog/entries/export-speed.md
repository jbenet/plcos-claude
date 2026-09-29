# Research export — bounded identity review work

The research export now folds creation-time name-only matches with union-find. Each
review component keeps a set of reasons, so dense match queues no longer repeatedly
filter all groups or append the same reason text. Person duplicate review indexes
members, sources and separation constraints instead of rescanning them per component.

Bulk identity reads resolve redirects once in memory, preserving aliases, retired
roots and cycle exclusion without joining `identity.entity_resolution` to large sets.
Person evidence expands aliases from selected roots, and path references use equality
joins after expanding their keys. Existing canonical source rows bypass redundant
canonical-function calls.

Export preview skips queue retirement, which could not change its finished report and
was immediately rolled back. Imports still retire matches: materialized endpoint and
separation sets replace the correlated per-match assertion scan. Separation, privacy,
review IDs and approval behavior remain unchanged.

The invented full-export fixture is `scripts/research-export-perf.ts`. It refuses real
profiles and application database/export configuration, builds a disposable database,
and exercises research, candidates, triage, identity review and LP-unit review together.
Run with `node --cpu-prof --cpu-prof-dir=/tmp --import tsx scripts/research-export-perf.ts`.
The default fixture requires the complete export to finish in under 180 seconds;
`--baseline` records a comparison without enforcing that budget. Setup is timed separately.

Measured on 29 September 2026 with PGlite and `node --cpu-prof`, using the same
fixture against baseline `59156c8569619f0bb83c757990046e1062d7d076` and this change:

| Measurement | Before | After |
| --- | ---: | ---: |
| Complete export | 64.524 s | 9.353 s |
| SQL calls / cumulative query time | 87 / 11.568 s | 85 / 8.228 s |
| Sampled self CPU in `import-dupes` | 28.880 s | 0.082 s |
| Sampled self CPU in `import-person-dupes` | 19.706 s | 0.108 s |
| Fixture setup (excluded from export) | 151.368 s | 148.225 s |

The fixture has 118,000 entities, 63,000 active creation-name-only pairs, 1,900 identity
review groups, 2,000 candidates, 220,000 list-entry snapshots, 12,000 touches, 1,900
aliases and matching graph/path references. The complete export is **6.90× faster**.
All eight output hashes match after sorting unordered arrays and omitting the
export-owned `asOf` timestamp: research, candidates, triage, identity review, LP-unit
review, entity keys, team and vehicles. These are invented-fixture timings, not a
measurement of the live database or a reproduction of its reported 15-minute run.
No real data was read. CPU profiles measure the main thread; query timings include
PGlite worker execution. The dominant baseline callbacks were the group fold (27.887 s)
and repeated person-source scans (17.993 s); neither remains a hotspot.

Regression coverage compares union-find with the prior algorithm on 100 invented
graphs, exercises 63,000 queued edges, compares redirect projection with the canonical
view on a small fixture including cycles and retired roots, and verifies preview and
import queue-retirement behavior. Existing redaction, identity, separation and triage
properties remain in the full gate.

Validation: `npx tsc --noEmit`, `npm run boundaries`, and `npm run props` all passed
(1,386 of 1,386 properties). No UI or schema migration changes.
