---
id: "0013"
title: Factory floor separate pages.
status: done          # open | triaged | agent-ready | in-progress | review | done
kind: bug             # bug | request | question | chore
priority: P2          # P0 | P1 | P2 | P3 — see issues/README.md for the SLA ladder
reporter: juan
page: /all/floor
created: 2026-09-21T22:45:19Z
labels: []
screenshots: [attachments/0013-screenshot.png]
attachments: [attachments/0013-screenshot.png]
---

- These two should be separate pages (one is across all of PLC, and one is across all of PLC + PL R&D).
- Let's rename all these from "Factory Floor" to "Visualizations". and sink it to the bottom in the overview (below calendar)

![Screenshot](attachments/0013-screenshot.png)

```json context
{
  "route": "/all/floor",
  "filters": {},
  "user": "juan"
}
```

**Done (N33).** Three scopes, three URLs, and the name changed.

- `/everything/visualizations` — every vehicle on file, the grants rail included. This is the
  one in **Overview**, now at the bottom, below Calendar.
- `/all/visualizations` — PL Capital's vehicles only. This is the one under **All vehicles**.
- `/<vehicle>/visualizations` — one raise.

They were the same URL under two labels, which made one of the two labels a lie. The grants
rail is excluded from the PL Capital roll-up because a rail that cannot be approached until a
funder invites us does not belong in one.
