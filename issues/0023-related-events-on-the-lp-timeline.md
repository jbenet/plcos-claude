---
id: "0023"
title: Related events on the LP timeline — outreach through connectors, and tasks
status: open          # open | triaged | agent-ready | in-progress | review | done
kind: request         # bug | request | question | chore
priority: P3          # P0 blocking | P1 serious | P2 normal | P3 someday
reporter: juan
page: /targets/[id]
created: 2026-09-24T03:30:00Z
labels: [timeline, coordination, linear]
---

Filed by Claude from Juan's feedback on an LP page (24 Sep): "wonder if we should include related
events here (like outreach efforts: us contacting a connector to get in touch with this person).
this maybe will get more interesting with related tasks on linear? (note todo on this for later
maybe)".

Where it stands after N61: the timeline has the LP's own touchpoints, the team's notes, updates
written on the page, status changes and the ladder. What happens around the LP, but not with them,
is not there:

- **Outreach through a connector.** Asking a connector for an intro, their answer, a reminder.
  These are asks (module 07, ask coordination) and relationship edges (module 05), each with its
  own record. On this LP's timeline they would read as "asked Sam for an intro — Sam is willing",
  which is also the record the ladder's first rung needs (Connector willing).
- **Tasks.** A Linear issue about this LP, its state and who has it (docs/14). Linear isn't
  connected (open question 3), so nothing can be read yet.

To decide later:

- Whether a connector's outreach shows on the LP's timeline, on the connector's page, or both,
  and how an ask that names several targets shows on each.
- Whether an update that says "Sam is happy to intro us" should suggest recording Connector
  willing (a STAGE ticket, with the update as its record). The N61 reader moves the status to
  Connecting on those words and suggests nothing for the ladder.
- For tasks: which Linear fields carry the LP, and whether a task's state belongs on the
  timeline at all, or only its creation and completion.

```json context
{ "route": "/targets/[id]", "user": "juan", "filters": {} }
```
