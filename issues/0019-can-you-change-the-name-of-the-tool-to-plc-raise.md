---
id: "0019"
title: Can you change the name of the tool to "PLC Raise Tools" everywhere?
status: done          # open | triaged | agent-ready | in-progress | review | done
kind: bug             # bug | request | question | chore
priority: P2          # P0 blocking | P1 serious | P2 normal | P3 someday
reporter: juan
page: /issues
created: 2026-09-22T20:06:41Z
labels: []
attachments: [attachments/0019-image-1.png]
---

Can you change the name of the tool to "PLC Raise Tools" (instead of Capital OS) everywhere? for now. we may return to Capital OS later on

![Screenshot 2026-09-22 at 20.05.16.png](attachments/0019-image-1.png)

```json context
{
  "route": "/issues",
  "filters": {},
  "user": "juan"
}
```

**Done (N36).** **PLC Raise Tools** on every screen: the rail, the browser tab, the R&D
page, the published build log, and the label on anything handed to Linear.

It is one constant — `config/deployment.ts` → `product` — so going back to Capital OS is one
block. *Capital OS* stays as the codename in the code, the docs and the design history, and in
the storage keys and cookie names, which can't be renamed without signing everybody out and
resetting their theme and layout.
