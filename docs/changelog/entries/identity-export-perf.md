## Identity review export performance — 27 Sep 2026

`Export the research set` now completes its research-set, candidates, team and triage
files before attempting identity review in a separate transaction. If identity review
fails, the export logs a sanitized failure category, removes any stale review file,
and persists a receipt displayed as an alert on the enrichment page. A successful
retry clears the alert. Database error text and query parameters are never logged.

Identity context now uses three indexed raw-record lookup arms, shared by export,
the imported-person duplicate preview and historical person-evidence reads. New
append-only migration `sources/005_identity_review_lookups.sql` indexes direct IDs,
Affinity typed IDs and Affinity list subjects. Overlapping matches retain the old
join's multiplicity, including historical versions. Graph context splits the two
edge directions and materializes incident candidates before testing JSON evidence.

The largest measured cost was a third query: path counts compared every path with
every review member and repeatedly checked source IDs. Export now expands each path
once and resolves its four keys through the already loaded alias/source maps. A
path counts once per canonical identity, including when one source key refers to
several identities. The duplicate preview remains current and rolls back its repairs;
its measured cost after the query fixes does not warrant a cache and invalidation scheme.

### Invented fixture measurements

Only invented data was used: 1,000 ambiguous groups (800 person, 200 org), 3,000 member
IDs including aliases, 30,000 entities, 33,000 source records, 220,000 raw records,
40,000 edges, 7,000 claims, 3,000 profiles and 1,000 connection notes containing 2,000
paths. No real data directories or existing database records were read.

| PGlite measurement | Before | After |
| --- | ---: | ---: |
| Duplicate preview (`reviewOnly`) | 2,126 ms | 1,158 ms |
| Full identity review export, first measured call | 16,316 ms | 1,440 ms |
| Full identity review export, repeated call | — | 1,443 ms |
| Original path-count query | 12,953 ms | replaced by one expansion and map lookups |

These are local single-run observations, not production latency guarantees. The
full before/after outputs match after normalizing unordered context arrays. The
benchmark freezes the previous implementation and removes the new indexes for
baseline execution; the final export assertions require less than five seconds.
Small semantic properties additionally compare raw row multisets and distinct
graph affiliations, including overlapping lookup arms, historical versions,
non-Affinity sources, self-edges and merged aliases.

PGlite `EXPLAIN` confirms that the old raw join can scan the raw corpus and test
the compound source match repeatedly; the new lateral `UNION ALL` uses the three
lookup indexes. The graph rewrite gathers each endpoint direction independently
before evaluating the JSON evidence predicate. The path expansion avoids the
member-by-path join altogether.

Reproduce with:

```sh
node --import tsx scripts/identity-export-perf.ts --baseline
node --import tsx scripts/identity-export-perf.ts --postgres --baseline
```

The benchmark uses a fresh in-memory PGlite database, or connects to the designated
local `plcos_dev` solely to create and later drop its own uniquely named scratch
database. It refuses application database environment overrides.

### Validation

- TypeScript and boundaries pass.
- Focused export properties pass for SQL transaction failure, timeout, surviving
  files, stale review removal, sanitized logging, visible alert and recovery.
- Full PGlite suite: **879 of 879 properties hold** (`npm run props`).
- The requested PostgreSQL property command and benchmark were attempted, but this
  environment refused connections with `EPERM` over both `127.0.0.1:5434` and its
  local Unix socket. PostgreSQL timings, plans and the five-second target remain
  unverified; rerun the commands in an environment allowed to reach that server.
