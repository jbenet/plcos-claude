# Faster LP lists, meetings, calendar and Today · 12 Oct 2026

Juan, 12 Oct 2026: "I've noticed the pages have been slow to load and that harms productivity". These figures come
from a production build on an invented fixture of 5,000 pursuits and about 150,000 meetings, on local Postgres
(PRs #107, #109 and #110).

| Page | Before | After |
|---|---|---|
| /neurotech/pipeline | 6.0 MB | 1.8 MB |
| /all/pipeline | 9.3 MB | 2.45 MB |
| /neurotech/selection | 5.8 MB | 1.6 MB |
| /neurotech/strategy | 2.2 MB | 0.8 MB |
| /neurotech/visualizations | 3.6 MB | 1.0 MB |
| /all/calendar | 7.0 MB, 2.2–2.6 s | 3.4 MB, 1.1–1.5 s |
| /neurotech/meetings | ~0.65 s | ~0.08 s, also right after a status move |
| /today | 0.6–1.0 s | 0.15–0.2 s |
| Pipeline, first view after any edit | 1.0 s | ~0.7 s |

- **Rows travel by column** (`lib/packed-rows.ts`): each key is sent once, repeated values once, and a row's
  people and firms go as one packed list.
- **Revisions that a status move leaves alone:**
  - Network 020 adds `touch`. It moves on meetings, identities, affiliations, contacts, addresses, a vehicle's
    pursuits and the names printed. Touchpoints (`touchesOn`) and the meetings list (`meetingsOn`) are kept by it.
  - Network 021 adds `routes`. It moves only on stored route searches, which every plan reads.
- **A merge chain is walked only for a merged record**, in the pursuit, meeting, exposure, outreach, reconcile and
  pipeline people reads. For example, the pursuit read went from 125 to 27 ms.
- **Smaller fixes:**
  - Grouping now pushes into a list instead of copying it per row.
  - The calendar sends only its window.
  - `formatDate` reuses one formatter per time zone.
  - The pipeline sort uses one collator.

Checks:
- tsc, boundaries and 1821/1821 properties on PGlite.
- On Postgres, commit-revisions passes. It now checks that a status move leaves touch, routes and the meetings
  list alone, and that a meeting or a route search moves them.
- A browser crawl of 22 main pages found no client errors.
- A red-team review found two staleness gaps, and both were fixed: an address change, and an import's new pursuit
  on Today.
