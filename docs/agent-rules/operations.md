# Issues and working practices

Rules moved from AGENTS.md. Read this file when its scope applies; all rules still hold.

## Issues live in this repo as markdown

`issues/0001-slug.md`, git-tracked. A coding agent reads them natively — no API token, no
webhook. The request and its fix travel in one PR. They survive `npm run db:reset`.

```markdown
---
id: "0001"
title: Guard message doesn't say whose ask is blocking
status: open          # open | triaged | agent-ready | in-progress | done
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

## Throughput: nights and long unattended stretches (Juan, 27 Sep 2026)

Juan: nights are long stretches without his feedback and should produce a lot, at high quality
and fast ("important and urgent"). The night of 26–27 Sep produced 252 new LPs and 138 strategies, but
most builder slots sat idle most of the time. Measured causes:
- **Concurrency averaged 2–3 of 7 ChatGPT slots.** Claude's own research agents (`lp-researcher`,
  `strategy-writer`) were not used at all.
- **Idle gaps:** 3.5 h (10:30–14:10) with nothing running and no summary. About 1 h (08:00–09:05) was
  spent waiting on a watch loop instead of launching work.
- **A serial pipeline with Claude in every hop:** source → add prospects → export → W3 → W5 → import,
  each waiting for the one before, and every live import blocking the next.
- **Launches were reactive,** one after a notification, with no queue of next runs ready.

Rules:
1. **Keep every slot busy.** Overnight, run 6+ ChatGPT runs (b1–b6, build) and 2–4 Claude
   sub-agents at once. Keep a ready queue of briefs, at least the next three, so a finished run is
   replaced within minutes. An empty slot is a defect to report in the summary.
2. **Heartbeat, not watch loops.** Every wait gets a timeout. A 10–15 minute heartbeat checks every
   run, relaunches finished slots, and imports. The 30-minute summary is a hard timer, and a missed
   one is reported as missed.
3. **End-to-end runs.** A sourcing run writes the W1 profiles and the W5 strategies in the same pass,
   and the Netholabs-style rounds prove the quality holds. Claude runs Add prospects, export, W3 and
   Import the findings once per wave (about hourly), not once per run.
4. **Work on what moves money first.** Before a night starts, rank the work by importance × urgency
   and write the order down, for example: meetings and events in the next two weeks, then warm
   paths to Discussing and Committed LPs, then sourcing, then tooling. Design and logic run beside
   it, never instead of it.
5. **Measure output, not activity.** Every summary shows:
   - slots busy versus idle;
   - qualified LPs added, strategies written, new warm paths, and issues closed;
   - the tactic yield per round, with the next round's tactic chosen from it.
6. **Quality still gates live:** tsc, boundaries and props before every merge, and a self-graded
   sample on every research round. Speed comes from parallel work, not from skipping checks.

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

- **`npm run e2e`** (issue 0116) drives the basics through the real pages on its own demo server (port 3150–3199) and checks each change in the database, in about 40 s.
  `E2E=1 bash scripts/gate.sh` adds it to the gate; when a basic action breaks, add its check to `scripts/e2e.ts`.
- **Changelog screenshots** are 2000 px WebP at quality 80 (`scripts/shot-image.ts`).
  `npm run shots -- <version>` captures against the running demo server, writes
  `docs/changelog/shots/<version>/NN-name.webp`, and prints each file's size. Link them from
  `docs/changelog/entries/<version>.md` with the `.webp` name. Never commit a PNG there: `npm run boundaries` fails
  on one, and on any file over 512 KB. `npm run shots:compress` converts a stray capture and
  fixes its links. Git keeps every image forever, so size is paid on every clone.
- **Builders who can't run a server (ChatGPT/Astra sandboxes) can't take shots.** The integrator
  takes them at merge: for every merged entry that changes something visible, run a `shot-taker`
  before shipping. An entry with a visible change and no shot is not done (issue 0115, 28 Sep 2026:
  batches 13–19 shipped without images).

- Prose in docs and UI copy: plain, specific, no hype. Say the number or say you don't know
  it.
- When a constant is a guess, say so in the comment. Do not launder an estimate into a fact.
- Push back when the plan is wrong. Two design reviews improved this materially; a third
  would too.
