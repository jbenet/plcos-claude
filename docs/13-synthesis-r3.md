# Capital OS — plan r3, after the v3/v4 harvest

**What this is.** I read both alternate packages against my own plan, took what beats mine,
and refused what doesn't. This document states each borrowing, its source, and the reason.
It then restates the module map (four sections, 24 modules) and the build sequence (L1–L13,
~53 engineer-days, up from 42).

The headline: **v3's contribution is governance mechanics, v4's is epistemic discipline.**
Neither has a better data architecture than mine, and I'm keeping mine intact. But both
found real gaps in how the system decides what it is allowed to do and what it is allowed
to claim, and those gaps were worth eleven extra days.

---

## Part 1 — What I'm taking

### 1.1 From v3: governance mechanics

**Typed approval tickets as a pre-mutation gate.** The single best idea in either package.
v3 defines a closed set of exactly five ticket types — `SEND`, `INTRO_ASK`, `MONEY`,
`STAGE`, `ALLOCATION_EXCEPTION` — and structurally blocks the domain command until a
matching ticket exists. My design had an append-only audit log, which is a record taken
*after* the fact. A gate that sits *in front of* the mutation is strictly better: it makes
"who approved this" unanswerable-by-omission rather than reconstructible-after-the-incident.

I'm implementing it as a check in the command layer, not a trigger:

```sql
create table approval_ticket (
  id            uuid primary key,
  kind          approval_kind not null,   -- SEND | INTRO_ASK | MONEY | STAGE | ALLOCATION_EXCEPTION
  subject_type  text not null,            -- 'ask' | 'opportunity' | 'material_send' | ...
  subject_id    uuid not null,
  scope         jsonb not null,           -- the bounded action, see §1.2 on "Approve"
  requested_by  uuid not null references app_user(id),
  decided_by    uuid references app_user(id),
  decision      approval_decision,        -- approve | reject | request_changes | defer
  decision_note text,
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  decided_at    timestamptz
);
create unique index on approval_ticket (kind, subject_type, subject_id)
  where decision is null;                  -- one open ticket per subject per kind
```

Every mutating command in those five families takes a `ticketId` and fails closed without
an approved, unexpired one. Lands at **L3**.

**Multi-vehicle conflict adjudication as a first-class object.** My ask guard was
one-owner-per-relationship plus a frequency cap — a *blocker*. v3 makes the collision a
record with its own lifecycle: an interceptor fires when an actor has another open
opportunity in a different vehicle within a configurable window (their default: 14 days),
and adjudication produces `Adjudicate(winner, loser, reason)` plus a **dated follow-up for
the loser**.

That last part is what my design was missing. Blocking an ask protects the relationship but
loses the deferred opportunity; a conflict case with a `loser_followup_at` date turns the
block into a scheduled second bite. For four concurrent vehicles chasing an overlapping LP
universe, this is the difference between a guard and a portfolio policy. Lands at **L3**,
folded into module 07.

**Soft and hard never blend.** v3 states this as policy, not style: the headline forecast
number is hard-only; soft commitments live in a separate waterfall labelled "must convert."
Their one formula, `convertible soft = Σ soft × P(commit)`, is deliberately kept *off* the
headline. I under-specified this — I had "coverage ratios" and left the soft/hard boundary
implicit, which is exactly how a $30M gap gets reported as closed three weeks before it is.

Taking the whole discipline: two separate tracks, a dedicated **Soft→Hard cockpit** (new
module 08), and an explicit written non-goal — *no blended AUM figure across Neurotech,
Rails, SPVs and grants ever appears in this system*. Lands at **L6**.

**Connector ask-load cap with a hard block.** I had a frequency guard on the *target* side.
v3 puts the cap on the *connector* side — asks per connector per period, with a cooldown,
and `ask_pressure ≥ cap` blocks a new intro request outright. Their range (1–5) is a guess
and they label it as one, so I'll make it configurable with a default of 3 per quarter and
let real data move it. The connector-side view matters more than the target-side view,
because connector goodwill is the scarcer resource and the one you cannot buy back.
Lands at **L4**.

**Graph edge confidence tiers with a hard HITL rule.** Tiers A–D on relationship edges, and
**C and D always require a human** before the edge is trusted for routing. Cheap, and it
stops the route planner from confidently proposing a path built on a conference badge scan.
Lands at **L4**, and it pairs exactly with v4's per-hop evidence rule (§1.2).

**Sprint calendar with a holiday overlay.** Thanksgiving 26 Nov; the 20/23/30 December
milestones; a defined post-23-December dead zone that suppresses queue urgency rather than
nagging into a vacuum. This is a two-day module that, for a raise with a December close,
changes what the system says on roughly a third of the remaining working days. I dismissed
calendar-of-friction as a nicety; for this particular raise it isn't. New module 22,
lands at **L7**.

**SPV pod war room.** My close room was fund-shaped — a long clock, a committee, a
subscription pack. An SPV closes on a days-scale clock with a different pipeline:
`invite → IOI → allocate → wire`, headline KPI **days-to-wire**. You have 3+ to close.
Giving them the fund's UI would have been a real mistake. New module 19, lands at **L8**.

**The automation trust circuit breaker.** If correction burden exceeds a threshold
(their guess: 10–15 h/week), freeze new agent autonomy. Worth having as an explicit,
measured, written-down rule rather than a vibe. Lands at **L13**.

**Mandatory provenance tuple.** Every externally-sourced field carries
`source, as_of, confidence, last_verified_by`, and an AI brief that cannot show them must
refuse to make the claim. I had provenance in the assertion table; v3's contribution is
making it a *display and refusal* rule, not just a storage one. Lands at **L2**.

**Wrong-wrap policy as a matrix.** `Vehicle × Instrument → allowed material scopes`,
checked at send time, with `wrong-wrap sends = 0` as a hard KPI. Cleaner than a rule list.
Lands at **L12**.

**No-unsolicited grant gate.** A flag that blocks outreach on the grants rail until a funder
invitation exists — encoding "sourced, not applied for" as a state machine guard rather than
a paragraph in report 02. Lands at **L13** with the grants rail.

**The feedback triage SLA ladder.** P0 same business day / fix in 1–2 days; P1 one business
day / one week; P2 two business days / next slice; P3 weekly triage. Goes straight into the
issue frontmatter at **L1** as a `priority` field with those definitions in the README.

### 1.2 From v4: epistemic discipline

**The consent ladder.** Six states that must never be conflated: *connector willingness →
target opt-in → meeting held → interest/indication → accepted commitment → cash received.*
This is the single most valuable thing in v4 and it composes perfectly with v3's soft/hard
split — the ladder is the *qualitative* version of the same refusal to round up.

The concrete failure it prevents: a connector replying "happy to ask" becomes, three hops
of summarisation later, "target is interested." I'm making it an enum on the relationship
state with no implicit transitions — every step up requires a specific evidence record, and
the UI renders the ladder as a stepper so the gap between claimed and evidenced state is
visible rather than inferred. Lands at **L5**.

**Coverage disclosure.** Every search result states which corpus and date range were
inspected, and distinguishes *"no supported route in the supplied material"* from
*"no route exists."* My route planner would have returned an empty list, which reads as the
second while only justifying the first. Lands at **L4**.

**Per-hop evidence rules with named failure modes.** Co-attendance, shared affiliation and
a public social connection are *discovery clues, not proof*. The route planner must refuse
to let proximity evidence upgrade into a relationship claim. This is v3's A–D tiers given
actual content — v3 said "tier it," v4 said what the tiers mean. Lands at **L4**.

**The non-circumvention rule.** A decline or do-not-approach instruction changes the plan;
the system must not respond by quietly substituting a different connector toward the same
prohibited approach. This is a genuinely subtle agent failure mode and neither my plan nor
v3 caught it. Implemented as a restriction record on the *target*, checked by the route
planner on every candidate path, not a note on one edge. Lands at **L4**.

**The work envelope as the authorization unit for agent runs.** Every run gets
`{task, scope, allowed_evidence, allowed_commands, budget, deadline, output_schema,
acceptance_criteria, escalation_owner}`, a policy check validates each tool call against it,
and **delegation cannot increase permission — a child task receives the same or narrower
scope**. This is better than the ad hoc per-agent tool lists I had, and it is a cleaner cut
than the connector contract because it scopes a *run* rather than a *data source*. The two
are orthogonal and I want both. Lands at **L13**.

**Run records pin their resolved config and input hashes.** Editing a prompt file must not
retroactively change what a completed run meant. Cheap to build, and it is the difference
between an agent log you can audit and one you can only read. Lands at **L13**.

**Prompt regression evals against protected example cases**, with the guardrail that the
agent cannot modify its own pass criteria or runtime permissions to win, and the honest
caveat that repeated selection against a fixed set overfits, so real failures must keep
getting added. This is the "autoresearch improvement loop" you asked for in the original
brief, specified properly for the first time. Lands at **L13**.

**The worked example as an eval suite.** v4's `target-pursuit` fixture set is the best piece
of craft in either package: numbered source documents (S01–S11) of deliberately varying
evidentiary strength — including one with an explicit do-not-contact restriction and one
coattendance-only lead — plus a **"Properties to check"** section that functions as inline
assertions and a **"Useful variations"** section (*remove S04 → no supported route*;
*add a target-wide do-not-contact*; *swap the mandate to a project grant*) that is a
declarative perturbation spec with no harness. I'm copying this format outright for L5's
seed data. It makes the target workspace testable on day one and gives you something
real to click through before any connector exists.

**Canonical asset plus audience variants with staleness propagation.** One source-linked
asset with variants (LP memo, grant framing, public primer, seminar outline, posts, video
script), each carrying `parent_artifact, claim_ids, audience, permitted_use, version, owner`
— and **changing a claim in the canonical asset marks its derivatives for refresh**. My
materials ledger tracked versions and staleness by date; lineage-driven invalidation is
materially better, because the thing that makes a deck wrong is usually a changed fact, not
elapsed time. Lands at **L12**.

**Conserved shared capital pool as a modeled invariant.** The sum of fund and SPV amounts
stays within one budget; an unverified grant budget is excluded. Given that Neurotech,
Rails and the SPVs compete for an overlapping LP universe, a scenario engine that lets the
same dollar appear in two vehicles is worse than no scenario engine. Deterministic check in
code; the agent may propose assumptions but never does the arithmetic. New module 21,
lands at **L6**.

**Ephemeral read cache versus run input snapshot, named by why the copy exists.** A *cache*
exists for latency and quota and has no persistence guarantee; a *snapshot* exists to
explain a historical output and is explicitly not today's truth. My landing tables collapse
both into "raw JSON we keep." Keeping them separate — and labelling the snapshot as
non-authoritative in the UI — prevents someone reading a six-week-old snapshot as the
current CRM state. Lands at **L2**.

**Idempotent acceptance keys.** A stable key per proposed task so a double click cannot
create duplicates. Small, obvious in hindsight, and exactly the kind of thing that erodes
trust in an agent's output queue on week three. Lands at **L13**.

**"A module is a capability, not necessarily a screen."** v4's strongest architectural
argument: a module can begin as a playbook plus an output format, and a dedicated screen is
a later optimization rather than the prerequisite for offering the capability. Twenty-four
screens is a lot of surface to ship before anything is proven. I'm adopting the principle —
several modules below launch as a playbook against the shared workspace and earn their own
screen only when a workflow demonstrably needs one.

**A promotion rule for schema.** v4 stores nearly everything as generic `items` rows with a
`kind` and a markdown body, and promotes a concept into real columns only "when users
repeatedly need to filter it, a mistake recurs, a tool needs a precise input, or performance
becomes a demonstrated problem." I'm not adopting their schema — see §2 — but I am adopting
the **rule**, applied to a `note` table that sits alongside the typed schema. Anything not
yet worth a migration lives there. Lands at **L2**.

### 1.3 From v4: the frontend contract

You said you like my visual style plus their console feel. These are the specifics worth
taking, all of which are structural rather than decorative:

**Four umbrella sections, not twenty-four nav items.** v4's module explorer groups into
Discover & qualify / Convert & learn / Create & substantiate / Execute & coordinate, with
the rule that *module capabilities appear in context rather than as competing navigation
items*. I'm adopting the grouping wholesale (with my own section names and contents) and
the persistent left rail that carries it.

**Plain-language status vocabulary, never a numeric confidence rendered as fact.**
"Agent working," "Ready for review," "Waiting on counterpart," "Needs evidence,"
"Verified by administrator," "Source unavailable." Every label must carry its meaning
without colour — which my palette work already required, so these compose cleanly.

**"Approve" authorizes a specific bounded action, never an opaque bundle** — and agent-run
success, task acceptance, investor approval, legal close and cash receipt **must never share
one green check**. That last rule is the visual counterpart of the consent ladder, and it is
the single most likely place for this system to lie to you by accident.

**Optimistic updates only for reversible presentation choices.** Consequential commands wait
for a server receipt. Live data shows a visible last-sync time; staleness is never silently
rendered as freshness.

**The state inventory to design and test**, quoted because I would otherwise have built half
of it: empty campaigns, loading sources, failed sync, expired permission, stale evidence,
conflicting edits, unavailable owner, paused mission, exhausted budget, rejected claim,
revoked authorization, ambiguous external execution. Each must explain *what is known, who
can act, and the safe next step*.

**Every canvas needs a list equivalent.** The route planner's graph view must have a
keyboard-navigable path list that carries the same information — not a degraded fallback,
an equal presentation. This also happens to be the better view on a phone.

**Two components worth stealing by name:** `EvidenceRef`, a reusable inline source pointer
used everywhere a claim is made, and `AudienceVariants`, a side-by-side variant switcher for
one canonical asset. Both encode a discipline into a component, which is the only way a
discipline survives contact with a deadline.

---

## Part 2 — What I'm refusing

**v4's four generic tables** (`spaces`, `items`, `runs`, `feedback`, everything as a markdown
body). This is a good shape for a notes app and the wrong shape for this. Coverage ratios,
exposure math, the conserved capital pool, ask-load caps and the soft/hard split are all
*arithmetic over typed records*. Schema-on-read means every one of those becomes a parse,
and the first time a number is wrong you will not be able to tell whether the math or the
parse failed. I'm keeping the typed schema and taking only their promotion rule plus a
`note` table for the genuinely unstructured residue.

**v4's disposable in-memory relationship graph.** They rebuild adjacency per search and
throw it away, with no persistent relationship storage. But connector ask-load, goodwill
decay, the A–D evidence tiers and the non-circumvention rule *all* require relationship
state that outlives a single query. Their own harvested features contradict this choice.
I keep the assertion table. Their defensible point, which I accept, is narrower: I don't
need a graph *database*. Recursive CTEs in Postgres handle two- and three-hop enumeration
at this scale without a second system.

**v3's three-architectures-then-hedge.** `12-system-architecture.md` proposes Hub+Spokes,
Modular Monolith Kernel and Agent Mesh, then "synthesizes" as *primary = Arch 2 + Arch 1
adapters + selective Arch 3*, which is not a decision. No entity-relationship diagram or
field-level schema appears anywhere in the package; entities are named, never specified.
I'm keeping the two-plane modular monolith and the actual SQL.

**v3's deferral of scoring to second-to-last.** Their bet is that a team under EOY pressure
needs the daily queue and guardrails trustworthy before it needs targeting intelligence.
It is a real argument and I'm taking *half* of it: the Today HUD and the sprint calendar
move earlier (L7), because those are cheap. But selection and conversion strategy stay at
L4–L5, because with 30M to raise and a fixed LP universe, *who to call* is not a
second-order question — and unlike the HUD, it is the part you cannot do well in a
spreadsheet while you wait.

**v3's operational constants.** 12–20 decision-grade meetings a week, a 60–70% principal
time floor, 1–5 asks per connector, a 10–15 h/week correction budget. The package labels
all four `[Analysis]`, meaning unverified. I'm keeping the *mechanisms* and putting every
constant in `config/deployment.ts` with a comment saying it is a guess. None of them should
survive contact with two weeks of your actual data.

**v4's single storage tier.** One SQLite file with prose-level privacy discipline in prompts
("keep private relationship notes out of public search queries") is not a boundary. The
research/confidential split stays, enforced by grants and schema separation.

**v4's absent compliance story.** Across twenty modules and six architecture documents there
is no accredited-investor handling, no jurisdictional restriction, no solicitation record.
For 506(c) vehicles that is not a simplification, it is a hole. Module 24 stays, and v3's
claims-and-solicitation registry gets folded into it.

---

## Part 3 — The revised module map

Four sections, twenty-four modules. Section names and grouping follow v4's structure;
contents are mine plus the harvest. **Bold** = new since r2.

### Discover & qualify — 01–06

| # | Module | Core mechanic |
|---|---|---|
| 01 | Research & enrichment | Universe assembly; provenance tuple on every field; refusal to claim without one |
| 02 | Segmentation | Rule-built audiences from explicit criteria, not clustering |
| 03 | Selection & recommendations | The capacity/affinity/propensity rubric, with weights visible and editable |
| 04 | Conversion strategy | The per-target workspace; **consent ladder**; **coverage disclosure** |
| 05 | Warm intro routes | Route ranking by connector credibility; **A–D evidence tiers, HITL on C/D**; **per-hop evidence rules**; **non-circumvention**; **connector ask-load cap** |
| 06 | Signals | External change detection on fixtures first, connectors later |

### Convert & coordinate — 07–12

| # | Module | Core mechanic |
|---|---|---|
| 07 | Ask coordination & **conflict adjudication** | One owner per relationship; frequency guard; **ConflictCase with winner/loser/reason and a dated loser follow-up** |
| 08 | **Soft→Hard cockpit** | Two separate tracks; `convertible soft = Σ soft × P(commit)` kept off the headline; conversion rate by cohort |
| 09 | Vehicle status & history | Per-vehicle pipeline, velocity, bottleneck change over time |
| 10 | Decision room | Diligence questions, objections, conditions, evidence, decision timeline |
| 11 | Meetings & follow-through | Prep brief, objection tagging, **the consent-ladder step that a reply actually justifies** |
| 12 | LP-fit audit | Per-vehicle legibility gaps: what makes this hard to evaluate |

### Create & substantiate — 13–17

| # | Module | Core mechanic |
|---|---|---|
| 13 | **Content calendar** | Audience-coverage gap analysis as backlog generator: which recurring target question has no asset |
| 14 | **Content studio** | **Canonical asset + audience variants; a changed claim invalidates derivatives** |
| 15 | Content performance | Attribution honest about its limits; views ≠ commitment stated in the UI |
| 16 | Materials & send gate | **`SEND` approval ticket**; **wrong-wrap matrix (Vehicle × Instrument → allowed scopes)**; staleness |
| 17 | Evidence & answer library | Approved answers with their own versioning and approval state, separate from source docs |

### Execute & govern — 18–24

| # | Module | Core mechanic |
|---|---|---|
| 18 | Close room | Fund-cycle close: subscription pack, conditions, committee clock |
| 19 | **SPV war room** | `invite → IOI → allocate → wire`; **days-to-wire** headline; bandwidth-steal alert |
| 20 | Grants rail | **No-unsolicited gate** until a funder invitation exists; funder clocks |
| 21 | **Forecast & scenarios** | **Conserved capital pool invariant**; hard-only headline; code does the arithmetic |
| 22 | **Sprint calendar** | Holiday overlay; the post-23-December dead zone suppresses urgency |
| 23 | Team capacity | Role × vehicle slots; principal-time floor alert |
| 24 | Approvals & compliance | **Ticket queue for all five kinds**; **claims & solicitation registry**; side-letter risk |

Plus, always present in the shell: **Today** (the HUD), the **approvals badge**, the
**feedback drawer**, and **Learning & agent quality** (win-loss plus the prompt regression
harness) in settings.

Several of these launch as a playbook against the shared workspace rather than a dedicated
screen — 02, 06, 12, 13, 17 and 23 in particular. They earn a screen when a workflow proves
it needs one.

---

## Part 4 — The revised build sequence

| | Stage | Days | What lands |
|---|---|---|---|
| **L1** | Shell + feedback | 4 | Console shell (rail, four sections, inspector), PGlite, user switcher, feedback box, markdown issues with **P0–P3 SLA ladder**, issues page, seed data |
| **L2** | Entities + provenance | 4 | Typed schema, surrogate IDs, assertion table, **provenance tuple**, **cache vs snapshot split**, **`note` table + promotion rule** |
| **L3** | Asks, tickets, conflicts | 5 | Ask log, frequency guard, **five approval-ticket kinds as pre-mutation gates**, **ConflictCase with dated loser follow-up**, audit log |
| **L4** | Network + routing | 5 | Relationship graph, route ranking, **A–D tiers with HITL on C/D**, **per-hop evidence rules**, **coverage disclosure**, **non-circumvention**, **connector ask-load cap**, list-equivalent view |
| **L5** | Target workspace | 5 | The seven-step target flow, **consent ladder as a stepper**, **the S01–S11 fixture set with properties-to-check and useful-variations** |
| **L6** | Vehicles + soft/hard | 5 | Exposure, coverage, **Soft→Hard cockpit**, **conserved capital pool**, forecast with a hard-only headline |
| **L7** | Today + sprint calendar | 2 | The daily HUD, **holiday overlay**, dead-zone urgency suppression |
| **L8** | Close + SPV | 4 | Fund close room, **SPV war room with days-to-wire** |
| | *— Core subtotal —* | **34** | |
| **L9** | Scoring | 4 | The capacity/affinity/propensity rubric with visible weights |
| **L10** | Signals | 4 | Fixture-driven signal model and thresholds |
| **L11** | Meetings + decision room | 3 | Prep briefs, objection taxonomy, evidence gaps |
| **L12** | Materials | 4 | **Canonical + variants with lineage invalidation**, **wrong-wrap matrix**, send gate |
| **L13** | Agents | 4 | **Work envelope**, **run config/input pinning**, **regression harness**, **idempotent acceptance keys**, **trust circuit breaker**, no-unsolicited gate |
| | *— Depth subtotal —* | **19** | |
| | **Total** | **53** | |

**The honest accounting: the harvest added eleven days to a forty-two-day plan.** Most of it
is in L3 (+2, tickets and conflicts), L4 (+1, the evidence discipline), L12 (+2, lineage
invalidation) and L13 (+1, envelopes and pinning), plus the two wholly new days at L7.

If that is too much, the trim I'd make — in this order — is L10 signals (fixture-only work
that gets redone once connectors exist), then L9 scoring (a spreadsheet does this adequately
for one person), then L13 down to a stub. That recovers eleven days and lands you back at
the original forty-two with the governance and epistemics kept. I would not trim L3 or L4;
those are where both alternate packages independently found my plan thin, which is about as
strong a signal as this exercise can produce.

**The tension from r2 still stands, and the harvest sharpens it.** The L-series makes *you*
productive. The December close needs *seven people*, and seven people cannot all run
`npm run dev`. With the sprint calendar now in the plan, the arithmetic is stark: if L1
starts Monday, Core finishes around the second week of November, which leaves roughly five
working weeks before the December dead zone. D0/D1 should start in parallel the moment L5
ships, not after L8.

---

## Part 5 — Frontend direction

Mine visually, theirs structurally. The warm paper ground (`#F5F3EE`), clay accent
(`#BF4A16`), Fraunces for display and IBM Plex for everything else — all unchanged. What
changes is the chrome: a persistent left rail carrying the four sections, a breadcrumb and
context bar, a KPI strip, and a right-hand inspector that opens on selection.

Three boards accompany this document, built to show the synthesis rather than describe it:
the shell with Today, the target workspace with the consent ladder, and the approvals queue
with a live conflict case.

---

## Part 6 — Open questions, unchanged

The harvest did not answer any of these, which is worth noting on its own.

1. **Affinity plan tier** — Data Share versus poll-first. Neither alternate package resolves
   this; v4 defers connectors entirely and v3 describes Affinity ingestion two different ways
   in two different files.
2. **Warehouse access** — own schema with write permission for canon tables?
3. **Linear custom fields** — still UNVERIFIED in all three packages. Check the live GraphQL
   schema before anything depends on it.
4. **Integration risk** — one 506(b) SPV among four 506(c) vehicles. A conversation for
   counsel. v4 has no compliance model at all and v3 names three compliance modules that
   share no schema, so neither offers help here.
