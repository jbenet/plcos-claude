---
id: "0005"
title: Nothing records cash arriving
status: open          # open | triaged | agent-ready | in-progress | review | done
kind: request         # bug | request | question | chore
priority: P2          # P0 | P1 | P2 | P3 — see issues/README.md for the SLA ladder
reporter: juan
page: /close
created: 2026-09-20T05:36:13Z
labels: []
---

pipeline.recordCash exists, is tested, and is called by no screen. The close room shows what has been countersigned and the soft/hard page shows accepted-and-not-yet-wired, but there is no way to say a wire landed without going into the database.

Cash received is deliberately a separate state from an accepted commitment. Right now it is a separate state nobody can reach.

```json context
{
  "route": "/close",
  "missing": "recordCash UI",
  "filters": {},
  "user": "juan"
}
```
