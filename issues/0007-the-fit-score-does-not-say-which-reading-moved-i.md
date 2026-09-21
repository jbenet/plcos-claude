---
id: "0007"
title: The fit score does not say which reading moved it
status: triaged          # open | triaged | agent-ready | in-progress | review | done
kind: request         # bug | request | question | chore
priority: P2          # P0 | P1 | P2 | P3 — see issues/README.md for the SLA ladder
reporter: juan
page: /neurotech/fit
created: 2026-09-20T23:16:00Z
labels: []
attachment: attachments/0007-screenshot.png
---

Northwood's median-and-range KPI tells me where the pool sits, and the score tells me where this firm sits in it, but nothing says which of the eighteen readings changed since the last assessment. When a score moves two points I want the diff, not the total. The arrow is on the KPI strip and the box is around the numbers that would need it.

![Screenshot](attachments/0007-screenshot.png)

```json context
{
  "route": "/neurotech/fit",
  "filters": {},
  "user": "juan"
}
```

**Partly done (N30), and the other part needs a schema.** The firm page has a *What moves
this number* table: every reading, the points of the final score it supplies, what it would
add if the finding went to strong, and what it would do if the same finding were verified
rather than guessed. That last column can be negative — verifying a weak guess lowers the
score, because the certainty discount was flattering it.

On Cedar Trust it also says the thing worth knowing: the largest single change available is
two points, so the score is not one conversation away from anything.

**What is still missing is the diff you asked for.** This system keeps one assessment per
firm and vehicle, so there is no earlier reading to subtract. That needs an
`fit.assessment_revision` table written on every change, with the dimension rows it touched
— at which point "which reading moved it since August" becomes a query rather than a
feature. Left open for that.
