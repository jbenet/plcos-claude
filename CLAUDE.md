# Capital OS

Fundraising strategy and operations for PLC Neurotech I, PLC Crypto/Rails, the SPVs, and
the grants rail. Built to be run locally first, by one person, before any service is
deployed and before any external system is connected.

**Read `docs/13-synthesis-r3.md` first.** It is the current plan and supersedes docs 10–12.
`docs/09-system-architecture.md` is the underlying design. Docs 01–08 are the research the
design rests on; consult them when a domain question comes up, don't read them all upfront.

The design boards in `design/` are the visual spec. `S1`, `S2` and `S3` are the current
direction; open `design/index.html` in a browser. Everything else there is earlier
exploration — do not treat it as a requirement.

---

## The situation this serves

~$60M committed to PLC Neurotech, ~$30M to PLC Crypto/Rails. Goal: ~$30M more before EOY
for the Neurotech first close, plus 3+ SPVs closed. All vehicles are 506(c). Four
concurrent raises chase an overlapping LP universe, which is where most of the hard design
problems come from.

Seven-plus people plus their agents will eventually use this. Right now, one person does.

---

## Real data — read before touching `data/real/`

Two data profiles since N38 (`docs/15-affinity-integration.md`). `npm run dev` serves
**demo**: fictional, port 3000, safe to reset, screenshot and publish. `npm run dev:real`
serves **real**: the Affinity replica and everything written about it, on `127.0.0.1:3100`
only. `DATA_PROFILE` picks one, in `config/deployment.ts`.

- Everything real lives under `data/real/`, which git ignores. None of it goes into a commit,
  the changelog, a screenshot, the published build log, `issues/`, a web search or a
  sub-agent prompt. Changelog entries about real-data work use counts and invented examples.
  Juan is fine with Claude reading real records while working; that is the only exception.
- **Affinity is read-only.** The key can write and cannot be scoped, so read-only is
  enforced in the client: GET only, allowlisted paths, a property test that a write throws.
  Writing back is a later decision, and would go through approval tickets.
- Affinity fields are claims, not evidence. A stage is not a ladder rung. An amount is soft
  unless a field has been designated as meaning signed. Relationship strength is a tier-C
  edge.
- Seeding, `db:reset`, `npm run demo` and `npm run shots` refuse the real profile. Keep it
  that way. Writes to the real database happen inside the real server's process.
- **Migrations are append-only from N38.** The real database cannot be reset, and the
  migration runner refuses a file whose checksum changed after it was applied. So an applied
  migration is never edited; a change is a new `NNN_…sql` file in the same module.
- Only `lib/connectors/affinity/` talks to Affinity (`npm run boundaries` enforces it). The
  key lives in one macOS Keychain item (`npm run key:store`), trusted to no app, so each read
  asks Juan; `scripts/with-affinity-key.sh` hands it to `dev:real`'s environment. Never
  printed, never in a file. Not 1Password: its CLI authorizes a whole account, not one item.
  Deployment will need its own secret store.

---

## Stack — settled, do not relitigate

- **TypeScript**, **Next.js** with SSR. No separate API service.
- **Postgres**. **PGlite** for local dev — real Postgres semantics, zero services.
  Not SQLite: we need `jsonb`, `CREATE SCHEMA`, `gen_random_uuid()`, strict types,
  `ILIKE`, arrays and real upsert syntax.
- **Modular monolith**, schema-per-module.
- **Two data planes** — research and confidential — separated by **grants and schema
  separation, not RLS**.
- Durable workflow engine (Trigger.dev or Inngest Cloud) — deferred until D-series.
- Langfuse for agent observability, Splink for entity resolution — both deferred.
- Dev loop: GitHub Actions + Claude Code Action — deferred until D2.

## The five seams

Every external dependency sits behind one of these, each with a local implementation from
L1. This is what makes the whole product runnable with no cloud and no SaaS account.

```ts
Db            // PGlite locally, Postgres in the live version
Connector<T>  // backfill / poll / onWebhook / normalize — all stubbed locally
AuthProvider  // local user switcher now, PL LabOS kit later
IssueSink     // markdown files now, GitHub issues later
Agent         // no-op locally unless an API key is present
```

## Deferred decisions live in one file

```ts
// config/deployment.ts
export const config = {
  affinity:  { tier: null as 'scale'|'advanced'|'enterprise'|null,
               syncMode: 'deferred' as 'deferred'|'poll'|'dataShare' },
  warehouse: { enabled: false, canonMode: 'inProcess' as 'inProcess'|'warehouse' },
  issues:    { provider: 'file' as 'file'|'linear'|'github' },
  auth:      { provider: 'local' as 'local'|'labos' },
  guard:     { asksPerRelationshipPerQuarter: 1,
               asksPerConnectorPerQuarter: 3,        // GUESS — replace with real data
               conflictWindowDays: 14 },             // GUESS
  scoring:   { weights: { capacity: .25, affinity: .30,
                          propensity: .25, timeToDecision: .20 } },
  agents:    { correctionBudgetHoursPerWeek: 12 },   // GUESS — circuit breaker threshold
};
```

Every constant marked GUESS came from an unverified source. None should survive two weeks
of real data. Do not scatter these values through the codebase.

---

## Domain rules that are not negotiable

These exist because getting them wrong is how this system would quietly lie to Juan.

**1. Soft and hard never blend.** The headline number is hard-only — signed and
countersigned. Soft commitments live in a separate track, labelled, with
`convertible soft = Σ soft × P(commit)` shown but never added to hard. There is no blended
AUM figure across Neurotech, Rails, SPVs and grants anywhere in this system. Ever.

**2. The consent ladder has six states and no implicit transitions.**

```
connector willing → target opted in → meeting held → indication given
  → commitment accepted → cash received
```

Each step up requires a specific evidence record. A connector saying "happy to ask" is the
first rung and nothing more — it is not target interest, not a meeting, not a commitment.
Render it as a stepper so the gap between claimed and evidenced state is visible.

The ladder is not the pipeline status (N50, `docs/17-pipeline-model.md`). The status — new,
sourcing, selected, discussing, committed, passed — is our plan: set by a person, any
direction, no ticket, and it never writes a rung. The second rung displays as "LP opted in";
"target" means only a vehicle's size goal.

**3. Five approval-ticket kinds gate mutations, before the fact.**

`SEND` · `INTRO_ASK` · `MONEY` · `STAGE` · `ALLOCATION_EXCEPTION`

Every mutating command in those families takes a `ticketId` and **fails closed** without an
approved, unexpired one. One open ticket per subject per kind. An approval authorizes a
*specific bounded action*, stated in the ticket's `scope` — never an opaque bundle.

**4. Agent-run success, task acceptance, investor approval, legal close and cash receipt
never share one check mark.** Five different states, five different affordances.

**5. Cross-vehicle collisions become a record, not a block.** When an actor has another
open opportunity in a different vehicle inside `conflictWindowDays`, open a `ConflictCase`.
Adjudication writes winner, loser, reason code, **and a dated follow-up for the loser**.
Blocking without the dated follow-up loses the opportunity silently — that is the bug.
*Juan, 23 Sep 2026:* an LP on two vehicles' lists is usually good for them and for us; it
needs coordinating, not winning. Say "coordinate" in copy where the case is only an overlap,
and keep "conflict" for two asks that would actually collide.

**6. Evidence tiers A–D on relationship edges. C and D always require a human** before the
edge is trusted for routing. Co-attendance, shared affiliation and a public social
connection are discovery clues, not proof of a relationship.

**7. Coverage disclosure on every search.** State which corpus and date range were
inspected. Distinguish *"no supported route in the material available"* from *"no route
exists."* An empty result list reads as the second while only justifying the first.

**8. Non-circumvention.** A decline or do-not-approach instruction changes the plan. Never
respond by substituting a different connector toward the same prohibited approach. The
restriction attaches to the **target**, and the route planner checks every candidate path.

**9. Provenance tuple on every externally-sourced field:**
`source, as_of, confidence, last_verified_by`. A brief that cannot show them must refuse to
make the claim.

**10. Conserved capital pool.** The sum of fund and SPV amounts stays within one budget; an
unverified grant budget is excluded. Deterministic check in code. An agent may propose
assumptions; code does the arithmetic.

**11. Wrong-wrap matrix.** `Vehicle × Instrument → allowed material scopes`, checked at
send time. `wrong-wrap sends = 0` is a hard KPI.

**12. No-unsolicited grant gate.** Grants-rail outreach is blocked until a funder
invitation exists. "Sourced, not applied for" is a state machine guard, not advice.

---

## Agent rules

- Every run gets a **work envelope**:
  `{task, scope, allowed_evidence, allowed_commands, budget, deadline, output_schema,
  acceptance_criteria, escalation_owner}`. A policy check validates each tool call against
  it. **Delegation cannot increase permission** — a child task gets the same or narrower
  scope.
- **No tool sends anything, and no tool accepts its own proposed task.** Drafts and
  proposals only; a human accepts. Acceptance uses a stable idempotency key so a double
  click cannot create duplicates.
- **Run records pin resolved config and input hashes.** Editing a prompt must not
  retroactively change what a completed run meant.
- Prompt changes run against a **protected set of example cases** before landing. The agent
  cannot modify its own pass criteria or runtime permissions to win. Add real failures to
  the set continuously — a fixed set overfits.
- **Circuit breaker:** if correction burden exceeds `config.agents.correctionBudgetHoursPerWeek`,
  freeze new agent autonomy.
- Putting a tool name in a prompt does not enable it. The server controls which tools exist.

---

## Frontend contract

- **Persistent left rail, four umbrella sections**, not 24 flat nav items. Sections:
  *Discover & qualify* (01–06), *Convert & coordinate* (07–12), *Create & substantiate*
  (13–17), *Execute & govern* (18–24). Plus Today and Approvals above them.
- Breadcrumb bar with a **visible last-sync time**. Staleness is never silently rendered as
  freshness.
- Right-hand inspector opens on selection.
- **Palette** (validated, colour is never the only signal):
  ground `#F5F3EE`, surface `#FFFFFF`, ink `#1A1917`, muted `#5E5A52`, line `#E4E0D6`,
  clay `#BF4A16`, green `#0E7F55`, purple `#5F4B9E`, amber `#8A6410`.
  Rail: `#1A1917` with `#EFEBE2` text.
- **Type:** Fraunces (display), IBM Plex Sans (body), IBM Plex Mono (labels, data).
- **Status vocabulary is plain language**, never a numeric confidence rendered as fact:
  "Agent working", "Ready for review", "Waiting on counterpart", "Needs evidence",
  "Verified by administrator", "Source unavailable".
- **Optimistic updates only for reversible presentation choices.** Consequential commands
  wait for a server receipt.
- **Every canvas needs a list equivalent.** The route graph must have a keyboard-navigable
  path list carrying the same information — an equal presentation, not a degraded fallback.
- **States to design and test, all of them:** empty, loading, failed sync, expired
  permission, stale evidence, conflicting edits, unavailable owner, paused, exhausted
  budget, rejected claim, revoked authorization, ambiguous external execution. Each must
  say what is known, who can act, and the safe next step.
- Two components carry a discipline and should exist by name: `EvidenceRef` (inline source
  pointer, used everywhere a claim is made) and `AudienceVariants` (variant switcher for
  one canonical asset).

---

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

## Build sequence

L1 through L13, ~53 engineer-days. **`docs/13-synthesis-r3.md` §4 has the full table with
what lands at each stage.** Core is L1–L8 (34d), Depth is L9–L13 (19d).

**L1 is the first build:** console shell, PGlite, user switcher, feedback box, markdown
issues, the issues page, seed data. Nothing else. ~4 days.

If time gets short, trim in this order: L10 signals, then L9 scoring, then L13 to a stub.
**Do not trim L3 or L4** — two independent design reviews both found the plan thinnest
there.

---

## Do not build

Half of what went wrong in the alternate designs was building the wrong layer first.

- **No connectors before L13.** No Linear, no Drive, no DocSend. Everything else runs on
  seed data and fixtures until the product shape is proven. **Exception, decided
  22 Sep 2026:** Affinity, read-only, from N38 (`docs/15`). Writes to Affinity are still
  prohibited.
- **No auth integration.** Local user switcher only. LabOS comes later.
- **No graph database.** Recursive CTEs in Postgres handle two- and three-hop enumeration
  at this scale.
- **No vector database, no event broker, no service mesh, no microfrontends, no plugin
  framework, no warehouse pipeline.**
- **No module registry or event-subscription contract yet.** A module may begin as a
  playbook plus an output format; a dedicated screen is a later optimization, not a
  prerequisite. Modules 02, 06, 12, 13, 17 and 23 start without screens.
- **No full event sourcing.** Append-only audit log plus a transactional outbox, which is
  different and sufficient.
- **Do not claim durable orchestration that has not been built.**

## Promotion rule for schema

A `note` table holds anything not yet worth a migration. Promote a concept into real
columns when — and only when — users repeatedly need to filter it, a mistake recurs, a tool
needs a precise input, or performance becomes a demonstrated problem.

---

## Open questions — get answers before the code depends on them

1. **Affinity plan tier.** Data Share (Enterprise) versus poll-first. This one changes the
   connector design, not just the schedule. Measured 23 Sep 2026 by the connection test: the
   account has the 100,000-a-month cap, so it is Scale or Advanced — the API can't tell which,
   and only Advanced has Data Share. Poll-first until someone checks the plan.
2. **Warehouse access.** Own schema with write permission for canon tables?
3. **Linear custom fields.** UNVERIFIED in all three design packages. Check the live
   GraphQL schema before anything depends on it. The integration points the product
   already assumes are written down in `docs/14-linear-integration-points.md`, including
   the outbox (`plays.handoff`) that records what would be sent, and the proposal for a
   dedicated board for observable agent runs.
4. **Integration risk.** One 506(b) SPV among four 506(c) vehicles — a conversation for
   counsel, not a data model.

Sydecar and AngelList API access is gated with a long lead time. Nothing depends on it.

---

## Working notes

- **Changelog screenshots** are 2000 px WebP at quality 80 (`scripts/shot-image.ts`).
  `npm run shots -- <version>` captures against the running demo server, writes
  `docs/changelog/shots/<version>/NN-name.webp`, and prints each file's size. Link them from
  CHANGELOG.md with the `.webp` name. Never commit a PNG there: `npm run boundaries` fails
  on one, and on any file over 512 KB. `npm run shots:compress` converts a stray capture and
  fixes its links. Git keeps every image forever, so size is paid on every clone.

- Prose in docs and UI copy: plain, specific, no hype. Say the number or say you don't know
  it.
- When a constant is a guess, say so in the comment. Do not launder an estimate into a fact.
- Push back when the plan is wrong. Two design reviews improved this materially; a third
  would too.
