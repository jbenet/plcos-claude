---
id: "0018"
title: Screenshots added to the markdown should be able to be annotated too
status: done          # open | triaged | agent-ready | in-progress | review | done
kind: bug             # bug | request | question | chore
priority: P2          # P0 blocking | P1 serious | P2 normal | P3 someday
reporter: juan
page: /rails/visualizations
created: 2026-09-22T20:04:07Z
labels: []
---

Screenshots added to the markdown (drag and drop) should be able to be annotated too

```json context
{
  "route": "/rails/visualizations",
  "filters": {},
  "user": "juan"
}
```

**Done (N35).** Pictures dropped into the description have their own strip under it, each
with **Annotate**, and drawing on one replaces it where it sits in the text.

Getting there turned up three older bugs in the same box, all fixed:

- **Rebuilding the rich view from markdown dropped every dropped-in picture from the view** —
  including the ordinary Markdown → Rich toggle. TipTap refuses `data:` URLs when it parses
  unless told otherwise; dropping worked only because it inserts the node directly.
- **A second picture replaced the first.** An inserted image was left selected, so the next
  drop — or the second file of a two-file drop — overwrote it.
- **Text after a picture was glued onto its line** in the stored markdown
  (`![shot](attachment:1)More words.`), so the issue file read back as a different document.
