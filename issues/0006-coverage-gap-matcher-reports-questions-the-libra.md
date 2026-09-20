---
id: "0006"
title: Coverage-gap matcher reports questions the library already answers
status: open          # open | triaged | agent-ready | in-progress | review | done
kind: chore           # bug | request | question | chore
priority: P3          # P0 | P1 | P2 | P3 — see issues/README.md for the SLA ladder
reporter: juan
page: /library
created: 2026-09-20T05:36:13Z
labels: []
---

The fee-load objection from Cedar Trust appears under "questions with nothing approved behind them", but the approved fee-terms answer covers it. The matcher needs two shared words over four characters and these two phrasings do not overlap.

Deliberate for now — over-reporting wastes a minute, under-reporting hides the question you keep being asked — but it should improve before anyone works the backlog top-down.

```json context
{
  "route": "/library",
  "component": "coverageGaps",
  "filters": {},
  "user": "juan"
}
```
