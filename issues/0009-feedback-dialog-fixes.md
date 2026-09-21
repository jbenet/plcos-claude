---
id: "0009"
title: feedback dialog fixes
status: done          # open | triaged | agent-ready | in-progress | review | done
kind: bug             # bug | request | question | chore
priority: P2          # P0 | P1 | P2 | P3 — see issues/README.md for the SLA ladder
reporter: juan
page: /dev/feedback
created: 2026-09-21T22:29:31Z
labels: []
---

Feedback dialog:

- pressing `esc` should cancel/exit the feedback dialog.
- editing in markdown src feels buggy-- something is changing text... (eg trimming whitespace (so cannot type words sequentially), and placing cursor at the end
- editing in markdown src autoescapes things like \`\`\` quotes
- cannot submit w/o a screenshot. shouldbe able to
- should not need a title.

```json context
{
  "route": "/dev/feedback",
  "filters": {},
  "user": "juan"
}
```

**Done (N31), four of five.**

- `esc` closes the box. It closes the shortcut card first, then the annotation editor, then
  the box — one level at a time.
- **The Markdown tab no longer fights you.** The textarea was controlled by the same value
  the rich editor writes, so every keystroke went through TipTap, which trimmed trailing
  spaces, escaped backticks and handed back a different string — hence the cursor jumping to
  the end and fenced blocks being impossible. Source text is now the document while that tab
  is open; nothing round-trips until you ask for Rich.
- A screenshot was never required, but the disabled button made it look like it was. The
  button now enables on **either** a title or a description.
- The title is optional and intake writes one from your first line.
