---
id: "0011"
title: Issues Page
status: done          # open | triaged | agent-ready | in-progress | review | done
kind: bug             # bug | request | question | chore
priority: P2          # P0 | P1 | P2 | P3 — see issues/README.md for the SLA ladder
reporter: juan
page: /issues/0008
created: 2026-09-21T22:33:57Z
labels: []
screenshots: [attachments/0011-screenshot.png]
attachments: [attachments/0011-screenshot.png]
---

- The issues page is for development, so we should move it under \`Developer\`
- The page should maybe show history of fix (ie if it was fixed, the bottom should say which version / commit it was fixed in. 
- ofc, this will eventually leverage github, but my sense is the intake will still likely happen in the app itself (given the lack of user accounts, etc.) so maybe having some more info here helps.

![Screenshot](attachments/0011-screenshot.png)

```json context
{
  "route": "/issues/0008",
  "filters": {},
  "user": "juan"
}
```

**Done (N33).**

- The issues pages live under **Developer** now, in the rail and in the breadcrumb.
- Every issue carries the version that closed it. The list has a **Fixed in** column linking
  to the changelog entry, and the issue page names what that version changed with a link to
  the paragraph. It is read from the closing note in the file rather than tracked separately
  — a second place to write it is a second place for it to be wrong.
- `fixed_in:` in the frontmatter takes precedence when somebody wants to be explicit.

On intake staying in the app: agreed, and it is why the sink is an interface. `GitHubIssueSink`
can take over the storage without the feedback box changing at all.
