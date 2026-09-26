# Workflows: one record of work across agents and folders

Design for issue 0036, 26 Sep 2026. **Proposed, not implemented.** Claude reviews and Juan
approves before phase 2 or any workflow starts. Tonight's private plan is
`plcos-data/real/enrich/plan-2026-09-26.md`. This document contains no real records; examples
are invented. The rules in AGENTS.md, [the current plan](13-synthesis-r3.md),
[the architecture](09-system-architecture.md) and [COLLAB](COLLAB.md) still apply.

## Why Agents misses the work

`app/agents/page.tsx` reads `modules/agents`: database envelopes, runs, tool calls and
acceptance. `listRuns()` defaults to the latest 20 rows, and the page's run count is that
returned list's length, not an all-time total. W1 research, W1c checks, W5 strategies and
W12 tags instead run in working sessions and write files. Neither those artifacts nor
Claude's or ChatGPT's session histories currently create database runs.

Fix both problems: record every execution through one writer, and query totals separately
from paginated rows. Agents and Workflows must become two views of the **same run IDs and
repository**, including future app launches. A second unrelated workflow counter would
leave the original problem intact.

## The workflows today

Below, `E` means the shared `plcos-data/real/enrich/`, `R` means
`plcos-data/real/`. These are artifact locations, not permission to read the entire root.
The inventory follows [docs/19, The set](19-enrichment-workflows.md#the-set).
There is no W10 in that inventory. W1d is a pages-only W1 method, not another workflow.

Execution codes:

- **F**: ChatGPT from `plcos-codex-dev`, reading/writing explicitly named files under the
  sibling `plcos-data/real`; or Claude's working session from either Claude worktree,
  using that same shared root explicitly. Both can do bounded file work.
- **C(name)**: the existing Claude sub-agent definition in `.claude/agents/`. It currently
  runs in `plcos-claude-live`, even when launched by a session in `plcos-claude-dev`.
- **L**: Claude operates the existing script in `plcos-claude-live`, without code edits.
  Its cwd-relative `data/real` points at the shared root. Only the live server opens the
  real DB; extraction uses the server or the documented DB-copy procedure.

| ID | Inputs | Output files | Protocol in force | Executors / folder |
|---|---|---|---|---|
| W0 Research set | Pipeline, team | E `research-set.jsonl` (identity only), `candidates.jsonl` (confidential), `team.json` | docs/19 W0; no separate version | L, live export; no agent opens the real DB |
| W1 Profile LP | Identity batch, public web, own-side reference files | E `raw/<key>.json`; batches in `batches/*.jsonl` | `workflows/w1-profile.md`, **"1.49"** | F or C(lp-researcher); batch cutting L |
| W2 Profile us | Team, public web | E `us/<handle>.json`, `us/network.json` | docs/19 W2; unversioned | F; no dedicated sub-agent |
| W3 Connections | Findings, own-side files, exported contacts and pursuits | E `connections.jsonl` | docs/19 W3 + `lib/enrich/connect.ts`; unversioned | L `enrich-connect.ts`; deterministic |
| W4 Fit/angle | Findings, vehicle theses, gates | Part of E `strategy/<key>.json` | W5 **"1.10"** when produced with W5 | F or C(strategy-writer), as W5's step |
| W5 Strategy/actions | W3, W4, candidates, notes/context, triage, own-side files | E `strategy/<key>.json`; key batches `batches/*.txt` | `workflows/w5-strategy.md`, **"1.10"** | F or C(strategy-writer); batch cutting L |
| W6 Public presence | Public pages | E `presence/*.json` | docs/19 W6; docs/05 rubric; unversioned | F |
| W7 Materials | W6, approved material files | E `presence/materials.json` | docs/19 W7; docs/01 §4 rubric; unversioned | F |
| W8 Synthesis | Findings, strategies, triage, paths, reviews | E `synthesis.md` | docs/19 W8 + synthesis script; unversioned | L `enrich-synthesis.ts` |
| W9 Cold triage | Exported pipeline, findings, W3 | E `triage.jsonl` | docs/19 W9 + triage rules; unversioned | L `enrich-triage.ts` |
| W1s Structure | Existing facts, their own words | E `raw/<key>.json`, detail fields only | docs/19 W1s; W1 fact rules **"1.49"**; no separate version | F; a separately recorded attempt if run separately |
| W11 Connector plan | W3, W9, W5, restrictions | E `connectors.json` | docs/19 W11 + connector rules; unversioned | L `enrich-connectors.ts` |
| W5c Critic | Strategies and their exact W1/W3/W9 inputs | E `strategy-review*.jsonl` | docs/19 litmus + W5 **"1.10"** target; critic itself unversioned | F, separate critic context; no dedicated definition |
| W1c Fact check / correction | Findings, only their cited URLs; no search | E `fact-review-*.jsonl`; corrections in `raw/<key>.json` with `researched.corrected` | `workflows/w1c-fact-check.md`; unversioned, references W1 **"1.49"** | F or C(fact-checker); record review and correction as distinct attempts |
| W2n PL directory | Identity set, public directory API | E `us/pl-network.json`, `us/pl-directory.jsonl` | docs/19 W2n + directory script; unversioned | L `enrich-pl-directory.ts` under public-web rules |
| W12 Event tags | Fixed `tags/batches/tNN.json` from DB copy, vehicle definitions | R `tags/out/tNN.json`; merge to `event-tags.jsonc` | `workflows/w12-events.md`, **"1.1"** | F or C(event-tagger); extraction/check/merge L |

An unversioned protocol records `version: null`, its source files, git revision and content
hashes. Do not invent historical version numbers. Version strings are not floats:
`"1.10"` and `"1.1"` differ. Record both the protocol the worker received and the version
claimed by its output; a mismatch fails validation. A correction does not rewrite the
finding's original research date or imply that all its facts were re-researched.

The current Claude definitions request Sonnet for research and tagging, Opus for strategy,
and Haiku for fact checking. These are defaults, not evidence of the model a past run
actually used; working notes also describe a Sonnet fact-check pass. Record the resolved
model when available, otherwise unknown. ChatGPT is the default executor for new bounded
file work; use Claude for existing live scripts and when a specifically approved sub-agent
is needed. No model switch silently changes the budget or quality gate.

COLLAB deliberately has no application-wide `DATA_ROOT` override. Keep that decision.
The proposed workflow writer resolves the shared sibling using the known checkout layout,
verifies its canonical path and profile, and refuses a preview copy. It has a narrow root
resolver of its own, not a way to redirect the app's database. Existing scripts still run
in the live folder until individually adapted. A Claude launch from the dev folder must
record both its launch folder and its worker's actual cwd.

## The shared ledger

Use **`plcos-data/real/workflows/runs.jsonl`**, append-only UTF-8 JSONL, exactly one terminal
summary per execution attempt. All Claude folders (including a known historical folder),
ChatGPT and the app use this file, never a ledger under their own checkout. The writer is
a small local file adapter behind `modules/agents`' public interface, with a CLI wrapper
for external sessions; it is not another service or workflow engine.

Supporting files under `workflows/`:

- `attempts/<runId>/start.json`: immutable envelope, approval reference, source, input
  manifest, protocol/config/prompt hashes and start time, written before work starts.
- The same directory holds an atomically replaced heartbeat, immutable check receipts,
  output manifest and `finish.json`, the durable terminal receipt awaiting ledger append.
  Inputs and outputs are referenced by relative path and hash; freeze the approved inputs
  in a private snapshot when another process could otherwise change them.
- `observations.jsonl`: artifact observations that cannot be attributed to an execution.
  These never count as runs. `annotations.jsonl`: append-only, attributed corrections or
  late telemetry keyed by run ID. They do not create executions or overwrite old lines.

The start manifest supports live progress without writing several ledger lines for a run.
It is the pending state of that same run ID, not a second run inventory. Parent orchestration
attempts and child batches have separate IDs and `kind`; default execution totals count
leaf work only, with orchestration shown separately. W4 inside W5 is a step, not a second
execution. A retry is a new attempt with `retryOf`, retaining failed attempts.

### Record contract

Required fields (nullable means explicitly unknown, never zero by default):

| Field | Meaning |
|---|---|
| `schemaVersion`, `runId`, `kind`, `parentRunId`, `retryOf` | Schema and stable UUID identity; execution or orchestration |
| `workflow`, `operation`, `protocol` | Workflow ID (null for a non-workflow app task), review/correct/generate/etc.; version string or null plus source hashes |
| `source`, `agent`, `model` | `claude-code`, `chatgpt`, `app`, `script`, or recovered origin; actual agent/model and optional session correlation ID |
| `launchFolder`, `workerFolder`, `codeRevision`, `profile` | Where it started and ran; code identity; real or demo |
| `envelopeId`, `envelopeRef`, `appRunId`, `approvalRef` | Shared UUID, immutable envelope file, optional linked DB ID and human authorization |
| `batch` | Batch ID, immutable selection manifest/hash, input corpus revision, planned item count |
| `startedAt`, `endedAt`, `recordedAt` | UTC ISO timestamps; recovered times may be null; recording time is not execution time |
| `inputs`, `outputs` | Manifest paths/hashes; item unit, distinct selected/attempted/written/valid/failed/skipped counts; skipped reasons |
| `checks` | Named checks with pass/fail/not-run, version, scope, time and private receipt reference |
| `usage`, `cost` | Input/output/cache-read/cache-write tokens and provider semantics; currency/amount/source when known; null otherwise |
| `outcome`, `reason`, `provenance` | succeeded/partial/failed/refused/cancelled/unavailable/unknown; bounded reason; native or recovered, evidence refs and missing fields |

Invented compact terminal line, abbreviated for readability (production requires all fields):

```json
{"schemaVersion":1,"runId":"00000000-0000-4000-8000-000000000026","kind":"execution","workflow":"W1c","operation":"review","protocol":{"version":null,"sources":["docs/workflows/w1c-fact-check.md"],"hash":"<sha256>"},"source":"chatgpt","agent":"ChatGPT","model":null,"launchFolder":"plcos-codex-dev","workerFolder":"plcos-codex-dev","batch":{"id":"example-04","planned":6},"startedAt":"2026-09-26T01:00:00Z","endedAt":"2026-09-26T01:20:00Z","inputs":{"unit":"finding","selected":6},"outputs":{"written":6,"valid":5,"failed":1},"checks":[{"name":"coverage","status":"fail"}],"usage":null,"cost":null,"outcome":"partial"}
```

Full manifests retain item IDs privately, so totals can deduplicate overlapping batches and
prove coverage. `succeeded` means the run fulfilled its envelope and checks. A fact review
can succeed while identifying unsupported claims. Output acceptance, import, investor
approval, legal close and cash receipt remain different states with different authority.

### How every executor records a run

1. A proposed CLI (`workflow-run begin/finish/recover`; not built yet) calls the same
   module API as the app. `begin` validates the approved envelope, canonical root, deadline,
   budgets and exclusive item ownership; it durably writes `start.json` and returns a run
   ID. If it cannot record the start, work does not start.
2. **Claude sub-agents:** the launching session calls `begin` and passes only the run ID
   and private manifest path, never records in the prompt. Each of `lp-researcher`,
   `fact-checker`, `strategy-writer`, `event-tagger` gains a mandatory final step submitting
   outputs/check receipts to `finish`. The launcher also calls the idempotent finalizer on
   exit/failure. The same protocol applies to agents launched from either Claude folder.
   The wrapper, not an agent's self-reported success or a transcript hook, owns validation.
3. **Claude working sessions and ChatGPT:** call `begin` before the bounded batch and
   `finish` afterward with the same manifest contract. Shell scripts use a wrapper that
   captures exit status and always attempts finalization. Interactive session termination
   is not assumed to run a shell trap; unfinished starts are recovered explicitly.
4. **Future app launches:** `runInEnvelope` allocates the same run ID, calls the same
   start/finalize API and records `source: app`. The initial page is read-only; a launch
   button requires a separate approval/envelope design and cannot bypass existing guards.
5. A session-end hook may alert about unfinished attempts, but is optional. No transcript
   scraping or hook is required for run correctness. Work outside the wrapper is reported
   as untracked artifact change, never quietly counted as a successful run.

The common writer serializes **all** appenders with an exclusive local lock. Under the
lock it validates the terminal receipt, checks the run ID against committed records, appends
one newline-terminated line, fsyncs, then acknowledges. Repeating an identical finish is a
no-op; different content for an existing ID is a conflict requiring review. Writers stage
receipts with exclusive creation / atomic rename; no last-writer-wins overwrite of outputs.
Claims on intersecting item sets prevent two agents editing the same findings simultaneously.
Global W3/W9 regeneration runs at a barrier after workers finish, never mid-batch.

Recording is not permission enforcement by itself. A launch needs a current approved
envelope and circuit-breaker decision; unavailable or stale authorization blocks launch.
The executor still restricts tools and file scope, and children share the parent's total
remaining budget, rather than each receiving the full allowance. Historical receipts
without tool-call evidence must not display “all calls policy-checked.”

A killed writer may leave a partial line. Readers expose only complete validated lines and
flag the unreadable tail; they do not silently skip corrupt history. Recovery preserves the
tail separately, repairs only the incomplete append under the exclusive lock, then replays
the durable receipt idempotently. Complete lines never change. A lock records host, PID,
process start identity and owner; time alone does not authorize stealing it. A confirmed
dead writer can be recovered with an audited action. A missing heartbeat means **execution
unknown**, not success, failure or permission to rerun. Reconcile outputs before releasing
its item claims. No distributed lock guarantee is claimed: this design is for this one
machine and local filesystem, not simultaneous writers on a network-mounted volume.

### Meeting the app's run model

Extend `modules/agents`, through its public index, with the canonical run record and file
adapter. Keep envelopes, tool checks, acceptance, evaluations and correction-budget rules;
do not force file workflows into today's `proposed | accepted | rejected` execution status.
Execution outcome and human disposition become explicit, separate fields in the read model.

The ledger plus its pending start manifests is authoritative for execution identity,
timing, output references and counts. `agents.run` becomes the app's projection of these
runs, retaining its existing IDs and relationships. Envelopes for external runs are pinned
as files before launch; the live server idempotently projects their UUIDs into the DB and
links each run. External workers never open the live database. Unrecognized actors remain
external actors; they are not silently assigned a human identity or acceptance rights.
Historical runs without an envelope remain explicitly legacy, with no fabricated approval.

The DB still owns acceptance, audit and tool-call records. Accepting an output later does
not edit its execution line; the shared query joins disposition by run ID. App `proposed`
maps to completed proposal generation, not accepted work; refused/unavailable retain those
outcomes, and ambiguous historical rows remain unknown. Acceptance cannot be inferred from
successful workflow checks or an import.

Use a durable DB outbox for app completion and idempotent file finalization, never assume a
DB transaction and filesystem append are atomic. Begin persists the file start before an
agent is invoked. Completion commits DB state plus an outbox receipt; a live-process worker
flushes that receipt through the common ledger writer and records delivery. If the DB or
file write fails, show recording pending/failed and reconcile by the same UUID, without
launching again. Acceptance requires a reconciled, validated run. On external completion,
the ledger can lead its DB projection; both pages still see the canonical execution via
the common repository, with disposition pending. No counter independently sums both stores.

Cutover order: backfill existing DB runs under their original UUIDs; establish projection
and outbox replay; switch **both** pages to the shared repository in one reviewed slice.
Remove the old independent counting path. A local receipt cursor/index may accelerate
queries but must be rebuildable from the ledger. Both pages use identical profile, UTC
date window and source filters for comparable totals; the first 20 displayed rows never
limit aggregates. General app tasks appear under “App tasks” with `workflow: null`.

## Backfill without inventing history

Read file evidence first: research/strategy metadata, batch inputs and outputs, reviews,
tag batches/results, private LOG and the public workflow log. Produce a private dry-run
report for Claude to review before appending. Preserve source hashes and the backfill time.

- A batch file alone proves a planned selection, not a run. A final finding proves an
  artifact, not each execution that ever changed it. Mtime is not execution time.
- Create a recovered run only when evidence identifies a bounded execution (for example a
  named batch and matching output metadata). Use a deterministic evidence-based ID for
  rerunnable imports. Keep unknown start/end/model/tokens/envelope null. Distinguish a
  research version from a later correction; never claim a current file was the input of an
  old review merely because its key matches.
- Base recovered identity on stable execution evidence, not the hash of a mutable final
  artifact. A later file edit updates the evidence assessment; it does not prove a new
  execution. A recovery map preserves aliases between overlapping log/batch references,
  and unresolved possible duplicates stay observations until reviewed.
- If grouping or time cannot be supported, add an artifact observation instead. It can
  establish present coverage but not “runs yesterday.” Report historical run totals as
  **at least N recorded executions**, with unknown-date and unassigned artifacts separate.
- Reconcile log statements with files rather than adding their counts. Reviews from
  different rounds overlap; pilots and production are separate populations. Compare W12
  record refs with batch refs, not just the number of result files.
- Optional usage import reads Claude's old and current project-folder session metadata and
  `~/.codex/sessions/` locally. Match explicit IDs first; ambiguous time-window matches stay
  unattributed. Never ingest transcript bodies into the ledger or serve transcript paths.
  Late verified usage becomes an annotation, not a rewritten line or another run.

Current artifacts can establish coverage even when run history cannot. Neither the older
LOG's last entry nor today's inventory alone can answer exactly how many runs happened
yesterday. Report that limitation rather than deriving a false total from final files.

## Developer → Workflows

Add a Developer rail link to `/dev/workflows`, beside Agents, Changelog and Docs. Retain
the shell, breadcrumb and visible last-sync time. Initial view is read-only. Header says
profile, corpus/snapshot date, last ledger read and recording/projection health. Real data
stays on the real profile; demo uses invented fixtures only. Preview reads a consistent
copy of ledger/manifests/artifacts, labels its capture time, and never falls through to
the shared real root. Do not copy live lock/heartbeat authority into a preview.

The top shows a research-loop diagram **and equivalent keyboard-navigable list**:

`W0 → W1/W2/W2n → W1c review/correction → W3 → W9 → W4/W5 → W5c → W11/W8`.
W1s feeds W1; W6/W7 feed strategy and synthesis. W12 feeds translation/reconciliation,
then the next W0 export. Those latter operations remain human-controlled; a tag never
approves a ladder rung. An arrow means dependency readiness, not an automatic trigger.

Each node states its eligible corpus, covered items, invalid/missing/changed inputs,
unchecked outputs, and what or whom it is waiting on. Example: “6 findings need a source
correction; strategies wait for recheck.” A deliberate human hold is not a failed run.
No blended AUM or unsupported relationship claim belongs in these operational statistics.

The workflow table shows protocol version/hash, last attempt, execution count for the
selected window, item coverage, current pending reasons, quality and measured cost. Selecting
a workflow opens its run list and inspector: source/agent/model/folders, envelope and approval,
input/output hashes, checks, failure reason, retries, usage coverage and downstream blockers.
Links reach Agents by the same run ID for tool calls and human disposition. Run pagination
and aggregates share filters but have independent queries. Show Sep 25 and Sep 26 as UTC
calendar windows, with unknown-date recovered runs in a separate bucket.

### What the numbers mean

- **Runs:** distinct terminal leaf attempts; succeeded, partial, failed, refused, cancelled,
  unavailable and unknown shown separately. Active/unknown starts are separate. Historical
  observations and orchestration attempts do not inflate this count.
- **Done/pending:** distinct eligible items for the selected input snapshot, not the sum of
  batch output counts. “File exists,” “checks passed,” “reviewed,” “accepted” and “imported”
  are separate coverage columns. Out-of-scope/skipped items keep reasons. Changed dependency
  hashes make an output stale; an older protocol alone means “older version, impact review
  due,” not automatic invalidity. Missing historical hashes mean currency is unverified.
- **Fact quality:** within one round and pinned input version, supported / all readable
  facts. Example: 80 supported, 10 partly, 5 unsupported, 5 unavailable gives 80/95 (84%)
  supported among readable and 95/100 coverage. Show all five grades, including someone
  else, and identity holds/doubt/wrong separately. Never call the agent's grade human
  verification. Missing fact indexes fail coverage; historical reviews without input hashes
  cannot prove quality of today's corrected text.
- **Strategy quality:** A/B/C distribution with rubric version, sample selection and n;
  report sampled and full-corpus coverage separately. A critic's older A is not a current
  acceptance. W12 reports unique refs covered, schema/check failures and human overrides,
  not an invented accuracy percentage without adjudicated examples.
- **Cost:** known tokens by category and provider semantics, with “usage known for N/M
  runs.” API cost needs an observed bill or a dated, recorded pricing basis. Subscription
  tokens are not dollars spent. Unknown is displayed as unknown, never free or zero.

### States and safe next steps

Every state names what is known, who can act and the next safe action. Colour supplements
text and icons; the inspector and list carry the same information.

| State | Known / actor / next action |
|---|---|
| Empty | No recorded executions in this scope; operator can inspect coverage/backfill or select a wider window; not “nothing ever ran” |
| Loading | Receipt read in progress; wait; retain last snapshot labelled with its time |
| Failed sync | Last successful read/projection time and error; Claude retries/reconciles receipts; do not replace prior counts with zero |
| Expired permission | Envelope deadline/authorization expired; Juan renews a bounded envelope before resuming |
| Stale evidence | Named input hash changed; operator freezes new inputs and selects affected work; do not silently repin outputs |
| Conflicting edits | Item claim or finish receipt conflicts; Claude compares both versions and resolves ownership; no overwrite or duplicate launch |
| Unavailable owner | A decision has no available owner; Juan assigns one; keep the item waiting |
| Paused | Explicit pause or circuit breaker with reason; authorized owner reviews before resuming |
| Exhausted budget | Used/remaining allowance and unmet work; Juan approves a new bounded attempt or leaves it pending |
| Rejected claim | Review identifies unsupported/wrong-subject material; worker corrects within scope, human handles identity decisions, then recheck |
| Revoked authorization | Approval withdrawn; stop new calls and preserve receipts; Juan decides any later scope |
| Ambiguous external execution | Start exists but worker/receipt unknown; Claude reconciles outputs before releasing claims or retrying |
| Source unavailable | Cited page unavailable, with reason and attempted time; mark unavailable and wait, no bypass or unsupported verdict |
| Partial/failed output | Named missing items/checks; worker retries only the approved failed subset with a new attempt ID |
| Untracked artifacts / recording failure | Files changed without a validated receipt; Claude reviews/backfills; success counts remain unconfirmed |
| Old protocol / unreviewed output | Version or quality gap stated; reviewer assesses impact; older files are not automatically discarded |

File access is server-only and fixed to the profile's ledger and validated manifest IDs.
No arbitrary filesystem path/query parameter, transcript reader, directory browser or raw
private-file URL. Reject traversal, encoded traversal and symlinks escaping the allowed
root. Existing lack of sign-in means the real page is readable on the local network; it
must not acquire new launching, import or approval authority merely by showing these files.

## Phase 2: independently reviewable slices

1. **Contract and file writer.** Schema, explicit root/profile resolver, immutable starts,
   serialized finalization, item claims, recovery and CLI. Test two worktrees finalizing
   concurrently, repeated finish, conflicting finish, interrupted append, dead/alive lock,
   missing heartbeat, root escape and demo/preview isolation. No workflow runs yet.
2. **Executor coverage.** Wire all four Claude definitions, Claude session/script launches
   and ChatGPT instructions to begin/finish. Demonstrate with invented fixtures from both
   dev folders and live-layout fixtures, including a killed worker. No transcript dependency.
3. **Historical recovery.** Dry-run artifact/DB-run backfill, evidence report, deterministic
   IDs and duplicate detection. Claude reviews before importing. Show recoverable counts
   and irreducible gaps; replay changes no count. No web or workflow execution.
4. **One app repository.** Append-only schema migration for projection links/outbox as
   needed; preserve old UUIDs, envelopes, tool calls and acceptance. Wire `runInEnvelope`,
   reconcile DB/file failures, and switch both page data sources together (Workflows may
   initially be a minimal read-only list). Prove one Claude attempt, one ChatGPT attempt and
   one app attempt appear once each in both views; acceptance does not increase run totals.
5. **Page and loop measures.** Full workflow index, inspector, coverage/dependency queries,
   quality denominators and every state above. Demo browser QA and count invariants across
   pagination/time windows; no real screenshots. Add this doc to the fixed Docs allowlist.
6. **Optional telemetry, then app launching separately.** Usage metadata adapters first.
   App launching later requires Juan-approved envelopes, server-side guards, budget and
   cancellation/recovery; no claim of durable orchestration before it exists.

Each slice runs check, boundaries and relevant props. The first live workflow run needs
Juan's plan approval **and** the merged, verified recording path from slices 1–2; the
dashboard and full backfill need not delay it. If that prerequisite cannot land tonight,
leave the plan queued rather than start work that again goes unrecorded.

## Decisions for Juan

1. Approve the file ledger as execution authority, with the DB as its projection and owner
   of human acceptance/tool audit, so both pages read one run set?
2. Approve the private plan's bounded correction → recheck → strategy → critic pass and
   its estimated token cap, conditional on the recording path being available?
3. Who handles the private plan's identity/unsupported-capacity holds? Until assigned,
   those items stay waiting; no agent changes identity or invents capacity to clear a gate.

No workflow was launched in preparing this design. No changes to runtime permissions,
protocols, product code, exports or real database are part of phase 1.
