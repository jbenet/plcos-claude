## Issue 0103 — Connector activity data and recording

The Connectors page can read `getActivity(): Promise<ActivityData>` from `lib/activity`.
The shared types are unchanged. This branch contains the data layer only; page design stays
with Claude. Work was limited to tracked code and invented fixtures, with no real records,
external requests, fetch, pull or push.

All eight sources have daily UTC series: Affinity, PL warehouse, Dakota, intake files,
internet search, page fetches, SEC and agents. Points are contributions, never additional
source totals. Sum the segments once for a daily total; actual and estimated contributions
remain separate. A null quantity means unknown, including when an unknown is added to a
known value. Bytes are application payload bytes, excluding headers and transport overhead.

Historical evidence:

- Affinity request-log counts exclude refusals. Sync record counts use the measured mean
  stored JSON size to estimate incoming bytes; outbound historical bytes are unknown.
- Dakota manifests supply recorded request and written-record counts. Replica file sizes
  estimate incoming bytes; ledger runs recover work without matching manifests.
- Warehouse graph manifests supply cached query pages and rows. One request per retained
  page and saved page sizes are estimates: resume can reuse a page. Other warehouse ledger
  runs retain their available counts, with unknown requests/bytes left null.
- Intake recursively counts files under `intake/`, their sizes and modification dates
  (estimated arrival dates). Import audit rows supply separate written-entry counts.
- W1/W1c findings supply saved query counts and distinct cited URLs per finding. These
  estimate requests on the research date; citations do not prove fetches and W1c retries
  are not reconstructible. Saved query JSON sizes estimate outbound search bytes. Page
  response sizes and search-provider hosts remain unknown. Cited hosts populate origins;
  SEC hosts belong to the SEC source once, including SEC subdomains.
- Agent ledger usage, with retrospective usage sidecars where needed, estimates bytes at
  **4 bytes/token (GUESS)**. Input includes cache tokens; output includes reasoning. Run end
  dates are used, or start dates for unfinished runs. Model request counts remain unknown.

Counts-only append logs now record Affinity and Dakota attempts (including failures/retries),
warehouse CLI attempts, workflow token usage and committed imports. They retain fixed segment
labels, hosts and hashed run IDs; names, query text, credentials, paths and record fields are
excluded. Recording failures warn without failing a successful source operation. W1/W1c run
through external agent tools, so there is no in-process search/fetch helper to instrument.

The reader suppresses matching historical runs already represented by the log. Older sources
without execution IDs switch to logged activity at instrumentation time. Legacy ledger/manifest
matching is conservative and documented in code; missing or overwritten historical artifacts
cannot be recovered. Source summaries describe retained history, not a live connectivity test.

A generation cache combines fixed-size file metadata checks, an activity generation marker and
database metadata/revision checks. Concurrent readers share a snapshot; a changed generation
invalidates it. Workflow finishes and imports invalidate overwritten research files. External
writers that bypass those paths must call `touchActivity(root)` after changing existing files.
No historical directories are rescanned on a warm read.

The demo supplies 30 invented days for every source, mixing actuals and estimates. Properties
cover privacy, UTC grouping, estimates, nulls, segment totals, duplicate/torn logs, run matching,
connector attempts and bytes, cache invalidation and a 2,000-file warm read under 300 ms.
Validation: `npx tsc --noEmit`, `npm run boundaries` and **735/735 properties** pass,
including 35 new activity properties. The 2,000-file warm fixture read measured about 0.1 ms.
No screenshot:
this change adds no page or UI.
