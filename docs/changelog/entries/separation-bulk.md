## Bulk identity separations

The duplicate-merge pass records different external IDs only for the remaining ambiguous
review candidates. It writes the separation assertions with one `INSERT … SELECT FROM
unnest(...) … ON CONFLICT DO NOTHING` per batch, and skips existing canonical pairs and
compact group membership before writing. The caller's identity lock serializes these
checks; `ON CONFLICT` alone would not deduplicate the assertion table's generated IDs.
Own-named person/organization separation still runs before automatic merges.

Above 25 candidate members (**GUESS**, `config.identity.compactSeparationThreshold`), a
source bucket whose distinct external IDs prove every member different uses one assertion
per non-anchor member. `signals.separationGroup` identifies the complete all-different
constraint, with the proving source in `separationSource`. Ordinary pair assertions remain
nontransitive. Resolver, creation, imported people/organizations, manual decisions, and
queued-match cleanup enforce compact membership, including canonical aliases and pairs
that do not contain the anchor. No schema changes or real-data reads.

Invented fixture: 1,400 candidate groups, one with 500 members and 1,399 with two, plus an
unreviewed control pair. The old pass writes 126,150 assertions in 126,150 statements;
the new separation pass writes 1,898 assertions in one statement. On the same temporary
PGlite fixture, separation time fell from **266.178 s to 0.123 s**. The complete new
`mergeImportDuplicatesInTransaction` pass took **0.569 s**, below the 120 s budget, and
wrote 1,899 assertions in one statement because it also discovers the control pair. Retries and a subset of
non-anchor members write nothing. The control pair is untouched by the candidate-only pass.
Rule counts count stored assertion rows, not implied pair combinations.

Reproduce with `DATA_PROFILE=demo node --import tsx scripts/separation-bulk-benchmark.ts`.
The benchmark uses an isolated temporary PGlite database and rolls each measured pass back;
fixture setup and migrations are excluded. The scale property and seven integration
properties exercise non-anchor, renamed, alias, transitive, manual-review, and creation guards.

After replacing queued-edge assertion self-joins with canonical membership-array overlap,
a final after-only rerun measured **0.090 s** for separation and **0.441 s** for the full
merge on the same fixture shape. These are local invented-data timings, not a measurement
of the real database or Postgres service latency.

Validation: `npx tsc --noEmit`, `npm run boundaries`, and `npm run props` pass
(**1,380/1,380** on PGlite, including the scale and six guard properties). All **seven**
focused guard properties pass after the final queued-edge optimization; the additional
property verifies that a non-anchor candidate edge becomes inactive. No visible UI change.
