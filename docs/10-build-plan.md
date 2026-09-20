# Capital OS — Phased Build Plan

**Sixteen shippable versions, v0 → v15. Provisioning, connectors, and the dev feedback engine at v2 so every version after it gets cheaper.**

*Prepared 19 September 2026. Sizes assume 1–2 engineers and are engineer-days, not calendar days. Integration facts carry forward from the architecture spec; the ones that gate a version are flagged inline.*

---

## The shape of it

Thirteen weeks to the 19 December first close. The plan front-loads everything that moves that number and defers everything that doesn't, with one deliberate exception: **the feedback engine ships at v2, before most of the product**, because from that point the team drives the build by using it rather than by meeting about it.

```
weeks 1–2   v0  v1  v2        provisioning · ask log · feedback engine
weeks 3–5   v3  v4  v5        entities · vehicles+coverage · close room
weeks 6–8   v6  v7  v8        EDGAR signals · scoring · Affinity
weeks 9–11  v9  v10 v11       graph+routes · agents · meetings
weeks 12–13 v12               materials
── December close ──
Q1 2027     v13 v14 v15       compliance · grants · learning loop
```

### Ground rules

**"Shippable" means someone on the team does something new with it that day.** Not "the code is merged." If a version doesn't change anyone's behaviour, it isn't a version — it's a refactor, and it goes inside another version.

**Every version ends with a deploy to production and a message in the team channel.** No long-lived branches. No staging-only releases.

**One acceptance test per version, written before the work starts.** It's in the version block below. If you can't pass it, you haven't shipped.

**Cut policy: descope within a version, never skip a version.** The ordering encodes dependencies; the contents don't. If v7 is running long, ship the scoring with three components instead of four, not v8 first.

**The build budget is roughly one engineer, half-time, plus agent assistance after v2.** If it needs more than that, the plan is wrong, not the team.

---

## Day-0 decisions and the parallel track

Four things block or reshape work and none of them are code. Start them in week 1.

| Decision | Blocks | Owner | Notes |
|---|---|---|---|
| **Affinity plan tier** | v8 design | you | Advanced/Enterprise → Data Share (2h refresh, zero API quota, full interaction corpus). Scale → poll-first pattern, 100k req/month ceiling, ~2× the connector work. |
| **Warehouse access** | v8, v15 | PL data | Can this system get its own schema with write permission for canon tables? If not, derivation runs in Postgres and Data Share lands via a loader. |
| **Counsel: integration risk** | nothing technical | you | The single 506(b) SPV among four 506(c) vehicles. Two-hour conversation. Do it before outreach scales, not before v0. |
| **Linear custom fields** | v2 | eng | **Unverified:** no user-defined custom-field mechanism appears in Linear's API docs. Verify against the live GraphQL schema. If absent, model issue metadata with labels + projects. |

Also in week 1, non-blocking: open the access conversations with Sydecar and AngelList (both have login-gated developer portals; AngelList directs you to email `portal@angellist.com`). Nothing in this plan depends on them, and that's deliberate — but the lead time is long.

---

## v0 — Provisioning

**Goal:** a deploy pipeline and an empty app in production, so that every subsequent version is a small diff rather than an event.

**Ships**
- Repo, TypeScript monorepo layout, module directories per the architecture spec
- Managed Postgres (production + a branchable dev instance)
- App container deployed, reachable, behind PL Labos auth
- GitHub Actions: lint, typecheck, test, migrate, deploy on merge to `main`
- **Per-PR preview environments with a branched database** — this is the single highest-leverage provisioning decision in the plan, because it makes v2's agent loop safe and makes review fast
- Secrets in PL's vault, one scope per workload (app / connectors / agents)
- Sentry for errors, structured logs, a `/healthz`
- Migration tool wired into CI, forward-only

**Provisioning detail**
- Compute: containers on PL's existing platform. Two services from the start — `web` and `worker` — even though `worker` does nothing yet, because splitting later is annoying and splitting now is free.
- Postgres: managed, with PITR. Pick a provider that supports **database branching** (Neon-style) if PL's platform allows it; if not, a seeded scratch DB per preview is an acceptable substitute.
- Roles: `app_rw`, `connector_rw`, `agent_ro` created at v0 even though only the first is used. The agent role having existed from the start is how the two-plane separation stays honest.

**Acceptance test:** open a PR with a trivial change; a preview URL appears, CI is green, merge deploys to production in under 10 minutes.

**Size:** 3–4 days.

---

## v1 — Ask log and audit

**Goal:** stop the collision that four concurrent raises against one relationship base produces. This is the whole reason the system exists, so it ships first.

**Ships**
- Tables: `identity.entity` (minimal — id, type, display_name, owner), `coordination.ask`, `platform.audit_event`
- One page: the ask log. Add an ask, see all asks, filter by relationship and vehicle.
- **The frequency guard as a synchronous check in the write path.** Before an ask can be marked `made`, a query counts asks against that entity in the current quarter. Over the cap, the write is refused and returns the conflicting ask. Override is allowed but requires `override_reason` and writes an audit row.
- Audit rows written in the same transaction as every state change, always.
- Manual entity creation. No import yet, no dedup — seven people typing names.

**Why the audit log now, before it's useful:** it's cheap to write from day one and impossible to backfill. v15 is only possible because v1 did this.

**Acceptance test:** Maya attempts an ask on a relationship where Juan has one logged in the last 90 days. She's blocked, sees whose ask it is, and can override with a reason that appears in the audit trail.

**Size:** 4–5 days.

---

## v2 — The dev feedback engine

**Goal:** close the loop between using the thing and improving it, so the remaining fourteen versions are driven by real friction instead of this document.

**Ships**
- A feedback box on every page: captures text, current URL, current user, and optionally a screenshot. Writes `platform.feedback` + an audit row.
- A triage job: LLM classifies into `{bug | request | question | spam}` with a confidence score. Above threshold it opens a Linear issue with labels and a link back to the originating page; below threshold it queues for human triage.
- **Linear connector** (first connector — OAuth with `actor=app` so agent changes are attributed to the app, not a person; webhook receiver verifying `Linear-Signature` HMAC-SHA256 with `webhookTimestamp` replay protection inside 60s).
- Claude Code GitHub Action wired to the `agent-ready` label. Agent opens a PR on a branch; it cannot approve its own PR.
- Branch protection: CI green + one human approving review.

**The guardrails, non-negotiable.** Microsoft's analysis of this exact integration found prompt-injection payloads hidden in HTML comments — invisible in the rendered issue, visible to the model — and a sandbox asymmetry letting `/proc/self/environ` reads exfiltrate keys ([Microsoft Security](https://www.microsoft.com/en-us/security/blog/2026/06/05/securing-ci-cd-in-agentic-world-claude-code-github-action-case/)).

- **Agents Rule of Two:** no workflow may simultaneously process untrusted input, hold secrets, and have external communication. Triage reads untrusted feedback and holds no repo credentials. Implementation holds credentials and reads only a human-labelled issue.
- System prompts declare issue bodies and file contents as **untrusted input, not instructions**.
- One key per workflow, least scope.
- `--max-turns`, workflow timeouts, and GitHub concurrency limits from the first run.
- Known gotcha: GitHub doesn't trigger workflows on commits made with the default `GITHUB_TOKEN`, so CI won't run on the agent's pushes unless it authenticates as a GitHub App.

**The human `agent-ready` label is the gate and it stays.** It's what keeps this from being a machine that writes code at you.

**Acceptance test:** Ines reports a bug from the ask-log page; a Linear issue exists within a minute with the page URL attached; you label it `agent-ready`; a PR appears; CI runs; you review and merge.

**Size:** 5–6 days. The most expensive early version and the one that pays for itself fastest.

---

## v3 — Entities, import, search

**Goal:** stop typing names. Get the existing relationship census in, with stable IDs that survive everything after.

**Ships**
- Full `identity.entity` with `merged_into` redirects; `identity.source_record`; `identity.assertion` (human same-as / not-same-as adjudications)
- CSV import for the existing census across PL, Fund I Neurotech, Crypto/Rails, podcast guests, gathering attendees
- Deterministic resolution only: normalized email, domain, exact name. No probabilistic matching yet.
- A merge/split UI writing to `identity.assertion`
- Fast search over entities
- Entity detail page: who they are, who owns them, their asks

**The rules that matter here and forever:** `entity_id` is a surrogate minted once, never derived from cluster contents. Merges set `merged_into` and never reuse the retired ID. Human assertions are hard constraints applied before and over any future model — a later re-run can never silently reverse them.

**Acceptance test:** import the census, merge three obvious duplicates by hand, and confirm the merges survive a re-import of the same file.

**Size:** 4–5 days.

---

## v4 — Vehicles, exposure, coverage

**Goal:** see the pipeline per vehicle and across all of them, including the relationships appearing in two at once.

**Ships**
- `pipeline.vehicle`, `pipeline.exposure` (entity × vehicle × instrument, one owner, stage, amount, probability)
- Stage model with the probability weights from the research — including the deliberate non-monotonicity where a soft circle is worth less than active diligence
- Coverage ratio per vehicle and in aggregate, against target and close date
- **Cross-vehicle conflict view:** relationships that are live pipeline in more than one vehicle
- Neurotech I, Crypto/Rails, and the live SPVs entered

**Acceptance test:** the coverage number for Neurotech I matches what you'd compute by hand, and the conflict view surfaces every relationship that appears in two vehicles.

**Size:** 4–5 days.

---

## v5 — Close room

**Goal:** the December number. Signature-to-wire is its own workflow and most tools treat a signed subscription document as the finish line when it's about a third of the way.

**Ships**
- Per-LP close tracking: verification status (from your providers), subscription docs sent/signed, side letter status, wire received
- The funded/committed/docs-out/gap breakdown against target
- Blocking reasons surfaced per row
- **MFN cascade calculator:** before conceding a term, compute its cost if every eligible LP elects it
- Median signature-to-wire, so you can plan backwards from 19 December

**Acceptance test:** for every LP in documents, you can answer "what is blocking this and who owns it" without asking anyone.

**Size:** 4 days.

---

## v6 — EDGAR signals connector

**Goal:** the first real connector, and the only new-prospect source that can plausibly produce a cheque inside the remaining window.

**Ships**
- **Connector runtime**: the four-method interface (`backfill`, `poll`, `onWebhook`, `normalize`), landing tables holding raw JSON, normalization as a separate replayable step, idempotency on `(source, source_id, source_updated_at)`
- Token bucket per source in Redis; circuit breaker; `connector.run` audit events with records fetched, errors, quota consumed
- **EDGAR**: full-text search on universe names, Form 4 insider sales, Form D filings. Free, no auth, structured, daily poll.
- `intel.signal` table, priority scoring, claim/expire lifecycle
- Signal desk page: triaged signals, claim to an owner, five-day decay back to the pool

**Why EDGAR first:** free, no rate anxiety, no vendor conversation, and liquidity events are the highest-conversion prospect category in the research. It also exercises the whole connector runtime on a source that can't bite you.

**Acceptance test:** a Form 4 filing by someone in the universe appears as a claimable signal within a day, with the filing linked.

**Size:** 5–6 days (most of it is the reusable runtime).

---

## v7 — Scoring

**Goal:** a ranked list people trust, which means every number opens.

**Ships**
- `scoring.score` with **four components stored separately, each with its own `last_refreshed` and evidence**: capacity, affinity, propensity, time-to-decision
- Propensity decays automatically on a configurable half-life; capacity and affinity refresh on event or annually
- Hard gates that exclude with a visible reason (check band, mandate, conflict, duration tolerance)
- **Two ranked views over the same data**: "EOY close" weights time-to-decision heavily; "2027 pipeline" doesn't. Same prospect, different rank.
- Explainable decomposition on every score — component, weight, contribution, evidence link, refresh date
- Weights live in config, versioned in git, changed by PR

**Acceptance test:** you disagree with a ranking, open the decomposition, and can say exactly which component is wrong and why.

**Size:** 5 days.

---

## v8 — Affinity connector

**Goal:** the interaction corpus and relationship strengths. The biggest connector, and the one whose shape depends on the day-0 answer.

**If Advanced or Enterprise — Data Share path:**
- Affinity Data Share into the warehouse: Snowflake secure views / Delta Sharing, **2-hour incremental refresh, zero API quota**, tables including `emails`, `meetings`, `calls`, `notes`, `transcripts`, `relationship_strengths`
- dbt models deriving per-entity facts; canon push into Postgres on a schedule
- REST API used only for writes and on-demand freshness

**If Scale — poll-first path:**
- Cursor-paginated backfill, budgeted against the **100,000 requests/month** cap (shared across v1 and v2 of their API)
- Incremental poll on `createdAt`/`updatedAt` — **never `sentAt`.** Auto-captured mail is backfilled by their connectors and can arrive with an old `sentAt` but a recent `createdAt`; watermarking on `sentAt` loses records silently.
- `/v2/field-value-changes` for CRM deltas, after auditing which fields have change-tracking enabled
- Monthly reconciliation sweep for deletes and `organization.merged` (merges rewrite IDs; naive incremental sync accumulates orphans)

**Both paths:**
- **Webhooks as invalidation only.** Affinity's webhooks carry no signature and there is no HMAC header in the docs, so no payload content is ever persisted. Unguessable receiver path, IP allowlist, every event triggers an authenticated read. `smart_interaction_value.updated` is the closest thing to a real-time interaction signal — treat it as "re-poll this person now."
- Probabilistic entity resolution (Splink) over the residual after deterministic rules, with the human review queue from v3 taking anything between the auto-merge and auto-reject thresholds

**Acceptance test:** an email sent this morning to a prospect is reflected in their entity timeline by end of day, and the ER queue has fewer than 20 items after the backfill settles.

**Size:** 8–10 days on the Data Share path, 12–15 on the poll path. **This is the version most likely to overrun.**

---

## v9 — Graph and route planner

**Goal:** turn a ranked list of names into a ranked list of routes, which is the actually actionable object.

**Ships**
- `network.edge` with time bounds, populated from Affinity `interactionScore` (0.0–1.0), plus structural signals: shared employer, shared education, co-attendance at your gatherings, podcast guest relationships
- **Tie bands computed, not raw strength** — the routing prefers the *moderate* band deliberately, per the inverted-U finding in the LinkedIn weak-ties experiment
- Connector objects: credibility domains (so a crypto connector isn't routed to a neuro foundation), goodwill balance with a replenishment model, delivery track record
- Path computation ranked by connector credibility *with that target*, tie band, and goodwill remaining — not hop count
- Intro workflow: request → opt-in A → opt-in B → forwardable sent → delivered → outcome → **loop closed**, with the last step enforced rather than optional
- Forwardable generator pre-filled with target context

**Acceptance test:** for five targets you know well, the top recommended route is one you'd actually have chosen — or the disagreement points at a specific wrong input.

**Size:** 6–7 days.

---

## v10 — Agent runtime

**Goal:** the research and briefing leverage, under gates.

**Ships**
- Agent worker process, **separate DSN, separate egress allowlist, separate secret scope** — the process reading untrusted web content is not the process holding the Affinity key
- **Two data planes enforced from the first commit, not retrofitted.** `research` schema granted to `agent_ro`; `confidential` schema granted to nothing. A prompt-injected query fails with *relation does not exist*.
- Two workers: **Researcher** (orchestrator–workers, produces cited dossiers) and **Brief writer** (prompt chain, pre-meeting one-pager)
- Tool layer: consolidated, namespaced, token-efficient returns, instructional errors
- **Every factual claim carries a source link; unsourced claims render visually flagged.** This is the mitigation for the most likely embarrassment — a fabricated detail in a brief that you repeat in a meeting.
- Hard caps: max turns, max tokens, wall-clock timeout, per-worker daily budget
- Langfuse tracing on every run
- **An offline eval set from day one** — 30 hand-labelled dossier tasks, 20 brief tasks. The most-cited production failure is having no way to tell whether a prompt change helped.

**Acceptance test:** a dossier for a new prospect is good enough that you'd walk into a meeting on it, and you can click through to the source for every claim.

**Size:** 7–8 days.

---

## v11 — Meeting intelligence

**Goal:** stop losing what was said, and turn objections into a signal.

**Ships**
- **Fireflies connector** — the only transcription tool with a documented signed webhook (`x-hub-signature`, HMAC-SHA256). Note it fires **only for meeting owners**, so everyone whose meetings matter must own their recordings.
- Transcripts land in the **confidential** plane; no general-purpose agent indexes them
- Post-meeting extraction: objections → taxonomy, commitment signals → stage transitions, new facts → dossier fields, actions → owner's queue
- `workbench.objection` with clustering
- **Threshold alert:** the same objection five times in seven days raises a materials task, because that's a slide to write, not five conversations to have

**Acceptance test:** after a call, the objection raised appears in the taxonomy and the stage change is proposed, without anyone typing notes.

**Size:** 5–6 days.

---

## v12 — Materials and delivery ledger

**Goal:** know who has which version, and who is out of date on the thing that answers their objection.

**Ships**
- **Google Drive/Docs connector**: `changes.list` incremental sync with a **push-channel renewal scheduler** — channels max at 1 day for files, 1 week for changes, and never auto-renew. This is the first thing that will silently break; give it its own alert.
- Domain-wide delegation for a single-domain internal tool. Docs API creates and edits; Drive API handles export and permissions.
- `content.asset` with versions; delivery ledger recording who received which version and whether they opened it
- Open-tier / gated-tier classification on every asset, with a publishing checklist gate
- **DocSend via Zapier**, accepting its limits: forward-only triggers, no backfill, no delivery guarantee, no signature. Everything DocSend-derived is labelled partial in the UI. Historical data before the Zap only arrives by manual CSV.

**Acceptance test:** you ship deck v8 and can immediately see the nine recipients still on a version that predates the duration slide.

**Size:** 6–7 days.

---

*— December close happens here —*

---

## v13 — Compliance registry (Q1)

**Ships:** vehicle registry with Reg D posture and ICA exemption per vehicle; beneficial-owner counts against 100/250/2,000 caps with warning thresholds; **integration-risk flag** when the same investor appears across vehicles closing in one window, and specifically when a 506(b) vehicle sits among generally-soliciting ones; side-letter and MFN register as structured, queryable data; Form D filing calendar.

**Acceptance test:** the registry independently surfaces the 506(b) SPV exposure that counsel flagged in week 1.

**Size:** 5 days.

---

## v14 — Grants track (Q1)

**Ships:** `grants` schema with its own pipeline and clock; funder records with **access mode as a first-class field** (open call / LOI-gated / nomination / invitation / co-design), since it determines the entire play; program officers as people with tenure and mobility tracking, so a move re-scores rather than silently decays the relationship; eligibility gates **with effective dates** and "this door closes in N days" alerts; **cost-to-pursue in senior FTE-hours as a negative weight**, ranking by expected dollars per senior hour.

**Acceptance test:** the ranking puts a co-design conversation above a larger open-call grant, and you agree with it.

**Size:** 6 days.

---

## v15 — Learning loop (Q1+)

**Ships:** replay over the audit log; commitments attributed to origin path with conversion rates by channel, tie band, and connector; counterfactual re-ranking ("what if time-to-decision were weighted 20% instead of 5%"); the autoresearch proposal queue — observations become **proposals a human accepts or rejects**, never auto-applied changes.

**Honest framing in the UI:** replay is a hypothesis generator, not proof. At 34 commitments a single close moves every number, and the interface says so.

**Acceptance test:** it answers whether SPV participants actually became fund LPs — a question the whole industry believes it knows and has never measured.

**Size:** 6–8 days. Only meaningful with 12+ months of log.

---

## Provisioning summary

| Added at | What | Why then |
|---|---|---|
| v0 | Repo, CI/CD, managed Postgres, two services, preview envs with DB branching, secrets per workload, Sentry, migrations | Everything downstream is a small diff |
| v0 | DB roles `app_rw`, `connector_rw`, `agent_ro` | Creating `agent_ro` before agents exist is how the boundary stays honest |
| v2 | Linear OAuth app, GitHub App for CI, Claude Code Action, branch protection | The loop that makes v3–v15 cheaper |
| v6 | Redis (token buckets, cache), landing schema, circuit breakers, connector audit | First real connector needs the runtime |
| v8 | Warehouse schema + dbt, canon contract v1 (or a Data Share loader if no warehouse access) | Only Affinity needs it |
| v10 | Agent worker process with isolated DSN/egress/secrets, Langfuse, eval harness | Isolation must precede the first agent commit |
| v11 | Confidential-plane storage for transcripts | Sensitive data arrives here |

## Connector summary

| Connector | Version | Pattern | Signature | Main trap |
|---|---|---|---|---|
| Linear | v2 | Signed webhook + `updatedAt` sweep | ✅ HMAC-SHA256 | Complexity points, not request count, is the limit |
| EDGAR | v6 | Daily poll | n/a | None. Free and structured. |
| Job boards / 990-PF | v6.5 (inside v6 if time) | Poll | n/a | ToS and robots |
| Affinity | v8 | Data Share, or poll-first | ❌ **none** | Watermark on `createdAt`, not `sentAt`; 100k/month cap; merges rewrite IDs |
| Fireflies | v11 | Signed webhook | ✅ HMAC-SHA256 | Fires only for meeting owners |
| Google Drive/Docs | v12 | `changes.list` + push channels | ⚠️ token only | **Channels expire and never auto-renew** |
| DocSend | v12 | Zapier → webhook | ❌ n/a | No API, no backfill, forward-only |
| Sydecar / AngelList | — | Manual CSV | — | Gated docs. Nothing depends on them. |

## Descope order, if you fall behind

Cut in this sequence, and cut *within* a version before dropping one:

1. v12 materials → deck versioning by hand for one more quarter
2. v11 objection clustering → keep transcript capture, drop the taxonomy
3. v9 connector goodwill modelling → keep paths, score them crudely
4. v7 fourth score component → ship with three
5. v8 Splink → deterministic resolution only, accept a longer review queue

**Never cut:** v1 (the guard), v2 (the loop), v5 (the close room). Those three are the December number.

## Risks specific to this plan

| Risk | Mitigation |
|---|---|
| **v8 overruns** and eats weeks 6–9 | Timebox to 10 days; if the poll path looks like 15, ship v9 against structural graph signals only (shared employer, events, podcast) and add interaction strength later |
| **The agent loop writes code nobody reviews properly** | The `agent-ready` label is human-applied; one approving review required; CI quality is the actual gate, so invest there before agent plumbing |
| **Build competes with the raise** | Every version has an acceptance test phrased as someone's behaviour. If you can't name the person, don't build it. |
| **Drive channel renewal fails on a weekend** | Its own alert, plus a weekly reconciliation sweep as backstop |
| **Entity IDs churn** and erode trust | Surrogate IDs, assertion table as hard constraints, threshold changes treated as reviewed migrations |
| **Preview environments not possible** on PL's platform | Fall back to a shared staging DB seeded with **synthetic** entities — never real LP data in a lower-trust environment |
