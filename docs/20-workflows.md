# Workflows — lean v1

Issue 0036, 26 Sep 2026. **Design only; Juan decides before implementation or runs.**
Private plan: `plcos-data/real/enrich/plan-2026-09-26.md`. AGENTS.md and [COLLAB](COLLAB.md) apply.

## One source of runs

Developer → Agents reads `modules/agents` database runs; its default latest-20 list also
limits the displayed count. External workflows write artifacts without creating those
rows. Record all sources in **`plcos-data/real/workflows/runs.jsonl`**. Count independently
of pagination. Both pages will share one repository: ledger execution history, DB projection,
DB-owned acceptance and tool audit.

## Workflow inventory

Paths: shared `real/enrich/`, except W12 under `real/`. **F**: ChatGPT in `plcos-codex-dev`
(default), or Claude sessions in either worktree, using explicit shared paths. **L**:
scripts/batch cutting in `plcos-claude-live`; named Claude sub-agents also work there.
Only the live server opens the real DB.

| Workflow | Reads → writes | Protocol / executor |
|---|---|---|
| W0 Research set | Pipeline/team → `research-set.jsonl`, `candidates.jsonl`, `team.json` | docs/19; L export |
| W1 Profile | Identity batch/public web → `raw/<key>.json` | W1 **1.49**; F or lp-researcher |
| W2 Profile us | Team/web → `us/<handle>.json`, `us/network.json` | docs/19; F |
| W3 Connections | Findings/team/exported contacts → `connections.jsonl` | docs/19 + connect rules; L |
| W4 Fit/angle | Findings/theses → part of `strategy/<key>.json` | W5 **1.10**; within W5 |
| W5 Strategy | Paths/triage/findings/pursuits/context → `strategy/<key>.json` | W5 **1.10**; F or strategy-writer |
| W6 Presence | Public pages → `presence/*.json` | docs/05 rubric; F |
| W7 Materials | W6/materials → `presence/materials.json` | docs/01 §4; F |
| W8 Synthesis | Workflow outputs → `synthesis.md` | docs/19 + synthesis script; L |
| W9 Triage | Pipeline/findings/paths → `triage.jsonl` | docs/19 + triage rules; L |
| W1s Structure | Existing facts → raw finding's detail fields | W1 rules; F |
| W11 Connectors | W3/W9/W5/restrictions → `connectors.json` | docs/19 + connector rules; L |
| W5c Critic | W5 and its inputs → `strategy-review*.jsonl` | W5 **1.10** rubric; F, separate context |
| W1c Fact check | Findings/cited URLs only → `fact-review-*.jsonl`; separate correction updates raw | W1c rules; F or fact-checker |
| W2n Directory | Identities/public directory → `us/pl-network.json`, `us/pl-directory.jsonl` | docs/19 + directory script; L |
| W12 Tags | `tags/batches/tNN.json` from DB copy → `tags/out/tNN.json`, merged `event-tags.jsonc` | W12 **1.1**; F or event-tagger; merge L |

Active rules: `docs/workflows/`; inventory/history: [docs/19](19-enrichment-workflows.md#the-set).
Unversioned protocols record null plus rules hash. Versions are strings. W1d is a W1
method; no W10 exists. W4 within W5 counts once. Record actual models, not defaults.

## Ledger and CLI

All executors append through `scripts/workflow-run.ts begin|finish`. Resolve the canonical
real root from the layout; refuse demo/preview roots. No application-wide DATA_ROOT override.

- `begin` validates metadata, appends a **started** line and prints a UUID. If append fails,
  do not launch. `finish` appends a **finished** line with the same ID after checks.
- One UTF-8 JSON object/newline, **under 4 KB**, per `appendFile` with O_APPEND. Reject
  oversized lines; reference private batch manifests. No per-run folders or receipts.
- Readers fold by run ID. Start without finish means **unknown**, never success or a
  heartbeat-based claim of activity. Identical duplicate lines do not increase counts;
  conflicting metadata/finishes are flagged, not silently replaced. Retries use new IDs.
- Malformed/incomplete lines flag incomplete history for operator review. Preserve the
  file; no automatic repair.

Fields on each line (finish repeats identity metadata):

| Fields | Meaning |
|---|---|
| `event`, `runId`, `parentRunId` | started/finished, UUID, optional parent |
| `workflow`, `operation`, `protocol {version, hash}` | Workflow, bounded operation, exact rules |
| `source`, `agent`, `model` | Claude Code, ChatGPT, script or later app; unknown model is null |
| `launchFolder`, `workerFolder` | Session location and actual worker cwd |
| `batch {id, manifest, hash, planned}` | Private selection reference/hash/count |
| `startedAt`, `endedAt` | UTC times; endedAt null on start; unknown historical times stay null |
| `counts {selected, written, valid, failed, skipped}` | Item counts; unfinished/unknown counts null |
| `checks [{name, status}]` | pass/fail/not-run; no invented passes |
| `usage` | Known input/output/cache tokens and measured cost when available; otherwise null |
| `outcome`, `reason` | unknown/succeeded/partial/failed/refused/cancelled/unavailable; concise reason |

Approved envelopes, frozen inputs, budgets and tool restrictions still apply. Operators
coordinate batches. Execution success is separate from acceptance, import, close or cash.

## Wiring and the app

The **launching session** calls begin and finish for each of the four Claude definitions:
`lp-researcher`, `fact-checker`, `strategy-writer`, `event-tagger`. Workers return counts/checks;
launchers record results, including failure. ChatGPT follows the same steps. A live-script
wrapper calls begin, executes, then finish with exit/check results. A killed launcher leaves
unknown; inspect outputs before retrying. No hook or transcript scrape required.

In slice D, `modules/agents` exposes the shared reader and projects runs by the same UUID;
external workers never open the DB. Preserve app IDs, envelopes, audit and acceptance.
Switch Agents to this repository; until then label its limited scope. Show projection
failures for manual retry without re-execution.

Later app launches call the same begin/finish writer around `runInEnvelope`, with
`source: app`; non-workflow tasks use workflow null. Existing approval/tool guards remain.
Acceptance joins by run ID. DB/file writes are not atomic: show discrepancies for manual
reconciliation; no outbox in v1.

## Backfill and page

Backfill starts with a private dry run over batches, artifact metadata, reviews and logs.
Only evidenced executions create runs, with stable IDs preventing duplicates. Files/mtime
alone prove neither runs nor dates. Leave uncertain groupings in the report, unknown fields
null: **at least N recorded executions**. Optional local transcript metadata supplies usage,
never the inventory or transcript bodies. Do not sum overlapping log totals.

Developer → Workflows: read-only table, run inspector and keyboard-accessible loop list
showing coverage, dependencies and waits. Show sync time, profile, corpus date and read
health. Demo uses invented fixtures; preview only its labelled copy. Server paths are
fixed/validated; reject traversal and escaping symlinks. No arbitrary file URLs/transcripts.

Measures: distinct folded attempts (parents separate); unique eligible items done/pending,
not summed batch counts; latest protocol; checks/review/acceptance/import separately.
Changed inputs mean stale; an older version needs impact review. Fact quality is supported /
readable facts, alongside readable / all facts, all five grades and identity outcomes.
Strategy grades show rubric, sample size and coverage; tags show coverage, not invented
accuracy. Usage/cost includes known-run coverage: unknown is not zero, subscription tokens
are not dollars. Missing historical input hashes mean current quality is unverified.

States name the condition, actor and safe next step:

| State | Action |
|---|---|
| Empty / loading | Operator sees scope or waits; no assertion that nothing ever ran |
| Failed sync / recording | Claude inspects failure; retain dated counts, never replace with zero |
| Expired permission / revoked authorization | Stop; Juan decides fresh authorization |
| Stale evidence | Operator freezes new inputs and selects affected work |
| Conflicting edits | Claude compares outputs; no silent overwrite |
| Unavailable owner | Juan assigns an owner; remain waiting |
| Paused / exhausted budget | Owner reviews pause; Juan approves any budget extension |
| Rejected claim | Correct within scope, then recheck; identity decisions stay human |
| Ambiguous external execution | Claude reconciles start/output before retry |
| Source unavailable / partial output | Record gaps; no bypass; retry only approved scope |

## Phase 2, in order

**A — Writer and wiring, tonight if Juan approves.** CLI, root validation, fold reader,
four Claude definitions, ChatGPT steps and live-script wrapper. Props cover append/fold,
start without finish and preview refusal. Run check, boundaries and relevant props.
Tonight's approved run plan depends only on merged, verified **A**, not the dashboard.

**B — Backfill dry run.** Evidence report for Claude; append only reviewed recoverable
executions. No workflow rerun to reconstruct history.

**C — Workflows page.** Read-only ledger view, measures and states above; demo browser QA.

**D — DB projection and Agents cutover.** Preserve UUIDs and acceptance/audit; both pages
read the same repository. Verify Claude, ChatGPT and app records each count once.

**E — App launching.** Later, separately approved; same writer and existing envelopes/guards.

Defer until a real failure demonstrates need: heartbeats, item claims, per-run attempt
folders, check receipts, observations/annotations files, outbox, lock-owner forensics and
partial-line repair. Do not make these prerequisites for A.

Tonight's scope, gates and budget remain in the private plan, awaiting Juan.
