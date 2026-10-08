# Pages stay fast while imports run, and the LP page is ten times quicker · 8 Oct 2026

Second round of the performance pass Juan asked for on 8 Oct 2026 ("keep profiling, keep improving performance of
actions"). Measured on the same invented copy at the live scale (115,000 entities, 3,000 LPs on one vehicle, 70,000
meetings), on a production build.

- **Selection and Pipeline no longer rebuild on every import write.** The live server almost always has an import
  running, and each of its commits made the next page view rebuild the whole list first (about 1.1 s each on the
  invented copy, against 0.2 s from the last build). An import worker's writes are now marked as background
  (network migration 017, set on the worker's own connections): a page answers from its last build at once and
  rebuilds behind it. A person's own change (a status move, a note, a merge) still rebuilds before the next page
  answers, and so does the end of each import job. A list is never more than 10 minutes behind an import (a guess,
  `BACKGROUND_STALE_MS`). Measured: Selection while a stand-in import writes every 2 s, 1.1 s → 0.25 s.
- **The LP page asks the database the cheap way.** Its claims, affiliations, colleagues, last direct contact,
  related LPs and connection paths matched every row of each table through the merged-identity lookup, one
  function call per row (0.4–0.8 s each). They now look up the LP's own aliases first and use the tables' indexes,
  as the list already did for its main queries. Warm LP page: 1.15 s → 0.13 s. The same change in the pipeline's
  people, profiles, claims and restrictions queries: a cold list build, 1.4 s → 1.0 s.
- **An organization-LP import no longer blocks status moves.** It locked the pursuits table against all updates
  while it ran; it only inserts pursuits, and the table's unique key already stops duplicates, so that lock is gone.

Checks: tsc, the properties on PGlite and on Postgres (`cache-retries`: a page answers from its last build while only
background writes landed, rebuilds behind, and rebuilds first after a person's write; `commit-revisions`: an import
worker's writes and a person's are told apart). The rewritten claims, last-contact and related-LP queries were compared with the old ones on the
invented copy: same rows.
