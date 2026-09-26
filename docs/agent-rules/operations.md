# Issues and working practices

Rules moved from AGENTS.md. Read this file when its scope applies; all rules still hold.

## Issues live in this repo as markdown

`issues/0001-slug.md`, git-tracked. A coding agent reads them natively — no API token, no
webhook. The request and its fix travel in one PR. They survive `npm run db:reset`.

```markdown
---
id: "0001"
title: Guard message doesn't say whose ask is blocking
status: open          # open | triaged | agent-ready | in-progress | review | done
kind: bug             # bug | request | question | chore
priority: P1          # P0 | P1 | P2 | P3 — see issues/README.md for the SLA ladder
reporter: juan
page: /asks/new
created: 2026-09-20T14:31:00Z
labels: [coordination, copy]
---

What happened, in one paragraph.

```json context
{ "route": "/asks/new", "user": "juan", "entityId": "…", "vehicle": "neurotech",
  "conflictingAskId": "…", "filters": {} }
```
```

The in-app feedback box writes these files. `IssueSink` stays an interface so
`GitHubIssueSink` drops in at D2 without touching callers.

---

## Working notes

- **Two agents, one repo:** Claude and ChatGPT (Codex) work in separate git worktrees on their own
  branches, the live app runs from master, and Claude integrates. The layout, ports and rules are in
  `docs/COLLAB.md`.

- **Context and usage (Juan, 25 Sep 2026: "be smarter about context windows and usage").** The first
  six days used 832M input-token equivalents: 61% in sub-agents, and 77% of the main thread's share was
  re-reading its own context, a median 518K tokens a step. So:
  - One session per workstream. Start a fresh one for a new piece of work rather than carrying a long
    thread; the repo, CLAUDE.md, the docs and the changelog are the handoff.
  - Keep the main thread for decisions and small edits. Screenshots, visual checks and
    trial-and-error go to scoped sub-agents: `shot-taker` for the changelog shots, `feedback-fixer`
    (in its own worktree, on its own demo server) for a UI issue, Explore for a code search.
  - The workflows run as `lp-researcher` (W1), `fact-checker` (W1c), `strategy-writer` (W5) and
    `event-tagger` (W12), defined in `.claude/agents/` with only the tools each needs, and the smallest
    model that holds the quality: Haiku for mechanical checks, Sonnet for research and tagging, Opus
    for strategy judgment. Try a smaller one on a sample before a whole pass, and compare.
  - An agent reads its workflow's rules, not all of docs/19. A pass holds its inputs steady: no new
    export or rule change while its batches run.
  - Never dump long output into the conversation: filter to the lines that matter, and put a
    multi-step shell sequence in one script.
  - **Measured, 25 Sep 2026:** on the Max plan's limits, Sonnet counts at about 0.9× Opus per token
    (0.88 on the 5-hour window, 0.87 on the weekly, from a Sonnet-only fact check of 66M weighted
    tokens). A week is roughly 1,000M weighted Opus tokens (1% ≈ 9.8M; a 5-hour window's 1% ≈ 2.6M),
    weighting a cache read at 0.1, a cache write at 2 and output at 5. So a smaller model saves little
    against the cap: the levers are fewer tokens (small contexts, short rule files, no nested agents)
    and moving bulk work to ChatGPT. Haiku's rate is not measured; it failed the tagging pilot (66%).

- **Changelog screenshots** are 2000 px WebP at quality 80 (`scripts/shot-image.ts`).
  `npm run shots -- <version>` captures against the running demo server, writes
  `docs/changelog/shots/<version>/NN-name.webp`, and prints each file's size. Link them from
  `docs/changelog/entries/<version>.md` with the `.webp` name. Never commit a PNG there: `npm run boundaries` fails
  on one, and on any file over 512 KB. `npm run shots:compress` converts a stray capture and
  fixes its links. Git keeps every image forever, so size is paid on every clone.

- Prose in docs and UI copy: plain, specific, no hype. Say the number or say you don't know
  it.
- When a constant is a guess, say so in the comment. Do not launder an estimate into a fact.
- Push back when the plan is wrong. Two design reviews improved this materially; a third
  would too.
