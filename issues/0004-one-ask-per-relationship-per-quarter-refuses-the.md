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

**Half done (N30), and the half that matters is still yours.** The report no longer prints
the same collision twice: when every ask the frequency guard counted is one of the competing
asks, the frequency block is marked as subsumed by the conflict, the heading reads
`1 guard refusing · 1 more is the same collision`, and the row says so in words.

**The decision is untouched and still needed.** `guard.asksPerRelationshipPerQuarter` is 1
across all four vehicles, and it cannot be both a per-vehicle cap and a cross-vehicle one.
Per vehicle: the conflict case does the real work and the frequency guard stops firing on
every collision. Across vehicles: the conflict case is nearly redundant. The constant is a
guess either way — this change only stops the ambiguity from being reported as two problems.
