# Findings import performance — 27 September 2026

The findings job now batches research writes and reconciles changed network ties while preserving unchanged edge IDs. The complete job still imports findings, re-points LP units, derives SPV stance, resolves identities and finishes route precomputation before reporting completion.

The changes address four measured or structurally repeated costs:

- Research documents, claims, SPV evidence and notes use bounded JSON recordset inserts. Connector identity preflight uses set reads. Verified claims, duplicate precedence and rejected-path handling retain their previous semantics.
- Research paths share one canonical identity projection per build. Endpoint resolution builds an index once, retaining explicit-ID precedence and ambiguous-name refusal.
- Network reconciliation retains identical ties and writes only changed or removed ties. Existing endpoint revision triggers invalidate affected route caches; a no-op build preserves the cache generation. Reviewed false ties remain ended. Node imports avoid unchanged upserts and select stale ties with sets.
- LP re-point journals locate rows through typed primary-key predicates. The previous JSON containment predicate serialized and scanned the entire pursuit table for each update. Reversal still checks the exact journalled postimage. Route warm-up projects pursuit and affiliation identities once before joining them. Identity-resolution pagination applies its cursor to both joined indexes instead of filtering already-scanned rows; its foreground batch and pause settings are unchanged.

Planning still reads the complete input corpus so removals and shared evidence are reconciled correctly; database mutations and route-cache invalidation are incremental.

No applied migration changed. Existing primary-key and endpoint indexes now serve the affected lookups; temporary staging indexes are transaction-local. No new service, connector or background completion shortcut was introduced.

## Scaled fixture and parity

`scripts/findings-perf.ts` generates invented records in a fresh temporary directory and a disposable database. It refuses real profiles, existing fixture directories and unapproved Postgres URLs. The fixture contains 2,500 findings, 10,000 claims, 12,000 paths, 35,000 entities, 3,500 LP units, 25,000 warehouse source mappings, 10,000 affiliations and 15,000 pre-existing edges. The measured operation adds research ties and awaits route warming.

The baseline is commit `d994d7246ab73b82728e54330e4ec216732bd45e`. Run the same harness against a checkout of that commit and this branch; compare sorted semantic row hashes, excluding generated IDs and run timestamps. Timing includes the full findings operation and excludes fixture creation and snapshot hashing.

```sh
node --import tsx scripts/findings-perf.ts --out=/tmp/findings-before.json
node --import tsx scripts/findings-perf.ts --out=/tmp/findings-after.json --compare=/tmp/findings-before.json
DATABASE_URL=postgres://plcos@127.0.0.1:5434/plcos_test_findings_perf node --import tsx scripts/findings-perf.ts --out=/tmp/findings-postgres.json
```

The benchmark covers twelve semantic projections: claims, documents, notes, entities, pursuits, route scores/statistics, source records, affiliations, LP re-point decisions/evidence, pursuit contacts, edges and SPV evidence. It also compares the job's counts. Random identifiers and journal timestamps are excluded; ordinary values, evidence, status, LP capacity and review fields are retained. Focused properties separately cover reviewed ties, removed ties, verified claims, rejected identities, duplicate input order, composite-key reversal and later-edit refusal.

The complete final run passed all twelve semantic comparisons and the job's result-count comparison, with **27,000 edges and 3,500 route caches**. The network write transaction fell **45.968 s → 1.742 s**. The baseline canonical-path projection ran 2,500 times and consumed 42.108 s; it now runs once. The baseline pursuit-update predicate consumed 46.043 s over 2,500 calls. Identity source pagination fell from 39.163 s to 18.541 s with the indexed-cursor fix. Identity-resolution pauses and the full route-warming workload remain included.

The measurements use PGlite on the shared development machine, with other fixture checks running. They are not live Postgres measurements and do not reproduce the reported 96-minute live run. No real-data directory was opened.

| Phase | Before (s) | After (s) |
| --- | ---: | ---: |
| Repairing team identities | 0.620 | 0.468 |
| Importing findings | 10.491 | 1.560 |
| Re-pointing pursuits to their LP | 49.505 | 3.303 |
| Deriving SPV stance | 0.304 | 0.320 |
| Rebuilding research ties | 225.116 | 155.848 |
| **Total** | **286.036** | **161.498** |

**Result:** 4m46s → 2m41s, a 43.5% reduction, below the five-minute target on this invented PGlite fixture.

## Verification and remaining Postgres gate

- `npm run props`: **971/971 pass** on PGlite.
- `npx tsc --noEmit`, `npm run boundaries`, and `git diff --check`: pass.
- Full-scale `--compare`: all twelve semantic hashes and result counts match; 27,000 edges and 3,500 awaited route caches are asserted.
- Focused checks cover no-op edge writes/cache generations, changed and removed ties, reviewed corrections, bulk importer precedence and verified claims, connector batching, composite primary-key reversal and identity-resolution pagination.
- `DATABASE_URL=postgres://plcos@127.0.0.1:5434/plcos_test_findings_perf npm run props` was attempted but the execution sandbox refused the connection with `EPERM`. The Postgres benchmark was blocked the same way. The invented cluster's `/tmp/.s.PGSQL.5434` socket was also refused. **No Postgres test pass or timing is claimed.** Run both commands on a host allowed to reach the development cluster before integration; live performance remains unverified.

