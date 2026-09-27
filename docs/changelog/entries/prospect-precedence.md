## Prospect precedence — researched decisions survive intake conflicts

“Add prospects to the pipeline” previously broke ties between same-date files by line
number, so a longer intake file could silently displace researched decisions.

For each canonical person × vehicle, a Sourcing or Passed row with a reason now beats
a New intake row. Otherwise, precedence is the latest explicit `decidedAt` ISO timestamp
(an absent timestamp ranks last), then the latest file modification time, filename,
and line. Invalid timestamps are reported as invalid rows. Person-set statuses remain
protected, including when their audit history records a human decision but their current
provenance says rule.

Both immediate and background import receipts show per-file won/lost counts, the full
number of superseded rows, and the first five losers with their winning file, line and
status. Counts describe input selection; a selected row cannot override a person-set
status. The page explains the new precedence. Import audits retain per-file counts.

Validation uses invented fixtures only: same-date modification-time conflicts, explicit
timestamps and timezone ordering, filename/line ties, research over intake in either
input order, human protection, rerun reporting, actual filesystem timestamps, invalid
timestamps, and bounded rendering of both receipts. No real data was read or imported.

Checks passed: `npx tsc --noEmit`, `npm run boundaries`, and `npm run props`
(848 of 848 properties). Synthetic React rendering passed; browser layout verification
was unavailable because the sandbox refused Chromium's Mach-port registration.
