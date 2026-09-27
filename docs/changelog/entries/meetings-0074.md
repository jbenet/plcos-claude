# Calendar, fit and meeting preparation — issues 0072–0074

Calendar now starts newest first, with reversible date, LP and team ordering, team and LP filters, and explicit ownership columns. The window follows the current date. Meeting links select the actual dated record.

Fit now reads vehicle-scoped strategy suggestions alongside formal assessments. The old page read only the legacy assessment tables, so enrichment work was invisible. Search, coverage filters, score/name/date ordering and 25-row pages make the list usable at volume. Provisional scores and their bases remain separate from formal assessments and participation gates; missing readings remain unknown. Blocked readings sort last by default.

Meetings now has Upcoming, Held and Unconfirmed lists, with 15 records per page and a selected preparation panel. A compact expandable summary replaces the claim table. The panel includes LP status, next step, closing progress, score bases, four recent touchpoints, questions and source details. The global held-meeting justification section is removed because unrelated meetings do not explain the selected LP; consent evidence stays in the LP record. Overlapping LPs cannot select a meeting or strategy from another vehicle.

Full brief generation is deferred to a private open issue labelled `needs-juan`, for review of the existing brief workflows.

Validation: TypeScript and boundaries pass; 417 of 417 properties pass; invented regression cases cover overlapping vehicles, absent/dismissed readings, meeting tags and calendar ordering. Demo and copy HTTP checks and page timings are recorded in the private handoff. Browser rendering was unavailable in this environment; HTML and link assertions were used. No screenshots or private records are included.
