---
id: "0002"
title: Vehicle switcher persists per browser, not per user
status: open          # open | triaged | agent-ready | in-progress | review | done
kind: question        # bug | request | question | chore
priority: P3          # P0 | P1 | P2 | P3 — see issues/README.md for the SLA ladder
reporter: juan
page: /system
created: 2026-09-20T04:04:34Z
labels: []
---

Switching to Mara and then changing vehicle leaves the choice in place when you switch back to Juan. The cookie is per browser, so two people sharing a laptop share a vehicle selection.

Harmless at L1 with one person. Worth deciding before D1, because it is the kind of thing that silently changes what a shared screen is showing.

```json context
{
  "route": "/system",
  "filters": {},
  "user": "juan"
}
```
