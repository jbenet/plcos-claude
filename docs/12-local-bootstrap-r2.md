# Capital OS — Local-First Bootstrap, revision 2

**Twelve local versions. Feedback capture at L1 as filesystem markdown. Strategy and warm-intro routing lifted early so the thing is productive on a laptop.**

*Prepared 20 September 2026. Supersedes the L-series in `11-local-bootstrap.md`. PGlite, the five seams, and the D-series carry over unchanged.*

---

## What changed

1. **Feedback capture is L1**, bundled with the app skeleton and nothing else.
2. **Issues are markdown files on disk**, not database rows — one file per issue, git-tracked, directly readable and editable by a coding agent with no GitHub involved.
3. **Five modules lifted into the L-series**: warm-intro routing, target strategy, objections, materials ledger, and agent assist. The test for lifting was whether a module is genuinely useful with hand-entered data, and most of them are.
4. **Entities move ahead of the ask log**, because everything references them.

---

## L1 — Skeleton and feedback

**Ships:** Next.js app, PGlite at `./local/capital.db`, migrations on boot, the user switcher in the header, the five seams with local implementations — and the feedback box.

### Issues as files

The feedback box writes a markdown file. No table, no row, no migration.

```
issues/
  0001-guard-copy-doesnt-name-the-blocker.md
  0002-route-ranking-put-okonjo-first.md
```

```markdown
---
id: "0001"
title: Guard message doesn't say whose ask is blocking
status: open          # open | triaged | agent-ready | in-progress | review | done
kind: bug             # bug | request | question | chore
reporter: juan
page: /asks/new
created: 2026-09-20T14:31:00Z
labels: [coordination, copy]
---

Tried to log an ask on Hartwell and got blocked, but the message just says
"blocked by frequency guard". I need to know it was Maya, and when, or I have
to go hunting.

```json context
{ "user": "juan", "route": "/asks/new",
  "entity": "hartwell-holdings", "vehicle": "neurotech-i",
  "conflictingAskId": "a_01H9…", "filters": { "vehicle": "neurotech-i" } }
```
```

**Why files beat a table here, concretely:**

- **A coding agent reads them natively.** Claude Code opens `issues/`, reads the frontmatter, and works. No API, no token, no webhook, no GitHub. You set `status: agent-ready` by editing one line.
- **The request and the fix travel together in one PR.** The diff shows the complaint and the code that answers it.
- **They survive `npm run db:reset`**, which you'll run constantly in the L-series.
- **You can edit them in your editor**, triage in bulk with `sed`, and grep the backlog.
- **They're already versioned.** `git log issues/` is the triage history for free.

The `IssueSink` seam stays, so `GitHubIssueSink` drops in at D2 — and a small sync script can push open files to GitHub and write the issue number back into the frontmatter, keeping both readable.

**One design detail worth getting right at L1:** the box captures **app state, not just text**. Route, current user, the entity or ask in view, active filters — serialized into that `json context` block. A reproducible issue is worth three vague ones, and it costs nothing to capture at the moment of frustration.

Also ships: an Issues page in the app reading the directory, and `npm run issues` to list and filter from the terminal.

**Feel test:** hit a rough edge, file it in five seconds without leaving the page, then open the markdown file and find enough context to act on it tomorrow.

**Size:** 3 days.

---

## L2 — Entities, import, search

**Ships:** full entity model with `merged_into` redirects, `source_record`, `assertion` (human same-as / not-same-as as hard constraints that no later model can reverse). CSV import. Deterministic resolution only. Merge/split UI. Fast search. Entity detail page.

**Feel test:** import the real census, merge three duplicates by hand, re-import the same file, confirm the merges survived.

**Size:** 4 days.

---

## L3 — Ask log, guard, audit

**Ships:** `coordination.ask`, `platform.audit_event`, the ask log page, the frequency guard as a synchronous check in the write path with a reasoned override, audit rows in the same transaction as every state change.

**Honest note on ordering:** the guard's real value is multi-user, so solo it's mostly a schema foundation and an "when did I last ask this person" lookup. It sits at L3 because everything downstream references asks, not because it's the most useful thing on a laptop. The collision moment is still worth feeling via the user switcher — tune the cap and the override friction here.

**Size:** 3 days.

---

## L4 — Network and warm-intro routing *(lifted)*

**Ships:** `network.edge` with time bounds and evidence. Connector records with credibility domains, goodwill balance and delivery history. Tie bands computed from strength. Path ranking by **connector credibility with that specific target × tie band × goodwill remaining** — never hop count. The intro workflow end to end: request → opt-in A → opt-in B → forwardable sent → delivered → outcome → **loop closed**, with the last step enforced. Forwardable generator pre-filled with target context.

### How it works with no Affinity

Edges come from four places, none of which need an API:

1. **Manual entry.** You know your graph. A form that says "Duettmann knows Roos, moderate, co-attended Vision Weekend 2025" takes fifteen seconds.
2. **CSV import** of your connector list, with strength and domain.
3. **Structural inference from the census** — shared organisation, shared event attendance, podcast guest relationships. All already in the entity import.
4. **Bulk-tag flows.** "Everyone who attended LabWeek neuro track" becomes co-attendance edges in one action.

**And there's a real argument that hand-curated is better here.** Affinity's `interactionScore` measures email and calendar frequency, which is a proxy for contact, not for trust or willingness. For the two hundred relationships you actually know, your own band assignment is more accurate than the derived one. When Affinity arrives at D4 it becomes an *additional* signal and a way to cover the long tail — not a replacement for your judgment.

The moderate-band preference (per the inverted-U weak-ties finding) is where the value is, and it works identically on a hand-built graph.

**Feel test:** for five targets you know well, the top recommended route is one you'd have chosen — or the disagreement points at a specific wrong input you can fix in the UI.

**Size:** 5 days.

---

## L5 — Target strategy workspace *(lifted)*

**Ships:** one page per target — the argument that wins them, objections to pre-empt with the count of how often each has come up, instrument choice, the planned sequence with stage markers, owner, materials to send, and the window. Linked to the entity, the exposure, and the recommended route from L4.

**Why this works without agents.** The value is the *structure*, not the generation. Forcing "what is the argument, what will they object to, what is the sequence" into fixed fields is most of the benefit, and it makes strategies comparable across targets and reviewable by someone else. Agent drafting is L12 and it drafts *into* this structure.

**Feel test:** write the strategy for your three hardest live targets. It should take twenty minutes each and leave you with something you'd hand to Maya.

**Size:** 4 days.

---

## L6 — Vehicles, exposure, coverage

**Ships:** `vehicle`, `exposure`, the stage model with its deliberate non-monotonicity (a soft circle scores below active diligence), coverage ratio per vehicle and aggregate, cross-vehicle conflict view.

**Feel test:** the coverage figure matches your own arithmetic, and the conflict view names every relationship sitting in two vehicles.

**Size:** 4 days.

---

## L7 — Close room

**Ships:** per-LP close tracking (verification, sub docs, side letter, wire), the funded/signed/out/gap breakdown, blocking reason per row, MFN cascade calculator, median signature-to-wire.

**Feel test:** for every LP in documents you can say what's blocking it and who owns it, without asking anyone.

**Size:** 3 days.

---

## L8 — Scoring and ranked targets

**Ships:** four components stored separately with their own refresh dates and evidence, propensity decaying on a half-life, hard gates excluding with visible reasons, two ranked views (EOY close / 2027 pipeline) over the same data, full decomposition, weights in config.

**Feel test:** you disagree with a ranking, open the decomposition, name the wrong component, change a weight in config, reload, watch the order move.

**Size:** 4 days.

---

## L9 — Signals on fixtures

**Ships:** the connector runtime for real — four-method interface, landing tables, normalization as a separate replayable step, idempotency on `(source, source_id, source_updated_at)`, token bucket, circuit breaker, `connector.run` audit. One implementation: `FixtureConnector` over `./fixtures/`. `intel.signal` with priority, claim, five-day decay. Signal desk page.

**Feel test:** `npm run signals:load` and a liquidity event appears as a claimable signal with the filing linked. Claim as Maya; it leaves the pool.

**Size:** 4 days.

---

## L10 — Meeting notes and objections *(lifted)*

**Ships:** a notes editor per meeting, linked to entity and exposure. Objection tagging against a taxonomy, built up from your real conversations rather than guessed in advance. Clustering view with frequency and outcome (became a pass / stalled / answered in the room). The threshold alert: same objection five times in seven days raises a materials task.

**Why it works without Fireflies.** You paste or type notes and tag the objection — ten seconds per meeting. The taxonomy that emerges is *yours*, grounded in what people actually said, which is a better foundation than a taxonomy invented up front and then force-fitted to transcripts. Automated extraction at D-series slots into the same taxonomy.

**Feel test:** after three weeks of notes, the clustering tells you something you hadn't consciously noticed.

**Size:** 3 days.

---

## L11 — Materials ledger *(lifted)*

**Ships:** `content.asset` with versions, and a delivery ledger — who received which version, when, and whether you know they opened it. Open-tier / gated-tier classification with a publishing checklist. Staleness view: who is on a version that predates the fix for the objection they're most likely to raise.

**Why it works without Drive or DocSend.** Recording "deck v7 → Hartwell, 11 Sep" is five seconds of typing, and the useful output — *nine people are on a version that predates the duration slide* — needs only that. Drive sync and DocSend opens are enrichment at D-series, not prerequisites.

**Size:** 2 days.

---

## L12 — Agent assist *(lifted, optional)*

**Ships:** `ClaudeAgent` behind the existing `Agent` seam, activated only if you set a key. Two tasks: **draft a dossier** for an entity from public sources, and **draft a strategy** into the L5 structure from the dossier plus the objection taxonomy. Every factual claim carries a source link; unsourced claims render visually flagged. Hard turn and token caps. Traces to a local file; Langfuse at D6.

**Deliberately not here:** the worker fleet, budgets, two-plane grant separation, eval harness. Those are D6. This is one process, on your laptop, drafting into structures you already trust.

**Feel test:** a drafted dossier is good enough to walk into a meeting on, and you can click through to the source for every claim.

**Size:** 3 days.

---

## Sequencing and the honest tension

**Total: ~42 engineer-days.** At half-time that's roughly eight weeks, which runs to late November.

| Block | Versions | Days | What it gives you |
|---|---|---|---|
| **Core** | L1–L7 | 26 | Productive solo: your universe, your routes, your strategies, your pipeline, your close |
| **Depth** | L8–L12 | 16 | Ranking, signals, objections, materials, drafting |

**The tension to name:** the L-series makes *you* productive. The December close needs *seven people*, and seven people cannot all run `npm run dev`. Every day past L7 spent polishing locally is a day the team isn't using it.

**So: start D0 and D1 when L5 ships**, in parallel. Provisioning and auth are about four days that don't compete with feature work, and the `DATABASE_URL` swap is genuinely a config change if nothing reached past the repository interface. L8–L12 can then be built against the deployed instance, with the team already filing issues into `issues/` — which is exactly the loop L1 exists to create.

**If you're behind:** ship L1–L7 locally, deploy, and treat L8–L12 as the first D-series features. Nothing in that order wastes work.

---

## Revised repo shape

```
capital-os/
  issues/                     # git-tracked. the tracker IS the filesystem.
    0001-….md
  config/deployment.ts        # every deferred decision, one file
  lib/
    db/       pglite.ts · postgres.ts · migrate.ts
    auth/     local.ts · labos.ts
    issues/   file.ts · github.ts        # IssueSink
    connectors/ types.ts · fixture.ts · edgar.ts · affinity.ts
    agent/    stub.ts · claude.ts
  modules/
    identity/ coordination/ network/ strategy/ pipeline/
    intel/ scoring/ content/ workbench/
      …each: schema.sql · repo.ts · service.ts · index.ts
  app/                        # Next.js routes
  fixtures/                   # edgar-form4.json, entities.csv, edges.csv
  local/                      # gitignored: capital.db
  scripts/  reset · seed · demo · issues · signals-load
```

Two boundaries enforced from L1, both an afternoon's work and both miserable to retrofit: **schema-per-module** so cross-module joins fail rather than being frowned upon, and a **lint rule** forbidding imports of anything but a module's `index.ts`.

---

## Seeds

`npm run demo` should load a coherent December snapshot: mid-raise, one ask conflict pending, three signals unclaimed, two LPs blocked in the close room, one target with a half-written strategy, and a graph dense enough that route ranking has real choices to make. That's the thing you show the team when you're asking them to adopt it.

If you seed with the real census, `./local/` stays gitignored and the laptop is the only copy. Real names and amounts shouldn't reach a shared repo.

---

## Next

**L1 is the natural first build** — skeleton, PGlite, user switcher, feedback box, markdown issues, the issues page, and seed data. Two to three days of work, and the moment it exists every subsequent iteration gets captured properly instead of living in this thread.

Say go and I'll build it.
