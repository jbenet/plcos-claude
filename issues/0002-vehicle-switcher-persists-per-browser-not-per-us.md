---
id: "0002"
title: Vehicle switcher persists per browser, not per user
status: done          # open | triaged | agent-ready | in-progress | review | done
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

**Done (N30).** The cookie holds a map of handle → slug rather than one slug, so switching
user switches back to that person's own vehicle. It is still a cookie and still per browser
— what it is not any more is shared between the people using that browser. A cookie written
before the change is read as belonging to whoever is signed in when it is first seen.
