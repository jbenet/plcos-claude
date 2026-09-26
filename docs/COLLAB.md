# Working together: Claude, ChatGPT and the live app

How two coding agents — Claude (Claude Code) and ChatGPT (OpenAI's coding agent, also called Codex) —
work on this repo on one machine without overwriting each other, and how the live app stays out of their
way. Decided with Juan, 25 Sep 2026. Both agents read AGENTS.md; this file is linked from it. Where a
name says "codex" (a folder, a branch prefix), it means ChatGPT.

## The layout

```
plcos-claude-live   .git + master · real :3000 (the only writer of the real DB) · demo :3001
plcos-claude-dev    Claude: claude/* branches · preview :3100 (real snapshot) · demo :3101
plcos-codex-dev     ChatGPT: codex/* branches · preview :3200 (real snapshot) · demo :3201
plcos-data/real     the real data, outside every worktree; the live folder's data/real links here
```

- **One repository, three worktrees.** `plcos-claude-live` holds `.git` and `master`; the other two
  are `git worktree`s of it, each on its own branches. A branch is checked out in one worktree at a
  time, which is the guarantee that nobody edits under someone else. No remotes between them: every
  branch is visible to every worktree at once.
- **The live app runs from master only.** Nobody edits code in `plcos-claude-live`. It changes when the
  integrator merges checked work into master; the real server there is the one process that writes the
  real database. Juan's live links are `:3000` (real) and `:3001` (demo).
- **Each dev worktree has two servers.** A demo on its own fresh demo database, and a preview on a
  snapshot — a copy — of the real database, so in-flight work can be seen on real data. Anything
  clicked or written on a preview lands in the copy and is thrown away; the live database never sees
  it. Ports are `:X00` for the preview and `:X01` for the demo. Every port comes from `.ports.json`, by
  folder name; a sub-agent's worktree has no row and starts its demo with `PORT`, from 3110–3119 for
  Claude's and 3210–3219 for ChatGPT's.
- **The real data lives outside every worktree**, in `plcos-data/real`. The live folder reaches it
  through `data/real`, a link to `../../plcos-data/real`, so every path in the code and the docs stays
  `data/real/...`. In a dev worktree `data/real` is a plain folder holding the preview's copy, so a dev
  worktree can only ever reach a copy. The live server reads and writes the real data; workflow jobs
  (research findings, tags, strategies) run in the live folder to write there — run in a dev worktree,
  they would write into the copy, which the next preview throws away.

## Who does what

- **Claude integrates.** It merges `claude/*` and `codex/*` into master after the typecheck,
  `npm run boundaries` and `npm run props` pass on the merged result, resolves conflicts, and writes
  the changelog and the build log.
- **Numbers that could collide are assigned at merge:** a migration's `NNN_` prefix, a changelog
  version (N84 …), a screenshot folder. A migration reaches the real database only after merge, so
  renumbering it before then is safe.
- **Work arrives as issues.** The feedback box files them as it always has — no one filing feedback
  picks an agent. A hint in the text ("I think ChatGPT would be better at this") is taken as a hint.
  Claude triages new issues and requests: it sets `assignee: claude | chatgpt` in the issue's
  frontmatter, and the `branch:` the work goes on. One file per task, so the two never edit the same
  file. How ChatGPT gets its work is below, under *Handing work to ChatGPT*.
- **Issue files are committed on master, in the live folder.** The live demo writes each new issue,
  and each change made on its issues page, into `issues/` in the live folder's working tree: master,
  uncommitted. Claude commits them there, with its triage, in a commit of issue files only, before
  each merge — so a merge never meets an uncommitted issue file — and a branch sees them when it next
  merges master. Issues filed on the real server stay in `data/real/issues/`, never committed.
- **Rough split.** ChatGPT: self-contained UI fixes and features, workflow batches (research, fact
  checks, tagging), tests. Claude: schema and migrations, the real server's operations (translate,
  import), cross-cutting changes, integration. Juan can always name who.

## Handing work to ChatGPT

First done on 25 Sep 2026, with issue 0030; CHANGELOG N84 has what that round taught.

1. Claude triages: `assignee: chatgpt`, `branch: codex/NNNN-slug`, `status: agent-ready`, and a spec
   under "Triage" that ends with "Done when".
2. Claude queues the task into Juan's open ChatGPT session with the Codex CLI that ships inside the
   ChatGPT app: `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex queue --thread "<session name or
   id>" --message "…"`. The message names the issue file and the branch and carries no real data;
   ChatGPT reads the issue file where it is.
3. ChatGPT branches from master in `plcos-codex-dev`, does the work, runs the checks, and ends its last
   commit message with `Ready-for-review: NNNN`. It leaves the issue file alone, merges nothing and
   touches no other branch. Its questions go to Juan, in the session.
4. Claude watches the branch and the session's log (`~/.codex/sessions/`), reads the diff, merges the
   branch into `claude/main`, runs the three checks on the result and moves master. It sets the issue
   to `done` with a `closed_at:` UTC timestamp and a closing note and writes the changelog.

A session that is read-only with approvals on request waits for Juan at the first edit and at the
commit. Run headless instead (`codex exec`), ChatGPT can commit only with `.git/worktrees/plcos-codex-dev`,
`.git/objects`, `.git/refs/heads/codex` and `.git/logs/refs/heads/codex` added to its writable folders,
and with no network `npm run boundaries`, `npm run props` and its demo server don't run.

## Rules for both

- AGENTS.md's rules hold for both agents, above all the real-data rules and "no training on this
  data, for anyone".
- Only the live server opens the real database: PGlite allows one process per database directory,
  and a second one corrupts it. Everyone else reads files, the live app over HTTP, or a snapshot. The
  layout makes this structural, and the lock beside each database (`lib/db/lock.ts`) backs it up: a
  second process that opens the real database is refused by name. A preview's copy leaves the live
  server's lock behind, so the copy opens and the original stays locked.
- **Workflow batches work on the real data, never on a copy** (decided with Juan, 25 Sep 2026). A batch
  reads and writes `../plcos-data/real`, which is the live folder's `data/real`. A dev worktree's
  `data/real` is a preview copy, and the next preview replaces it.
  - Claude's workflow agents run in `plcos-claude-live` and change no code there.
  - ChatGPT runs batches from `plcos-codex-dev`, with `../plcos-data` added to its sandbox's writable
    folders.
  - Either way, a script that makes a batch runs in the live folder.
- Nobody fetches, pulls or pushes. Juan pushes master.
- File issues only from the live app, so issue numbers don't collide. On a dev worktree's servers the
  feedback box files nothing and links to the live app on the same host name, and `/api/feedback`
  refuses.

## Building it

All five steps are done: 1–4 on the branch `claude/collab-setup`, and the move (step 5) on 25 Sep 2026.

1. No `DATA_ROOT` and no path rewrite (decided 25 Sep 2026, for simplicity). Every path in the code
   and the docs stays `data/real/...`. In the live folder `data/real` becomes a link to
   `../../plcos-data/real` (step 5); in a dev worktree it is a plain folder holding the preview's copy.
   So "only the live server opens the real database" is structural: a dev worktree can only reach a
   copy.
2. `.ports.json`, tracked: a local dev setup for one machine, one row per folder name. A live row has
   `real` and `demo`; a dev row has `preview`, `demo` and `previewSource`. The old folder's row,
   `plcos-claude` (real 3100, demo 3000), let the branch merge before the move; it was removed after.
   `config/ports.ts` reads it, for the server and the scripts; `PORT` overrides a port, never what a
   folder may serve. One launcher, `scripts/serve.ts`, is behind `npm run dev`, `dev:real`, `preview`,
   `start` and `start:real`. It refuses a busy port before the Keychain is asked for the key, and
   `dev:real` on a dev row refuses with "This folder serves a copy: use npm run preview." Cookie names
   carry the port, so no two servers on one host share who you are or which vehicle you had open.
3. `npm run preview`, on a dev row only. It refuses a busy port, a `data/real` that is a link, and one
   that holds anything but its own copy, which it marks with `data/real/.preview-copy` (the time the
   copy was taken). It clones `previewSource` into a temporary folder (an APFS clone, `cp -c`; a plain
   copy where there is none), drops the live server's lock, renames the copy into place, checks that
   its database opens, and serves it with no Affinity key. The breadcrumb bar says "Copy of real
   data · Taken 2 h ago · changes here are thrown away". A copy taken while the live server writes can
   catch a half-written page; running preview again takes a new one.
4. The agent files and the docs name no ports; they point at `.ports.json`.
5. Last, because renaming a folder under a running session breaks it: stop the real server; in the
   live folder run `mkdir ../plcos-data && mv data/real ../plcos-data/real && ln -s ../../plcos-data/real data/real`;
   remove any other worktrees of it first (`git worktree list`), since the rename breaks their links;
   rename the folder to `plcos-claude-live` (master); add the worktrees
   (`git worktree add ../plcos-claude-dev -b claude/main`, `../plcos-codex-dev -b codex/main`); restart
   the real server from the live folder in its terminal loop, where its row puts it on `:3000` and the
   demo on `:3001`; point the folder named in `.claude/agents/*.md` at the new paths (the workflow
   agents at `plcos-claude-live`, where `data/real` is the real data); link Claude's project memory for
   the new folder paths to the existing one (it is filed by path). Then Juan opens Claude's next session
   in `plcos-claude-dev`, and ChatGPT's in `plcos-codex-dev`.

## Recording workflow runs (0036, slice A)

Every approved workflow batch uses the shared `plcos-data/real/workflows/runs.jsonl`.
This records execution, not approval or acceptance. Freeze the inputs and rules, coordinate
non-overlapping batches, and obtain the run's approval/envelope before starting. No workflow
is authorized merely by installing these scripts. Demo and preview roots are refused.

**Claude launchers and ChatGPT use the same steps**, from their own checkout:

1. Prepare a private metadata JSON file beside the existing batch under the shared real root.
   Its fields are below. Hash the exact protocol file (or a fixed concatenation of rule files)
   and the frozen batch manifest with SHA-256. Record resolved model, or null if unknown.
   `launchFolder` is the launcher's actual folder; `workerFolder` is the worker's actual cwd.
2. Run `DATA_PROFILE=real npx tsx scripts/workflow-run.ts begin <metadata.json>`.
   Save the UUID printed on stdout. If recording fails, **do not launch**.
3. Launch the bounded work. A Claude session in either folder uses this for each of
   `lp-researcher`, `fact-checker`, `strategy-writer`, and `event-tagger`; pass the run ID and
   private batch path, never records in the prompt. ChatGPT follows the same sequence for
   its own batches, using the shared sibling files, never its `data/real` preview.
4. Read the worker's counts/checks, including failures. Write the result JSON below and call
   `DATA_PROFILE=real npx tsx scripts/workflow-run.ts finish <runId> <result.json>`.
   The launcher owns this step; the sub-agent does not duplicate it. Inspect diagnostics,
   not just exit codes, before reporting a check passed. Unknown item counts stay null.
   Supply measured usage when available. Otherwise omit `usage` (or pass null) and the CLI
   estimates it from local session usage metadata for the run's window. The ledger writer
   refuses a finish without a usage object and `source: "measured" | "estimated"`.
   If no matching usage exists, it records an estimated object with null token counts and an
   explicit unavailable method, never an invented zero. Retry the same finish after a recording
   failure; do not silently leave the run unfinished.

Metadata shape (invented example; replace both hash placeholders with 64 hexadecimal digits):

```json
{
  "parentRunId": null,
  "workflow": "W1c",
  "operation": "review",
  "protocol": { "version": null, "hash": "<SHA-256 of rules>" },
  "source": "chatgpt",
  "agent": "ChatGPT",
  "model": null,
  "launchFolder": "/path/to/plcos-codex-dev",
  "workerFolder": "/path/to/plcos-codex-dev",
  "batch": { "id": "example", "manifest": "enrich/batches/example.txt", "hash": "<SHA-256 of manifest>", "planned": 2 }
}
```

`source` is `claude-code`, `chatgpt`, `script` or later `app`. Version is a string (for
example `"1.10"`), or null for an unversioned protocol. The begin command supplies the UUID,
UTC start time, initial unknown outcome and null unfinished counts. Keep descriptors private;
no data records belong in ledger lines, which must be under 4 KB including the newline.

Result shape (invented):

```json
{
  "counts": { "selected": 2, "written": 2, "valid": 2, "failed": 0, "skipped": 0 },
  "checks": [{ "name": "coverage", "status": "pass" }],
  "usage": { "input": 1000, "output": 100, "cacheRead": 400, "cacheWrite": 0,
    "reasoning": 20, "cost": null, "source": "measured" },
  "outcome": "succeeded",
  "reason": null
}
```

Checks use `pass`, `fail`, `not-run`. Outcomes: `succeeded`, `partial`, `failed`, `refused`,
`cancelled`, `unavailable`, `unknown`. Usage is
`{input, output, cacheRead, cacheWrite, reasoning?, cost, source}`; counts are individually
nullable. `input` includes cache reads/writes, `output` includes reasoning: do not add those
subsets twice. Cost is null or `{amount, currency}` for measured cost. Subscription tokens
are not dollars. Measured counts are integers; time/shared estimates can be fractional.
Legacy measured objects supplied without `source` are labelled `measured` by the CLI.
Finish repeats the start metadata automatically. An identical finish retry is harmless;
different results for an already finished run are refused. A missing finish is **unknown**:
inspect the worker/output before retrying, and give a new execution a new run ID.

For existing live-folder scripts, use the wrapper **in `plcos-claude-live`**:

```sh
DATA_PROFILE=real npx tsx scripts/workflow-script.ts <metadata.json> -- scripts/enrich-connect.ts
```

It calls the same begin/finish writer around the script, preserves script arguments and
records process exit (including failure). It sets source to `script` and model to null,
and uses the same finish-time usage fallback. Script runs have no matching model provider,
so their token estimates are unavailable unless a caller supplies measurements.
Item results remain unknown: a zero exit is not a claim that every output passed a quality
check. A killed wrapper may leave only a start. Do not wrap an already recorded agent's
internal check as though it were another batch. Never use this wrapper to open the real DB.

The reader in `lib/workflows/ledger.ts` folds by run ID and exposes malformed lines and
conflicts. App pages/DB projection are later slices. No heartbeats, locks, receipts or
automatic repair: recording errors stop new work until the operator reviews them.

### Retrospective usage estimates

From the live folder, run `DATA_PROFILE=real npx tsx scripts/workflow-usage.ts YYYY-MM-DD`.
It reads the shared ledger and local `~/.codex/sessions` / `~/.claude/projects` usage metadata,
including Claude subagent transcripts. Message bodies, prompts and tool contents are skipped
without decoding. It writes only `workflows/usage-estimates.jsonl` under the shared real root,
one entry per run ID, preserving other dates and replacing estimates on rerun. `runs.jsonl`
and the database are unchanged. The table groups totals by workflow and night, where night
means the run's UTC start date; it includes completed runs and shows unavailable counts.

Each entry is marked `estimated` and carries input, cachedInput, output, reasoning, cacheWrite,
method and session IDs used. Codex cumulative counter deltas are prorated over time between
usage updates, including a sample after a window ends when available; the first delta starts
at session creation (or is a point observation if that timestamp is missing). Repeated totals
add no tokens but advance the time baseline; counter resets start a new segment. Claude per-message usage is a point observation
at its last update, deduplicated by message ID using maximum counters. Input includes cache reads
and writes for both providers. Reasoning absent from a usage report contributes zero, meaning
not separately reported, not proof that no reasoning tokens were used.

Sessions match by provider and worker/launcher cwd. No historical ledger session ID exists,
so unrelated activity in the same folder can contribute: these are estimates, not measurements.
At each overlapping interval/point, usage is split evenly among concurrent matching runs,
including runs outside the requested date and unfinished runs. Uncovered time is not assigned.
An unfinished run competes through the estimate's cutoff (the latest selected finish). The CLI's
live finish captures a single end time before scanning, includes concurrent unfinished runs,
and reuses a recorded estimate on retry. Future overlapping finishes may gain later usage
reports; retrospective reruns provide a consistent view once sessions have settled.
