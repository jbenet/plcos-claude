---
id: "0001"
title: Issues page has no filter by status or priority
status: triaged       # open | triaged | agent-ready | in-progress | review | done
kind: request         # bug | request | question | chore
priority: P2          # P0 | P1 | P2 | P3 — see issues/README.md for the SLA ladder
reporter: juan
page: /issues
created: 2026-09-20T04:04:34Z
labels: []
---

With five issues the table is fine. With fifty it will not be: there is no way to see only open P0 and P1 items, which is the view triage actually needs.

The IssueSink already takes an IssueFilter, so this is a UI gap rather than a data one.

```json context
{
  "route": "/issues",
  "filters": {},
  "vehicle": null,
  "user": "juan"
}
```
