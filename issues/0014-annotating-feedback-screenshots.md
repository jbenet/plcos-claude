---
id: "0014"
title: Annotating feedback screenshots
status: done          # open | triaged | agent-ready | in-progress | review | done
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

**Done (N32).** A label is an object now, not a one-shot stamp.

- The field is a **transparent floating textarea**. Return makes a line break; ⌘↵ or Escape
  leaves it.
- It **wraps** at its own width, and that width is a corner you drag.
- After placing: drag to move, drag the corner to resize, double-click to type in it again,
  and the floating bar changes size, weight and colour of the label you have selected rather
  than of the next one you place.
- **Escape keeps the text.** It leaves the field, then the selection, then the editor — one
  level per press. It used to throw the label away, which is why three of them went missing.
- Placed labels live as DOM elements while you edit and are composited onto the image once,
  at export, wrapped the same way they were on screen.

One thing that is not there: undo does not step back through a move or a resize. The undo
stack is a stack of marks, not of states, and a drag edits a mark in place.
