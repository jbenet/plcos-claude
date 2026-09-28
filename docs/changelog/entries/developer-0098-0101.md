# The Developer pages, redesigned — changelog, status, workflows and logs · issues 0098–0101 (and 0036)

| | |
|---|---|
| ![The changelog, batched ten at a time with a row of batch numbers](docs/changelog/shots/developer-0098-0101/01-changelog-batches.webp) | Changelog (0098): the latest batch while it grows, a row of numbered batches, and every entry on its own page. |
| ![Developer status, with sources including Dakota and the PL Data Warehouse](docs/changelog/shots/developer-0098-0101/02-status-sources.webp) | Status (0099): sources as a table with state, access, what is here and when it was last read. |
| ![Developer workflows, with the run ledger and its chart](docs/changelog/shots/developer-0098-0101/03-workflows.webp) | Workflows (0100, 0036): the run ledger — outcomes, items written, checks passed and tokens, kept apart as measured or estimated. |

**Changelog (0098).** Entries are read ten at a time. Batches are cut from `docs/changelog/index.md`'s order, oldest
first, so a full batch never changes: the page holds the latest batch while it grows, and its eleventh entry starts
the next one. A row of numbered batches sits under the title, each batch scrolls like the old page, and "Older →"
walks back. Every entry opens on its own page (`/developer/changelog/<file name>`) with its neighbours and its batch
beside it; an issue's "fixed in" link now goes there too. Nothing moved on disk: one file per entry, as before, so an
agent still reads one entry and the index. Two bugs went with it: an entry whose file opens with `#` rather than
`##` was drawn as a bare divider and its text dropped (fifteen entries, most of the recent ones), and two committed
entries were missing from the index.

**Status (0099).** Sources is a table with state, access, what is here and when it was last read, and now lists
Dakota and the PL Data Warehouse beside Affinity. Dakota shows its replica's last complete pull from the manifests,
the database's account and contact counts and the last import — counts only, never a field. The warehouse shows the
workflow runs that read it, the graph pull they left and the records it added; this server never queries it. The
Services table gains the workflow ledger; the Connectors row stops saying "fixture only" on the real server; the
migration list folds away behind its count and latest.

**Workflows (0100, 0036).** A new page under Developer, from the one run ledger every Claude, ChatGPT and script run
appends to: runs, outcomes, items written, checks passed and tokens (measured and estimated kept apart; unknown is
not zero), a chart of runs over time, a table by workflow grouped into research, imports and dev tasks, the protocol
versions each workflow has run on in order, the commits that changed the protocols and runners, and every iteration
note under `enrich/log/<date>/` with its hypothesis and the run it names. A run opens in the side pane with its
checks, counts, usage and related runs; a note opens on its own page. A start with no finish shows as "No finish
recorded", never as success. The demo reads invented runs and notes (`lib/workflows/demo.ts`,
`fixtures/workflows/log/`). Agents, the app's own runtime, links to it.

**Logs (0101).** One timeline, grouped by day: commits and merges on master with the issues they closed (read from
the repository by a small server-side `git log` reader, no network), workflow runs from the ledger, imports from the
audit log, records and feedback. Filters by kind; repeated identical events fold into one line with a count; each
source says whether it could be read.

Checks: typecheck, boundaries and properties (three new ones: batches and entry bodies, the git reader's issue
parsing, the demo ledger's fold and note summaries). Not checked here: the new pages against the real ledger in a
browser (the data layer was run read-only against it: about 240 runs, 150 notes, 200 commits, each read in under
30 ms), and Safari.
