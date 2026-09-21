---
id: "0010"
title: Feedback submit message confusing
status: done          # open | triaged | agent-ready | in-progress | review | done
kind: bug             # bug | request | question | chore
priority: P2          # P0 | P1 | P2 | P3 — see issues/README.md for the SLA ladder
reporter: juan
page: /dev/feedback
created: 2026-09-21T22:30:20Z
labels: []
---

> Written to `issues/0009-feedback-dialog-fixes.md`. It is a file in this repository, so it travels in the same pull request as its fix and survives `npm run db:reset`.

this is confusing for users. dont display that for users.

```json context
{
  "route": "/dev/feedback",
  "filters": {},
  "user": "juan"
}
```

**Done (N31).** The confirmation says *"Thanks — it is in the queue with this page, your
filters and any screenshots attached"* and links to the issue. The repo path, the pull
request and `npm run db:reset` are implementation detail the reporter did not ask about.
