---
id: "0006"
title: Coverage-gap matcher reports questions the library already answers
status: done          # open | triaged | agent-ready | in-progress | review | done
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

**Done (N30).** The matcher stems crudely (plurals and `-ing`/`-ed`/`-ly`), drops stopwords,
and keeps short domain words like *fee*, *term* and *lock* that the old four-character filter
threw away. It now matches on two shared stems **or** one shared stem of six characters or
more, which is enough for "fee load" and "fee terms" to find each other.

It still over-reports rather than under-reports, on purpose: a gap listed twice wastes a
minute, a gap hidden is the question you keep being asked and never write down.
