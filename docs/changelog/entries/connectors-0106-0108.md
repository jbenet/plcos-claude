## Connectors — EDGAR folded into search, and a page that stops repeating itself · issues 0106–0108

| | |
|---|---|
| ![Developer → Connectors, with EDGAR folded into Search and notes deduplicated](docs/changelog/shots/connectors-0106-0108/01-connectors-deduped.webp) | The Sources table with SEC gone (folded into page fetches as EDGAR), and each source's own short note instead of a repeated paragraph. |

**SEC is no longer a source (0106).** EDGAR is internet reading, not a database of its own, and it
held very few records. Its rows now count as page fetches in their own "EDGAR" segment, so an
unknown SEC figure never blanks a known fetch figure on the same day. sec.gov is listed among the hosts
under Search, which names up to five of the smallest hosts instead of only counting them. The SEC pill
and its row are gone. Old log lines recorded under `sec` still read and fold the same way.

**Pages of repeated text (0107, 0108).** Two causes, both fixed where the data is assembled
(`lib/activity/model.ts`):
- Every source carried the same four-sentence note. Each now has a short phrase of its own
  ("Read-only API sync", "Files dropped for import").
- Merging a day's points appended the estimate basis again whenever the basis itself contained
  "; ". The check split on that separator and never found the whole basis, so one sentence grew
  into pages. A basis is now a set of clauses, each kept once, and merging the same basis again
  leaves it unchanged.

The page also caps and deduplicates whatever it is given (`lib/activity/view.ts`):
- A note shared by most sources is treated as boilerplate and dropped. Any other note is cut to its
  first phrase, 60 characters at most.
- Estimate bases are one line per source, each clause once, up to 180 characters, and sources
  estimated the same way share a line.
- One short line under the charts explains estimates, in place of the paragraph in the legend. The
  sublede, read-out and side panel are shorter too.

The invented fixture now carries notes and bases as long and repetitive as the real ones were, some
over 4,000 characters. Four new properties cover the change:
- bases shown once and capped;
- boilerplate notes dropped;
- forty merges of one basis leave it as written;
- SEC requests counted once under Search as EDGAR, with sec.gov among the hosts.

The existing activity-data properties now expect EDGAR under page fetches.

**Migrations:** none.
