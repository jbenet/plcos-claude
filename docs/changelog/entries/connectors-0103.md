## Connectors — every source we read, and how much we ask of it · issue 0103

| | |
|---|---|
| ![Developer → Connectors, with the requests/data/records charts and the sources table](docs/changelog/shots/connectors-0103/01-activity-charts.webp) | The Activity charts (requests, data in and out, records pulled) and the Sources table beneath them, with the five seams and the connector contract below that. |

Developer → Connectors is now the page for every source the system reads — Affinity, the PL data
warehouse, Dakota, intake files, internet search and page fetches, SEC EDGAR, and our own agents — and
for the activity we generate against each.

**Activity.** A row of pills (All · Affinity · Warehouse · Dakota · Intake · Search · SEC · Agents)
chooses the source; a range (7, 30 or 90 days, or all) and a bar size (daily or weekly) sit beside it.
Three charts share one time axis: requests, data in and out (bytes received above the line, bytes sent
below, on one scale) and records pulled. "All" stacks one bar per source; a single source stacks its
segments — Affinity's lists, notes and meetings, Dakota's accounts and contacts, one bar per workflow
for agents (the five largest, the rest as "Other") — or draws one bar when it has none. Search adds
requests by origin host: each host's total, share, busiest day and a small bar per day, with a day six
or more times the host's median marked as a burst (the ratio is a guess, labelled in the code).

**Estimates.** Backfilled figures are drawn lighter with a dashed outline, and marked `~` wherever a
number includes one. The legend says what an estimate is, and a fold under the charts says how each
source's estimates were made. A figure that was never counted (a file drop makes no requests) is shown
as not counted, never as zero; days before anything was recorded are called out as having no record.

**Reading a bar.** The three charts share a chosen bar, read out beside them series by series — tap it
on an iPad, point at it with a mouse, or focus a chart and use the arrow keys. Nothing is hover-only.
The same figures are in a table under the charts.

**Sources.** Each source's state (connected, read-only, files, planned), what access it has, its
requests and records over the chosen range, and its last activity; a connected source quiet for more
than three days reads as stale. A row opens that source's charts. The five seams and the connector
contract stay below.

The page is built on one contract, `getActivity()` in `lib/activity/` (types in
`lib/activity/types.ts`). This branch ships a demo implementation reading invented figures from
`fixtures/activity.json` (30 days, every source, actuals and estimates); the real implementation,
built in parallel, replaces `lib/activity/index.ts`. The folding into bars lives in
`lib/activity/view.ts`, and five properties check it: stacked bars conserve every figure with actuals,
estimates and unknowns kept apart across every source, range and bar size; an estimate is drawn lighter
and dashed; day and week bars tile the range; the fixture covers what the page promises; and the burst
rule.

**Migrations:** none.
