# Pages stay fast while imports run; the LP and vehicle status pages much quicker · 8 Oct 2026

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
- **The vehicle status page: 3.4 s → 0.02 s.** It looked up each close candidate's pursuit before taking the page
  of 20 it shows, one merged-identity lookup per pursuit each time; it now takes the page first, then looks up
  those 20 through their aliases. Same rows on every vehicle and page compared.
- **The list build waits less on itself.** The plans, the people and the touchpoints each need only the pursuits,
  so they now load side by side; inside a vehicle's plan the route summary and the Dakota capacities no longer wait
  for steps they do not use. Same output, compared on every vehicle.
- **Route checks after a change read the change log in order.** Deciding whether a stored route still holds walked
  the changed records in batches, and each batch re-read every record before it; it now continues from where the last
  batch ended. The route warm-up resolves only merged records when it lists its targets (0.86 s → 0.1 s, same targets).
- **Materials: the "To" menu lists the LPs on a pipeline,** not every person and organization on file (115,000
  options and 19 MB of page on the invented copy; now under 1 MB).
- **The next LP's score detail after a move: 0.7 s → 0.05 s.** A move to Selected is a person's change, so the
  detail of the LP shown next waited for the plans to rebuild, though nothing about that LP had changed. The detail
  now answers from a build begun in the last minute (a guess) and the rebuild runs behind it.
- **An organization-LP import no longer blocks status moves.** It locked the pursuits table against all updates
  while it ran; it only inserts pursuits, and the table's unique key already stops duplicates, so that lock is gone.

Checks: tsc, the properties on PGlite and on Postgres (`cache-retries`: a page answers from its last build while only
background writes landed, rebuilds behind, and rebuilds first after a person's write; `commit-revisions`: an import
worker's writes and a person's are told apart). The rewritten claims, last-contact, related-LP, close-status and warm-up queries were compared with the old ones on the
invented copy: same rows.
