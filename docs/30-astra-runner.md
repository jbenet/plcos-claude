# 30 · The Astra runner

Juan, 10 Oct 2026: "I think we need to build a setup with Astra that I run with it and is not coordinated by you,
since you cannot do it reliably ... where i can monitor and trigger workflows to astra directly", and "should not go
through claude, should be able to have a UI and trigger astra automatically."

Two nights of Astra batches were lost because a Claude session on the Mac had to launch `codex exec`, and its
permission check refused. The runner takes Claude out of the launch path entirely.

## The pieces

- **Developer → Astra** on the server (`app/dev/astra`). Queue runs (workflow, how many, LPs per run, Now or
  Tonight), turn on **Every night** (workflow, runs a night, the night window), pause the runner, cancel or stop a
  run, and watch each run's status, worker slot, model and counts. Admin only. Works from a phone.
- **`platform.astra_job` and `platform.astra_runner`** (migration 024). Workflows, sizes, statuses and counts.
  Never a name: batches are cut on the Mac.
- **`POST /api/sync/astra`** (`lib/sync/astra.ts`), with the Admin token. The runner polls (heartbeat, slots, the
  night window) and is handed queued runs; it reports each run's progress. The server launches nothing, and it can
  hand out only a workflow and a size, never a command or a brief.
- **The runner** (`scripts/astra-runner.ts`) on the Mac, started by Juan once: `npm run astra` in the live checkout,
  or as a login item with `npm run astra:install` (or double-click `scripts/astra/Install Astra runner.command`
  in Finder). It runs as Juan, so no Claude permission check is ever involved. `npm run astra:uninstall` removes it.
- **The Astra app** (`desktop/astra`, Tauri; 11 Oct 2026). A menu-bar app that runs and restarts the runner, shows
  its state and the server's, queues runs (`op: "queue"`), opens Developer → Astra in its own window, and files
  feedback by token (`/api/sync/feedback?op=file`). It replaces the login item; use one or the other.

## One run

1. Cut one batch with `enrich-batch.ts <w1|w5> astra-<job>- <size> --max 1` (whole firms; keys already in an open
   batch are skipped, so two runs never take the same LPs). Nobody left means the run is done with 0 LPs.
   **Shorten strategies (W5)**, `w5t` (11 Oct 2026), adds `--tighten`: strategies written before W5 1.13 whose
   vehicle's pursuit is Committed, then Discussing, Connecting and Selected, in either layout (Juan: "start further
   down the pipeline and work way back to selected ones. (Don't need to go beyond that for now)").
2. Fill the fixed brief from `scripts/astra/templates/` (W1, W5, W1+W5 or the shortening pass), with three recent
   findings and two recent strategies as example paths (the shortening pass names its exact read set instead and
   gets no examples).
3. Begin a ledger run (`source: chatgpt`, agent `astra-runner`).
4. Run `codex exec` in a free slot (8 by default, `ASTRA_SLOTS` up to 12; the `plcos-codex-bN` worktrees beside the
   live checkout when present, else plain folders), sandboxed to write only in its folder and `enrich/`. Only W1 and
   W1+W5 get web search; W5 and the shortening pass work from local files. `gpt-6-astra` first; `gpt-6-sol` only when
   the first says "at capacity" and wrote no final message. Stopped at its workflow's limit (`RUN_LIMIT_MS`: W1+W5
   2 h, W1 90 min, W5 45 min, shortening 25 min).
5. Push each finding and strategy the run wrote (strategies in vehicle folders too) with `cloud-push.sh` (the importer's checks run first; the server
   queues the import). Finish the ledger run with usage estimated from codex's own session logs. Report counts.

A run that wrote nothing gives its LPs back (the batch file is renamed `.unrun`). When both models are at capacity
the runner claims nothing for 30 minutes. Briefs and logs stay under `plcos-data/real/workflows/astra/`.

## Keeping the runner current, and admin from the page

Juan, 11 Oct 2026: "built some RC type thing for the runner on the Mac so you can help admin it".

- **Commands** (migration 026, `platform.astra_command`). Developer → Astra has **Check**, **Update** and **Restart**;
  an Admin token does the same with `op: "command"`, so a Claude session holding one can admin the runner without
  touching the Mac. The runner takes a command on its next poll and answers with `op: "command-report"`; the page
  lists the last few. Check reports the code it started on, the checkout's commit, how far behind master it is, local
  changes and whether the fetch worked. Update fast-forwards to `origin/master` (with `npm ci` when the dependencies
  changed) and restarts; Restart restarts. Both wait for running batches and claim nothing new meanwhile. Three fixed
  commands: the server can never hand the runner a command line.
- **Which code.** Each poll carries the commit the runner started on (the page's Code), the workflows it can run
  (`workflows`; a runner that names none gets only W1+W5, W1 and W5) and the commands it takes (`commands`; one that
  names none is given none).
- **Restarts.** Restart and Update exit the runner; launchd (the login item) and the Astra app start it again. A runner
  started by hand with `npm run astra` stays stopped, and says so in its answer.
- **Self-update.** Under launchd or the Astra app (found by `ASTRA_SUPERVISED=1`, launchd's label, or the app up its
  parent chain), an idle runner fetches every ten minutes and restarts whenever the checkout differs from the code it
  started on, so a pull made by hand also takes effect. It never updates with local changes, off `master`, or when
  the dependencies changed (that waits for Update).
- **Fetching.** HTTPS first for a GitHub remote, through git's credential helper (`gh auth git-credential` on the
  Mac), since 1Password's SSH agent can refuse to sign for a background process; SSH in batch mode is the fallback.

## Not yet

W1c and W13 runs; a retry button; the page showing each run's codex log tail (it stays on the Mac).
