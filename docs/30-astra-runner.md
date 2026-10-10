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

## One run

1. Cut one batch with `enrich-batch.ts <w1|w5> astra-<job>- <size> --max 1` (whole firms; keys already in an open
   batch are skipped, so two runs never take the same LPs). Nobody left means the run is done with 0 LPs.
2. Fill the fixed brief from `scripts/astra/templates/` (W1, W5 or W1+W5), with three recent findings and two recent
   strategies as example paths.
3. Begin a ledger run (`source: chatgpt`, agent `astra-runner`).
4. Run `codex exec` in a free slot (the `plcos-codex-bN` worktrees beside the live checkout when present, else plain
   folders), sandboxed to write only in its folder and `enrich/`, with web search. `gpt-6-astra` first; `gpt-6-sol`
   only when the first says "at capacity" and wrote no final message. Stopped after 3 hours.
5. Push each finding and strategy the run wrote with `cloud-push.sh` (the importer's checks run first; the server
   queues the import). Finish the ledger run with usage estimated from codex's own session logs. Report counts.

A run that wrote nothing gives its LPs back (the batch file is renamed `.unrun`). When both models are at capacity
the runner claims nothing for 30 minutes. Briefs and logs stay under `plcos-data/real/workflows/astra/`.

## Not yet

W1c and W13 runs; a retry button; the page showing each run's codex log tail (it stays on the Mac).
