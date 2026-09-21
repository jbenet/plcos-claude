---
id: "0014"
title: Annotating feedback screenshots
status: open          # open | triaged | agent-ready | in-progress | review | done
kind: bug             # bug | request | question | chore
priority: P2          # P0 | P1 | P2 | P3 — see issues/README.md for the SLA ladder
reporter: juan
page: /all/floor
created: 2026-09-21T22:47:40Z
labels: []
---

- entering text should be in a floating textarea (not single line text field), should allow return/line breaks, and  should be transparent (not white).
- should also be editable + movable and resizable (with wrapping) after placing it.
- also pressing \`esc\` when entering text exits the annotation, instead of exiting the editing of the text field (pops out one level too much).
- `esc` from annotation should probably save the annotation. i lost 3 annotations accidentally by trying to exit the text field by reflex.

```json context
{
  "route": "/all/floor",
  "filters": {},
  "user": "juan"
}
```
