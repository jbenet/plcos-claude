---
id: "0004"
title: One ask per relationship per quarter refuses the Roos ask twice for one reason
status: triaged       # open | triaged | agent-ready | in-progress | review | done
kind: question        # bug | request | question | chore
priority: P1          # P0 | P1 | P2 | P3 — see issues/README.md for the SLA ladder
reporter: juan
page: /approvals
created: 2026-09-20T05:36:13Z
labels: []
---

The Neurotech ask on Delia Roos is refused by both the frequency guard and the cross-vehicle conflict. They are the same collision counted twice, because guard.asksPerRelationshipPerQuarter is 1 across all four vehicles.

If the cap is meant per vehicle, the conflict case does the real work and the frequency guard stops firing on every collision. If it is meant across vehicles, the conflict case is nearly redundant. It cannot be both, and the constant is a guess either way.

This needs a decision before the number means anything.

```json context
{
  "route": "/approvals",
  "constant": "guard.asksPerRelationshipPerQuarter",
  "value": 1,
  "filters": {},
  "user": "juan"
}
```
