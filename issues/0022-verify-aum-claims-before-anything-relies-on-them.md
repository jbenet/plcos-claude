---
id: "0022"
title: Verify AUM claims before anything relies on them
status: open          # open | triaged | agent-ready | in-progress | review | done
kind: request         # bug | request | question | chore
priority: P3          # P0 blocking | P1 serious | P2 normal | P3 someday
reporter: juan
page: /dev/affinity/mapping
created: 2026-09-23T02:10:00Z
labels: [affinity, research]
---

Filed by Claude at Juan's request (chat, 23 Sep): "AUM is some info about the AUM in their fund.
We need to take this as one input to verify later on. It's a claim, like something we may have
found on a website, and we may need to validate. Not sure how to handle that atm — don't want to
overcomplicate our data model much atm. Maybe file this away as a todo to look into in the future."

Where it stands: the mapping (N46) names each list's AUM field. Translation (N47) brings it in as a
research claim on the LP, with its provenance — the list, the date it was read — and **low
confidence, unverified**. Nothing uses it for capacity, sizing or ranking.

To decide later:

- What counts as verification: a filing (Form ADV, 13F), the LP's own materials, a data provider,
  or a person on the team who knows.
- Whether a verified AUM supersedes the claim (research claims already support supersession), and
  who may mark one verified.
- Whether capacity scoring (L9) may read an unverified AUM at all, or only a range around it.

```json context
{
  "route": "/dev/affinity/mapping",
  "filters": {},
  "user": "juan"
}
```
