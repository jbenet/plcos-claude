---
id: "0005"
title: Nothing records cash arriving
status: done          # open | triaged | agent-ready | in-progress | review | done
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

**Done (N30).** The hard track has a *Record the wire* control on every row that has been
countersigned and not yet received. It takes the date and the bank reference, and refuses
without the reference — "it landed" with no receipt is a recollection.

It is deliberately **not** gated by a MONEY ticket. The five approval kinds authorise things
we are about to do; a wire is something that has already been done to us, and a system that
refuses to write down money it has received is lying about its own bank account. The audit
log carries the actor, the reference and the date.
