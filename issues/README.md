# Issues

One markdown file per issue, git-tracked, named `NNNN-slug.md`. The in-app feedback box
writes them. A coding agent reads them natively — no API token, no webhook, no sync.

The format is in `CLAUDE.md`. The short version: YAML frontmatter with
`id, title, status, kind, priority, reporter, page, created, labels`, then a paragraph of
prose, then a fenced ` ```json context ` block capturing route, user, entity, vehicle and
active filters at the moment the button was pressed.

Triage adds `assignee: claude | chatgpt` and the `branch:` the work goes on
(`docs/COLLAB.md`). The issues page rewrites a file when its status changes, and keeps every
frontmatter field it does not manage.

Issues filed on the real server live in `data/real/issues/`, are never committed, and have
their own numbers.

## Priority ladder

| | Triaged within | Fixed within |
|---|---|---|
| **P0** | same business day | 1–2 days |
| **P1** | 1 business day | 1 week |
| **P2** | 2 business days | next version slice |
| **P3** | weekly triage | backlog |

## Why files and not a database

The complaint and its fix travel in the same pull request. They survive `npm run db:reset`.
They are editable in an editor. `git log issues/` is free triage history.

`IssueSink` stays an interface, so `GitHubIssueSink` drops in later without touching
callers.
