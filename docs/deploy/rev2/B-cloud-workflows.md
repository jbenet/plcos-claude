# B — Moving the workflows to the service (rev 2)

Planning section, 28 Sep 2026. Nothing here is built. Counts only, no real records. Rev 2 assumes
the deployed service is the system of record, has its own read-only connectors, and runs agents
server-side (Juan: "move some of the workflows there (data, enrichment, strategy, etc)"). Rev 1's
04 kept all of this on the Mac. This section replaces it where they conflict.

Sources for the numbers: the workflow ledger (`plcos-data/real/workflows/runs.jsonl`, 578 runs,
aggregated by workflow, never by record), `lib/import-jobs`, `lib/workflows`,
`docs/deploy/06-measurements.md` (invented fixtures), docs/15, 20, 22 and 24, and the fact-review
files (grades tallied, contents unread). Ledger token counts are **estimates**: 468 of the 578 runs
were prorated from local session logs (`session-window-v1/v2`), and only one was measured.

## 1. Inventory of today's workflows

| Workflow | How often today | How long | Reads | Writes | LLM? |
|---|---|---|---|---|---|
| **Linear sync** | On demand (a click) | Full pull: 44 requests, 3,832 records, 6 MB, 12 s (docs/24) | Linear API, read-only client | `linear` schema | No |
| **Affinity pull + translate** | On demand; each Keychain read asks Juan | Lists: 24 requests for four lists. Notes and relationships: one request per entry; a run over 3,000 entries holds for approval (docs/15). Translate time not measured | Affinity API (key *can* write; client refuses writes), then the local replica | `affinity` schema, ladder **proposals** (reconcile), network rebuild | No |
| **Dakota pull + translate** | Once so far, plus fixes | First pull 312 requests, 5,100 accounts, 9,253 contacts; ledger median 5 min | Dakota API (1-hour token) | `real/dakota/raw` replica (50 MB), `dakota` schema, claims | No |
| **Warehouse (Polaris) graph** | 5 runs on 26 Sep | Median 1.7 min | SELECT-only queries under Juan's gcloud login | `enrich/warehouse/` (369 MB) | No |
| **W1 research** (web search + page reads) | 138 runs, 26–27 Sep | Median 9.8 min a run (p90 18), ~26 LPs a run | Batch rows (name, org, role, location, domains), PL directory, network file, public web | `enrich/raw/<key>.json` (2,787 files, 25 MB) | Yes: GPT-6 via Codex for most; Claude `lp-researcher` |
| **W1+W5 sourcing runs** | 163 runs, 27–28 Sep | Median 13.5 min, ~14 LPs a run | As W1 and W5 | Findings, strategies, prospect files | Yes |
| **W1c fact checks** | 51 runs | Median 7.6 min, ~20 findings a run | Assigned findings and only their cited URLs | `fact-review-NN.jsonl` | Yes, a small model is enough |
| **W3 connect** | 17 runs | Script: 6 s median | Candidates, findings, network, team, PL directory, warehouse graph | `connections.jsonl` | No (deterministic join) |
| **W5 strategy** (+ W5c critic) | 60 runs (+31) | Median 9.3 min (9.7), ~27 LPs a run | Findings, candidates (status, rung, owner), connections, triage, team, presence | `strategy/<key>.json` (1,456), imported as `strategy.suggestion` | Yes, large model |
| **W13 identity review** | 28 runs | Median 9.4 min, ~27 groups a run | `identity-review.jsonl` rows, findings, public pages | `identity-decisions.jsonl` (proposals) | Yes |
| **W14 LP-unit review** | 9 runs | Median 12.2 min, ~39 rows a run | `lp-unit-review.jsonl` rows, findings, public pages | `lp-unit-decisions.jsonl` (proposals) | Yes |
| **W12 tags / W9d drafts** | W9d: 4 runs | W9d median 13.9 min | Affinity emails, meetings and notes (W12); triage + strategies (W9d) | Tags; reply drafts | Yes |
| **Sourcing rounds** | Nightly; imports once per wave, about hourly (operations.md) | A round is several of the runs above | Thesis, prospect lists, Dakota filters | `enrich/prospects/` (35 files) | Yes |
| **Imports** (13 kinds in `lib/import-jobs/types.ts`) | Human click; a child process per job; one active job per kind | On invented fixtures: prospects 7.0 s, duplicate merges 0.3 s, pursuit merges 1.0 s, export 0.5 s, network 20.3 s; 1.2 GiB peak RSS for all five (06). Real-volume times not measured | **Files on the server's disk** (`config.data.root`) | Every schema | No |
| **SPV derivation** | Automatically after each findings import, or a click | Not measured; deterministic | Our SPV pursuits, Dakota flag, research text | SPV stance signals | No |
| **Identity merges** (duplicates, pursuits, lp-units) | Human click | Under 1 s on fixtures; 4 of the last 30 receipts are failed duplicate merges | W13/W14 decision files, rules | Identities, pursuits (audited) | No (applies agent proposals) |
| **Backups** | Manual `npm run backup` | Whole real folder: 2.1 GB archive in 2 min 44 s (27 Sep, docs/22); `pg_dump` 624 MB | Local Postgres as `plcos_ro` | Encrypted archive on the Mac only | No |

**Tokens, from the ledger (estimated).** 26 Sep: 276M input, 1.1M output. 27 Sep (UTC day, which holds
the heavy night): **2,484M input, of which 2,410M (97%) were cache reads and 74M fresh; 8.7M output.**
The "100–300M tokens overnight" figure matches fresh input plus output plus some cache, not the cache
reads. The cache reads come from long agent sessions re-reading their own context each turn, and they
drive the API cost below.

Per item (ledger estimate, Codex sessions): W1 about 196K input (5.4K fresh), 0.7K output per LP;
W1+W5 about 588K (18.6K fresh), 2.0K output; W5 64K (2.5K fresh); W1c 132K (4.8K fresh) per finding;
W13 and W14 about 90–100K per row.

## 2. Where each one runs

| Workflow | Service worker, automatic | Service, human-triggered | Developer (Mac) |
|---|---|---|---|
| Linear sync | **Every 15 min** incremental (GUESS; a full pull is 2% of the hourly budget) | Purge and re-map (admin) | — |
| Affinity pull + translate + reconcile proposals | **Hourly** list and incremental reads; notes and meetings from the cursor every 4 h (GUESS; capped at the existing 25%-of-monthly-quota guard) | Restart full history (admin); any run over the 3,000-entry ceiling | — |
| Warehouse graph | **Daily** read; graph rebuilt when the hash changes | On demand | — |
| Dakota pull + translate | **Daily** changed-since pull, *only if* Dakota's terms allow PL hosting (decision 3) | Full re-pull (admin) | Until then: stays on the Mac, as rev 1 |
| W3 connect, network rebuild, SPV derivation | **After** each sync or findings import (deterministic, chained jobs) | Rebuild (admin) | — |
| W1c fact checks | **Automatically** on every research batch, as a sample (§7) | Full re-check of a batch | — |
| W1 research | Phase 2: automatically for newly added prospects, within a daily cap | Phase 1: "Research these LPs" on a selection or list, with a budget shown before it starts | Protocol changes, tried on copies |
| Sourcing rounds (W1+W5 on a thesis) | — | Yes: a human picks the thesis, tactic and cap | Tactic experiments on copies |
| W5 strategy (+ W5c critic) | Re-run only when an LP's inputs change and the LP has no human edit newer than its strategy (phase 2) | Yes: per LP, per vehicle, or per list | Protocol changes |
| W13 / W14 reviews | Agent proposals run automatically when an export finds ambiguous groups | **Applying** them (Merge duplicate identities, Re-point pursuits) stays a human click | — |
| W12 tags | Automatically on new Affinity records (labels only; a person's tag always wins) | Re-tag | — |
| W9d reply drafts | — | Yes (drafts only; nothing is sent) | — |
| Imports: findings, strategy suggestions | Automatically **only if** Juan approves a standing acceptance policy (decision 4); otherwise a click | Yes | Emergency bundle upload (§8) |
| Imports: prospects, duplicates, pursuits, lp-units | — | Yes: they change the pipeline or identities | — |
| Backups | **Nightly** encrypted `pg_dump` to PL object storage, plus whatever PL runs | Event backup before a bulk operation | Optional pull of a copy for development |

The rule behind the split: **anything that only reads sources or derives labels runs unattended. Anything
that changes the pipeline, identities, consent, or money stays a human click.** Agent output is always a
proposal until something other than the agent accepts it.

## 3. How agents run server-side

**Accounts and terms.**
- Anthropic: a dedicated workspace under an organisation with zero data retention (ZDR). The Anthropic
  API does not train on API data under the commercial terms. ZDR is a separate arrangement: Opus 5 is
  available under it. The Fable 5.x models are not available under ZDR unless Anthropic expressly authorises
  it, so they are off the list. Confirm Sonnet 5 and Opus 5.5 at signup.
- OpenAI: the API does not train on API data by default, and ZDR is granted on request. We have not
  verified GPT-6 API prices or ZDR eligibility (GUESS until checked).
- The key goes into LabOS secrets (`ANTHROPIC_API_KEY`, and `OPENAI_API_KEY` if used). A spend limit is set
  in the provider console as well as in our code.

**The harness.** We write a small agent runner in `lib/agents/`: the Anthropic TypeScript SDK's tool
runner, behind a provider adapter so an OpenAI Responses-API run fits the same interface. It is not the
Claude Agent SDK or Codex CLI: those bring a shell and a filesystem, which we don't want in production.

**Tools and sandboxing.** The agent gets no shell, no filesystem, and no database credentials. Its tools:
- `web_search` and `web_fetch` as provider server tools, with `max_uses` per run and `blocked_domains`
  covering sign-in pages, contact brokers, and social sites that need a login. The pages are fetched from
  the provider's side, so **our container needs no general internet egress**, only the API hosts and the
  connectors. Web search costs $10 per 1,000 searches on Anthropic. Web fetch is billed only as input
  tokens.
- `read_item(key)`: returns one assigned batch row. The worker refuses a key outside the envelope.
- `write_output(key, json)`: validated against `lib/enrich/schema.ts` (or the strategy and decision
  schemas) before it is stored as a **staged proposal row**, never in a live table.

Prompts never carry what a search must not carry. W1's batch rows already hold only research-safe fields,
so the model cannot leak a status or amount it never saw. W5 and W9d read internal records (status, owner,
touches), so they run only after ZDR is in place.

**The work envelope** (AGENTS.md) becomes a row: `{task, scope: batch id and keys, allowed_evidence,
allowed_commands: tool list, budget: tokens, dollars, searches and wall time, deadline, output_schema:
schema hash, acceptance_criteria: validators and fact-check gate, escalation_owner}`. The worker's tool
dispatcher checks every call against it. A fact-check child run gets an envelope computed by code:
the parent's keys and only their cited URLs. Delegation cannot widen it.

**Budgets.**
- Per run: the provider's `task_budget` where it is supported, plus a hard stop in our loop at the run's
  dollar cap, computed from the `usage` in each response.
- Per day and per month: caps in config (§5). Over the cap, new runs are refused; they are not queued
  silently.
- A kill switch pauses every automatic run. The AGENTS.md circuit breaker (`correctionBudgetHoursPerWeek`)
  freezes automatic runs when the correction hours logged against auto-accepted output exceed it.

**The ledger moves into Postgres.** `workflow.run_event` is append-only and holds the same `RunLine` shape
`lib/workflows/ledger.ts` validates, with `source: 'app'`. Usage is **measured** from the API responses,
so no more session-window estimates. The 578 existing lines are imported once. Each run pins its protocol
hash, input-manifest hash, model and resolved config, so editing a prompt later does not change what a
past run meant. The app role gets INSERT only on this table.

**Human acceptance.** Agent success (the ledger outcome), validator pass, fact-check pass and acceptance
are separate states. Acceptance is a human action, or a standing policy Juan approved (decision 4), keyed
by `run id + output hash` so a double click is a no-op. No agent calls an accept or import action, and
the tool set has no such tool.

## 4. The job runner

**What the kit gives.** Nothing for background work. The kit's `AGENTS.md` "Resource limits" says 384 MiB
and 300m CPU per container, and "Don't spawn extra worker threads/processes for background work". It has
no scheduler, worker or persistent disk (rev 1, 01 and 04). Our imports peaked at 1.2 GiB on fixtures.

| Option | Cost | Risk | Fit |
|---|---|---|---|
| **(a) Postgres queue in our own worker**: extend `platform.import_job` to a general job table (`runner`, `scheduled_for`, `attempts`, `based_on`, `input_manifest`, `envelope`), claim with `FOR UPDATE SKIP LOCKED`, keep the per-kind advisory lock and heartbeats, add a `platform.schedule` table read by a tick | M to build; no new vendor | We own retries and scheduling. Needs a second container, or a platform cron hitting a tick endpoint | **Best.** Most of it exists: idempotent create, one active job per kind, heartbeat, stale-job fail without replay. Data never leaves our database |
| **(b) Trigger.dev or Inngest Cloud** | A vendor bill; S–M to integrate | Step inputs and outputs, meaning real LP data, are stored in the vendor's cloud, a new "our system" question. Self-hosting Trigger.dev adds Redis and more services. AGENTS.md defers both to the D-series | Good for long agent loops, but not now |
| **(c) The platform's scheduled jobs** | Free if PL offers them | The kit has none today | Use only as the **clock**: a Kubernetes CronJob calling `POST /api/jobs/tick` with a secret, if PL won't give us an always-on worker |

**Recommendation: (a).** One image, two roles: `web` (Next.js) and `worker` (`scripts/worker.ts`, looping
on the queue). The worker runs agent loops and heavy imports, so the web container stays small. The ask to
PL: a second always-on container of the same image, 2–4 GiB and 1–2 CPU (GUESS from the 1.2 GiB fixture
peak plus agent concurrency of about 8 runs), with egress to the provider APIs, Affinity, Linear, Dakota
and BigQuery only. Fallback: (c) as the tick and short jobs in the web container, if PL allows about
1.5 GiB there. If retries and cron grow complicated, graphile-worker (a library, still Postgres) is the
next step, before any vendor.

## 5. Cost estimates (all GUESS unless marked)

Anthropic list prices (per million tokens: fresh input / cache read / output): Sonnet 5 $2 / $0.20 / $10;
Opus 5.5 $4 / $0.20 / $20; Opus 5 $5 / $0.50 / $25; Haiku 4.5 $1 / $0.10 / $5. Cache writes cost 1.25×
input, and the fresh tokens below are priced as writes. The Batch API halves prices for single calls that
can wait (W5c, W12, re-grading), but not for multi-turn agent loops.

**A heavy night at API rates**, taking 27 Sep's ledger volume as-is (74M fresh, 2,410M cache reads, 8.7M
output):

| Model | Tokens | Web search (GUESS 25K searches) | Night |
|---|---|---|---|
| Sonnet 5 | $185 + $482 + $87 = $754 | $250 | **~$1,000** |
| Opus 5.5 | $370 + $482 + $174 = $1,026 | $250 | **~$1,280** |
| Opus 5 | $462 + $1,205 + $217 = $1,884 | $250 | **~$2,130** |

That night is inflated by long sessions. A server harness that starts **each LP in a fresh, short
context** should cut cache reads 3–5× (GUESS), bringing a comparable night to **~$300–500 on Sonnet 5**.
Today those tokens sit on flat subscriptions; the API is metered, so this is new spend.

**Per item on Sonnet 5**: the ledger profile × 2 for a new harness and tool results, plus searches (GUESS):
W1 about $0.15 per LP (6 searches); W5 $0.05; W1c $0.09 per finding; W13/W14 $0.06; W12 under $0.01 per
record on Haiku.

**Monthly:**

| Scenario | Volume (GUESS) | Sonnet 5 | Opus 5.5 |
|---|---|---|---|
| **Steady state** | 2,500 W1 (1,500 new, 1,000 refreshed), 2,500 W5, 500 W1c, 300 W13/W14, 3,000 W12 tags | **~$600** | ~$900–1,000 |
| **Burst**, like this week | 10 heavy nights, redesigned harness | ~$3,000–5,000 | ~$4,500–7,000 |
| **Burst, harness not redesigned** | 10 nights at 27 Sep's profile | ~$10,000 | ~$13,000 |

Suggested caps: **$2,000 a month and $300 a day** for automatic runs. A human-triggered round over the
daily cap shows its estimate and needs Juan's or an admin's click. Rate limits: a burst night is about
4M input tokens a minute, mostly cache reads. Check our tier's limits before the first burst.

Connectors, imports, W3, SPV derivation and backups use no tokens. Their cost is container time and
database storage. Adding the files that move into Postgres (§8: findings, strategies and decisions,
about 50 MB; batches are regenerated) to today's 1.6 GB cluster, ask for **20 GB** of database storage
(headroom GUESS).

## 6. Conflicts with human edits

Users now edit the same database the worker writes. Rev 1's rules stand, made concrete:

1. **A registry of human-owned fields** in code: status, stage, consent rungs, owners, notes, amounts,
   approvals and tickets, restrictions, tags set by a person, and accepted strategy text. An import writing
   one is a failing property test. Imports write **proposals** instead (`strategy.suggestion`, reconcile
   ladder proposals, staged findings), which a person accepts.
2. **`based_on`.** Every job pins the snapshot time of its inputs. Prospects, duplicates, pursuits and
   lp-units skip any record a person edited after that time. Each skip writes a
   `platform.import_conflict` row: job, record, field, the two values' hashes, and a status of open, kept
   or applied. A **Conflicts** queue on Developer → Status shows them to admins. The prospects
   `inProgress` guard is the precedent.
3. **Source-owned tables** (`affinity`, `dakota`, `linear`, research claims) are written only by their own
   sync. Within a source, the newer `as_of` wins, as the Dakota import already enforces. A person's
   override is a separate row over the source and is never overwritten.
4. **Manifests.** Replaying the same input hash is a visible no-op. A worker whose migration ledger differs
   from the database's refuses to start, so a web deploy and a worker deploy can't mix schemas.
5. **Version checks** on stage, amounts and consent in the UI (rev 1, item 9) cover the human-versus-human
   side.

## 7. Quality gates for autonomous runs

- **Validators as job steps.** `enrich-check` (findings and strategies against `lib/enrich/schema.ts` and
  `lib/enrich/strategy.ts`), `prospects-check` (the importer's own parser), the W12 merge `--check`, and the
  connection checks. A failing item is **quarantined** with its reason. It isn't imported, and the rest of
  the batch continues. Output is counts and line numbers, never contents, as today.
- **Fact-check sampling.** Today's baseline, from 13 review files: 559 findings checked, about 20% of
  2,787. Of 5,112 facts: **88.5% supported, 5.9% partly, 0.1% not supported, 5.5% source unavailable**.
  Identity was in doubt for 13% of findings. Proposed gate (GUESS thresholds from that baseline):
  - W1c checks a random 10% of every research batch, minimum 5 findings, preferably on a different model
    from the writer.
  - A batch passes if not-supported ≤ 1%, partly ≤ 10%, and identity doubts ≤ 15%.
  - A failing batch is held for a human, and the protocol is flagged.
  - An identity doubt holds that one finding, whatever the batch rate.
- **Strategies** go through the W5c critic and `checkStrategy` gates, and stay proposals.
- **Prompt or model changes** run against the protected example set before they land (AGENTS.md). The
  agent can't touch its own pass criteria. Real failures found by the gates are added to the set.
- **A weekly human spot check** of 10 random auto-accepted findings. The minutes spent correcting feed
  the circuit breaker.
- **Claims** keep `source, as_of, confidence, last_verified_by`, or they are refused (invariant 9).
  `last_verified_by` names the run and model.

## 8. What stays on the Mac

- **Code development**: Claude and Codex in worktrees, tests, `npm run props`, and the ship script.
- **Experiments on copies**: protocol and prompt changes, new import kinds, tactic trials, and performance
  work. They run against a restored copy of a production dump (rev 1's mirror), never against
  production. A new import kind is rehearsed on a copy, its counts are compared, and then the same code
  ships and runs in the worker.
- **An emergency bundle path**: if the worker is down, a Mac run can upload a hashed bundle to an
  authenticated import endpoint. The bundle goes through the same validators, gates and conflict rules,
  as a named admin. The Mac never connects to the production database as a writer.
- **Dakota**, until decision 3.

**Required change: every import stops reading `config.data.root`.** Batches, findings, strategies,
decision files, prospect files and the strategy-moves menu become rows (jsonb plus hash) in Postgres,
because the service has no persistent disk. This is the largest single build item.

## 9. Confidentiality boundaries this section touches

1. **Real data in agent prompts, sent to API providers.** This changes the real-data rule that a research
   sub-agent "never runs remotely", and only Juan can change it. The mitigations are ZDR, no training, and
   research-safe fields only for W1, W1c, W13 and W14.
2. **Affinity note and email text** in W12 and W9d prompts. The health redaction still applies before the
   text reaches a prompt.
3. **Dakota fields in any prompt**: excluded until Dakota's terms are confirmed.
4. **Logs.** No prompt, response or record text goes to stdout, because PL can read CloudWatch. The ledger
   and job rows hold counts. Full agent transcripts are not stored (decision 7).
5. **Connector keys in LabOS secrets.** The Affinity and Linear keys can write, and our clients refuse
   writes. Polaris needs a service account with SELECT only, instead of Juan's gcloud login. Affinity loses
   Juan's approval on every read.

## 10. Decisions for Juan (suggested answers in italics)

1. **May agents run server-side on API accounts with zero retention and no training, amending "never runs
   remotely"?** *Yes. Start with W1, W1c, W13 and W14, whose inputs are research-safe. W5, W9d and W12 follow
   once ZDR is confirmed in writing.*
2. **Which provider runs server agents?** *Anthropic first: one ZDR agreement, and the tool runner and
   server web tools fit this design. Sonnet 5 for W1, W1c, W13 and W14; an Opus-tier model for W5; Haiku for
   W12. Before committing, run a 50-LP bake-off against GPT-6 on the protected set, since most of today's
   research was done with GPT-6.*
3. **Dakota in the service** (same as rev 1, decision 3)? *Only after Dakota's terms allow PL hosting.
   Until then its sync stays on the Mac and its fields stay out of prompts.*
4. **Standing acceptance for research imports?** *Yes, for findings only: a batch that passes the
   validators and the fact-check gate is imported by the worker under a policy you approve. The policy is
   recorded as a ticket with scope, caps and a 30-day expiry, and the circuit breaker can revoke it.
   Strategies, prospects, merges, re-points and anything touching status, consent or money stay one human
   click each.*
5. **What runs unattended?** *The §2 table: syncs, derivations, W1c sampling, W12 tags and W13/W14
   proposals now. W1 for new prospects and W5 re-runs in phase 2, after two weeks of passing gates.*
6. **Budget caps?** *$2,000 a month and $300 a day for automatic runs; a per-run cap shown before every
   human-triggered round.*
7. **Keep agent transcripts?** *No. Keep outputs, the URLs of tool calls, usage and checks. Turn on
   transcripts for one run at a time when debugging, encrypted, and deleted after 7 days.*
8. **The job runner?** *Our own Postgres queue and a worker container. Trigger.dev and Inngest stay
   deferred.*
9. **Sync cadences?** *Linear every 15 min, Affinity hourly with notes every 4 h, the warehouse daily,
   Dakota daily once allowed. Syncs are read-only, as now.*
10. **Who can pause the worker?** *You and one named backup admin, from Developer → Status.*

## 11. Build order

**Tonight (no decision needed; demo data and invented fixtures only):**

| # | Item | Size |
|---|---|---|
| 1 | Generalise `platform.import_job` into a job table (`runner`, `scheduled_for`, `attempts`, `based_on`, `input_manifest`, `envelope`); `scripts/worker.ts` claims with SKIP LOCKED under the existing advisory locks | M |
| 2 | `platform.schedule` and an authenticated tick endpoint; cadences in `config/deployment.ts`, marked GUESS | S |
| 3 | Human-owned field registry, `based_on` skip-and-flag, `platform.import_conflict`, and the property tests | M |
| 4 | Ledger into Postgres (`workflow.run_event`, same validation), a one-time import of `runs.jsonl`, and the workflows view reading from the database | M |
| 5 | `lib/agents/` runner: provider adapter, envelope policy check, budget stop, measured usage and staged outputs. Tested with a **fake provider**; no API calls | L |
| 6 | Validators as job steps, with quarantine | S |
| 7 | The fact-check sampler and gate, thresholds in config (GUESS) | S |
| 8 | Start moving file inputs into Postgres, beginning with findings and strategies | L (starts tonight, continues) |

**After Juan's decisions and PL's answers:**

| # | Item | Size | Needs |
|---|---|---|---|
| 9 | Worker container on LabOS, with egress restricted to the API and connector hosts | M | PL wishlist |
| 10 | Connectors in the service, one at a time: Linear, then Affinity, then the warehouse (service account), then Dakota | M each | Decisions 3 and 9; secrets |
| 11 | Provider account with ZDR and a spend limit; the 50-LP bake-off | M | Decisions 1 and 2 |
| 12 | Human-triggered W1, W5 and sourcing rounds in the UI, with the estimate shown first | M | 5, 11 |
| 13 | Automatic W1c, W12 and W13/W14 proposals; then the standing findings policy | S | Decisions 4 and 5 |
| 14 | Nightly encrypted dumps to PL object storage; an optional copy for the Mac | M | PL storage |
| 15 | Phase 2: automatic W1 for new prospects and W5 re-runs | S | Two weeks of passing gates |

## 12. Feedback for the kit devs, and PL asks from this section

- A worker role or background-job primitive: the kit forbids extra processes at 384 MiB, and apps with
  agents need them.
- A scheduled-job primitive (even a cron that calls an app path with a secret). The logs skill already
  mentions "last night's scheduled job".
- Documented egress rules, and a way to allowlist hosts per app.
- Guidance for LLM keys: a zero-retention, no-training account, spend limits, and never logging prompts,
  because platform logs are readable by PL staff.
- Object storage for encrypted backups, and the database's own backup and restore terms.
