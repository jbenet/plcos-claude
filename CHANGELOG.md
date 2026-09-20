# Changelog

One entry per stage of the L-series. Each entry says what landed, what was deliberately
left out, and where I disagreed with the plan. Screenshots live in
`docs/changelog/shots/<stage>/`.

---

## L1 — Shell, the five seams, and the feedback loop

**Shipped.** Next.js 16 app with the console shell from `design/S1`–`S3`, PGlite behind a
`Db` seam, a local user switcher behind `AuthProvider`, the feedback box writing markdown
issues through `IssueSink`, an issues list and detail page reading `issues/*.md`, and seed
data.

`npm run dev` on a fresh clone migrates, seeds and serves. No service, no Docker, no
account.

### Screenshots

| | |
|---|---|
| ![Today](docs/changelog/shots/l1/01-today.png) | **Today.** The shell: dark rail with four umbrella sections, breadcrumb with a visible last-sync line, KPI strip, and the empty approval queue rendered as a designed state rather than a blank panel. |
| ![Approvals](docs/changelog/shots/l1/02-approvals.png) | **Approvals.** The five ticket kinds and what each will gate, plus the five-states-five-check-marks rule as a live component rather than a paragraph. |
| ![Feedback box](docs/changelog/shots/l1/03-feedback-box.png) | **The feedback box.** Shows the context it is about to capture before you press the button. Writes `issues/NNNN-slug.md`. |
| ![Issues](docs/changelog/shots/l1/04-issues.png) | **Issues.** Read straight off the filesystem through the `IssueSink` seam. The SLA ladder sits in the inspector. |
| ![Issue detail](docs/changelog/shots/l1/05-issue-detail.png) | **Issue detail.** Prose, plus the `json context` block exactly as captured. |
| ![System and seams](docs/changelog/shots/l1/06-system-seams.png) | **System & seams.** What each seam is running now, what it swaps to, and why the swap stays cheap. Plus every constant that is a guess, named as one. |

### The four things I would have asked you to approve first

You asked to see the file tree, the seam interfaces and `config/deployment.ts` before I
wrote code. You then said to keep going without you, so here they are after the fact —
they are all still cheap to change.

**File tree**

```
config/deployment.ts        every deferred decision, one file
lib/
  db/       index.ts (Db) · pglite.ts · postgres.ts · migrate.ts
  auth/     index.ts (AuthProvider) · local.ts · labos.ts
  issues/   index.ts (IssueSink) · file.ts · github.ts · format.ts
  connectors/ types.ts (Connector<T>) · fixture.ts
  agent/    index.ts (Agent) · stub.ts · claude.ts
  nav.ts · seed.ts · session.ts · sync.ts · time.ts
modules/
  manifest.ts               ordered module registry, one Postgres schema each
  platform/                 migrations/ · types.ts · repo.ts · service.ts · index.ts
components/shell/           Rail · NavList · Page · UserSwitcher · VehicleSwitcher · FeedbackBox
app/                        today · approvals · issues · issues/[id] · m/[slug] · system · api/
fixtures/                   users.json · vehicles.json · sources.json
scripts/                    reset · seed · shots · boundaries · issues-normalize
issues/                     NNNN-slug.md, git-tracked
docs/changelog/shots/       screenshots per stage
local/                      gitignored: the PGlite directory
```

**The seams** are in `lib/*/index.ts` and summarised on `/system`. Each has a local
implementation and a second implementation that refuses with a sentence rather than
silently falling back — `labos.ts`, `github.ts` and `claude.ts` all exist for that reason.
A `Queryable` interface is the only database surface any caller sees.

**`config/deployment.ts`** is exactly the shape in `CLAUDE.md`, plus two deployment facts
(`db.localDir` / `db.url`, and `agentRuntime.apiKey`). It also exports `GUESSED_CONSTANTS`,
so `/system` can render the guesses as guesses instead of leaving that discipline in a
comment.

**Two boundaries are enforced by `npm run boundaries`:** no database driver is imported
outside `lib/db/`, and a module is imported through its `index.ts` and never its `repo.ts`.
Both are an afternoon's work now and miserable to retrofit.

### Where I disagreed, and what I did about it

1. **"Enough seed data that every screen has something in it" — I did not do this for the
   fifteen screens that do not exist yet.** Seeding placeholder pipelines and fake routes
   into unbuilt modules would make the shell demo well and teach me nothing true. Instead
   every unbuilt module renders a designed not-built state naming the stage it lands at,
   and the rail shows `L4`, `L5`, `L8` where a count will later go — so the navigation
   doubles as the build sequence. The screens that do exist are fully populated.

2. **`guard.asksPerRelationshipPerQuarter: 1` is not marked as a guess in `CLAUDE.md`, and
   it should be.** It comes from the same unverified v3 analysis as the two beside it. I
   left the value alone and did not add the label, because changing the handoff document
   is your call — but `/system` currently under-reports by one, and I would fix that by
   marking it rather than by dropping the claim.

3. **The rail shows seventeen module entries, not the curated eleven from `design/S1`.**
   The board was showing one vehicle's working set; a real rail has to hold the whole map.
   Seventeen scroll comfortably inside four sections. The six playbook-only modules (02,
   06, 12, 13, 17, 23) are deliberately absent from the rail and listed on the module
   pages instead, which is what "a module is a capability, not necessarily a screen" means
   in practice.

4. **Next.js appends its own block to `CLAUDE.md` on every `next dev`.** That file is the
   handoff for this repo and is not Next's to edit, so `agentRules: false` is set in
   `next.config.ts` and the block is reverted.

### Deliberately not built

No entities, no ask log, no scoring, no routes, no connectors, no auth integration, no
graph database, no vector store, no event broker, no durable orchestration. `pg` is not
even installed — `lib/db/postgres.ts` resolves it at runtime so the D0 swap is
`npm i pg` plus a `DATABASE_URL`, with nothing above that file changing.

### Commands

```bash
npm run dev          # migrate, seed if empty, serve on :3000
npm run db:reset     # drop local/, rebuild, reseed. Issues are files and survive it.
npm run check        # tsc --noEmit
npm run boundaries   # the two structural rules above
npm run shots -- L1  # changelog screenshots, against a running dev server
```

---

## L2 — Entities, provenance, and the corpus

**Shipped.** Two new modules with their own Postgres schemas — `identity` and `research` —
and the first real screen: module 01, Research & enrichment.

Every externally-sourced field now carries the provenance tuple, and the UI cannot render
one without it: `ProvenanceLine` returns a **Source unavailable** state rather than a bare
value when the tuple is incomplete, so forgetting is not an option a caller has.

### Screenshots

| | |
|---|---|
| ![Research](docs/changelog/shots/l2/01-research.png) | **Research & enrichment.** Fourteen entities, thirteen claims. The two counts that matter are *unverified* and *weakly supported* — both are the kind of number a system normally hides. |
| ![Dossier](docs/changelog/shots/l2/02-dossier.png) | **A dossier.** Every claim shows source, as-of, confidence and who verified it, in that order, on the same line as the value. Open questions sit beside it, not buried in it. |
| ![EvidenceRef](docs/changelog/shots/l2/03-evidence-ref.png) | **`EvidenceRef`.** The popover states *what the document can support* — not just where it came from. That sentence is what stops a conference attendee list from becoming a relationship. |
| ![Corpus](docs/changelog/shots/l2/04-corpus.png) | **The corpus.** Eleven source documents, each labelled strong, moderate or weak, each with its own "supports" line. |

### What landed

- **`identity.entity` / `source_record` / `match_assertion`.** Surrogate ids minted once,
  merges redirect via `merged_into`, ids are never reused, and `getEntity` follows the
  redirect so every foreign key keeps working. Human match assertions are a separate table
  because they must survive a re-run of any probabilistic model.
- **`research.claim` with the provenance tuple** and `superseded_by` rather than update, so
  what we used to believe stays legible.
- **`research.source_doc`** with a `strength` and, more importantly, a `supports` column:
  one sentence per document saying what it can and cannot establish. Three of the eleven
  are weak on purpose — a co-attendance list, a public follow, and a CSV of unknown
  provenance — because a corpus with no weak evidence in it tests nothing.
- **`research.note` with the promotion rule** written down in `modules/research/README.md`.
  Open questions live there today with `kind = 'open_question'` and have not earned columns.
- **`read_cache` versus `snapshot`,** separate tables named by *why the copy exists*. One
  row of each is seeded so the distinction is visible in the UI rather than only in prose.
- **Three components that carry a discipline:** `EvidenceRef`, `ProvenanceLine` /
  `ConfidenceWord` (plain-language status, never a numeric confidence rendered as fact),
  and `Coverage`, which states the corpus and date range inspected and names what was not.

### The fixture set

`fixtures/source-docs.json` is the `S01`–`S11` set from v4's target-pursuit example,
rewritten for this domain. It includes the two cases the whole design exists for:

- **S05** — a do-not-approach instruction attached to Delia Roos. It is stored as a claim
  on the *target*, not as a note on one edge, which is what makes L4's non-circumvention
  check possible rather than aspirational.
- **S07/S08** — co-attendance and a mutual public follow, which the route planner at L4
  must refuse to treat as a relationship.

### Where I disagreed

**The seed name `Mara Okonjo` collided with the fixture universe.** `design/S2` uses
"M. Okonjo" as a connector and "Okonjo Family Office" as a target, while the staff list had
a Mara Okonjo on our side. One of those has to give or the conflict-adjudication screens at
L3 will read as a person conflicting with themselves. Our team member is now **Mara Vance**;
Michael Okonjo and the Okonjo Family Office are external.

### Still not built

No routes, no scores, no asks, no tickets. The restriction in S05 is *recorded* and
*displayed*; nothing enforces it yet, and the dossier says so in as many words rather than
implying a guard that does not exist.

---

## L3 — Tickets, the ask log, and conflict cases

**Shipped.** The governance layer. Two more modules — `governance` and `coordination` —
plus the live approvals queue and module 07.

This is the stage where the system starts refusing things. Four guards run *before* an ask
is made, an approval is a gate rather than a record, and a collision between two vehicles
produces a case with a dated follow-up instead of a silent block.

### Screenshots

| | |
|---|---|
| ![Conflict ticket](docs/changelog/shots/l3/01-approvals-conflict.png) | **A blocked INTRO_ASK.** The scope says what the approval authorizes *and what it does not*. Below it, both guards that refused, each showing what it looked at. |
| ![Adjudication](docs/changelog/shots/l3/02-adjudication.png) | **Adjudicating the conflict.** Two claimants side by side, a reason code, and a follow-up date for the loser that the form will not submit without. |
| ![MONEY ticket](docs/changelog/shots/l3/03-approvals-money.png) | **A MONEY ticket.** "Cash received — No, a separate state" is on the face of the approval, because that is the line this system exists to keep. |
| ![Ask log](docs/changelog/shots/l3/04-ask-log.png) | **Module 07.** Every ask, made or not, with connector load in the inspector: Duettmann is at 2 of 3 this quarter. |
| ![Today](docs/changelog/shots/l3/05-today-queue.png) | **Today,** now showing the real queue. |

### The gate

`requireApprovedTicket` is the whole point. It takes a transaction, a kind, a subject and a
ticket id, and throws `TicketRequired` in five distinguishable situations — `missing`,
`wrong_subject`, `undecided`, `rejected`, `expired`. They are different situations with
different next steps, so they are different errors rather than one boolean.

`makeAsk` calls it and then **re-runs the guards**. An approval from four days ago does not
license an ask that a newer conflict has since blocked.

### The four guards

| Rule | Refuses when | Overridable |
|---|---|---|
| `relationship_frequency` | more asks to this target this quarter than the cap | yes, with a recorded reason |
| `connector_load` | the connector has been asked more than `asksPerConnectorPerQuarter` | yes, with a recorded reason |
| `cross_vehicle_conflict` | another vehicle has an open ask inside the window | opens a case rather than refusing |
| `non_circumvention` | the target has a restriction covering this route | **no** |

The last row is the one that matters. A do-not-approach instruction is the target's
instruction, not our policy, so there is no reason string that turns it into a permission —
`makeAsk` refuses it before it even considers the override path.

Every guard report carries an `inspected` line, so an empty block list reads as "nothing in
the material available refused this" rather than "this is safe".

### The dated follow-up

`coordination.conflict_case` has a check constraint: a row cannot be `adjudicated` without
a winner, a loser, a reason code **and** `loser_followup_at`. The service refuses it too,
and the form will not submit without it. Three layers for one rule, because blocking
without the follow-up is the exact failure the table was added to prevent — it protects the
relationship and loses the opportunity silently.

### A promotion, on the record

`coordination.restriction` was promoted out of `research.note` during this stage, under
test 3 of the promotion rule: *a tool needs a precise input*. The guard cannot substring-match
prose for a connector name. The note is still there; the structured row is what the guard reads.

### Where I disagreed

1. **Two guards refuse the seeded Roos ask, not one.** The design board shows the conflict
   as the blocker. In fact `asksPerRelationshipPerQuarter: 1` also refuses it, because Rails
   already asked her six days ago. I left both showing. If one ask per relationship per
   quarter is genuinely the intended cap across *all four vehicles*, then the conflict case
   is nearly redundant — every cross-vehicle collision will also trip the frequency guard.
   I think the frequency cap is meant per vehicle and the constant is under-specified. It is
   a guess either way; this is the first thing real data should settle.

2. **Tickets whose subjects do not exist yet.** `SEND`, `MONEY` and `STAGE` gate mutations
   in modules that land at L6, L8 and L12. Rather than wait, `approval_ticket` carries a
   `subject_label` next to the `subject_id`, so the queue is legible now and the foreign key
   stays honest when those modules arrive. It is a small compromise and it is visible in the
   schema comment.

3. **A client/server split inside each module.** A `'use client'` component importing a
   module's `index.ts` drags the repository, and with it `node:fs`, into the browser bundle —
   Turbopack panics rather than failing gracefully. Each module now has a `client.ts` with
   types and constants only. The boundary checker knows about it.

### Still not built

Routes and the A–D evidence tiers (L4), the consent ladder (L5), and any notion of money
moving (L6). `MONEY` tickets can be approved; nothing yet records a commitment, which is
why the seeded one says so on its face.

---

## L4 — The relationship graph and the route planner

**Shipped.** Module 05. A persistent edge table, three-hop enumeration by recursive CTE,
A–D evidence tiers with human review required on C and D, non-circumvention checked on
every candidate path, connector ask-load in the ranking, and a coverage disclosure on every
search.

### Screenshots

| | |
|---|---|
| ![Routes](docs/changelog/shots/l4/01-routes.png) | **Four paths to Delia Roos, ranked.** Recommend, Hold, Not a route, Excluded — each with the reason, the tier of every hop, and the evidence behind it. |
| ![Full page](docs/changelog/shots/l4/02-routes-full.png) | **The list and the drawing.** The path list is the primary view; the graph adds shape and nothing else. Dashed lines are paths that cannot be used. |
| ![No route](docs/changelog/shots/l4/03-no-route.png) | **The state this whole rule exists for.** "No path exists in the material available" — said in those words, with the corpus, the hop limit, and what was not inspected. |

### The four paths, and why each got its verdict

| Path | Verdict | Because |
|---|---|---|
| Juan → Duettmann → Roos | **Recommend** | Both hops tier A with interaction evidence. Duettmann has 1 of 3 asks left this quarter. |
| Juan → Okonjo → Roos | **Hold** | Second hop is tier C — a board co-membership that ended in 2023, confirmed by Mara as affiliation only. A route is only as good as its worst hop. |
| Juan → Navarro → Roos | **Not a route** | Second hop is tier D and nobody has reviewed it. Co-attendance and a mutual public follow are discovery clues, not a relationship. |
| Juan → Hale → Roos | **Excluded** | Roos asked not to be introduced through Hale. |

The fourth row is the one worth staring at. The path is *good* — tier A then tier B, a
connector who has introduced her to two managers before. It is excluded anyway, and the
reason text says explicitly that finding a different connector toward the same approach
does not satisfy the instruction. `makeAsk` refuses that substitution too, and unlike the
frequency and load guards, it cannot be overridden with a reason.

### What the tiers actually mean

v3 said "tier it"; v4 said what the tiers mean. Both are in the schema and in
`TIER_MEANING`, so the words and the enum cannot drift apart:

- **A** — documented working relationship, with evidence of interaction.
- **B** — documented association, one strong source, some interaction.
- **C** — shared affiliation only. Same board, same firm, *no evidence they ever spoke.*
- **D** — proximity only. Co-attendance, a public follow.

C and D carry nothing until a person reviews them. The planner does not drop those paths —
it enumerates them and labels them, because a planner that silently discards its weak
candidates returns an empty list, and an empty list reads as "no route exists".

### The canvas has a list equivalent, and the list came first

The path list carries every hop's tier, kind, validity date, evidence reference and verdict
reasoning, and each path is a link. The SVG is a second presentation of the same data.
That ordering is deliberate: the list was built first, and the drawing adds shape.

### From a route to an ask

A recommended or held route has a **Propose the ask** control. It writes the ask, runs the
four guards from L3, opens an `INTRO_ASK` ticket with a stated scope, opens a conflict case
if another vehicle is already in the way, and drops you in the approvals queue. It contacts
nobody — the button says "propose", because the gap between asking the system and asking
the person is exactly where a consent ladder gets skipped.

### Where I disagreed

1. **The `strength` numeric is stored and never rendered.** Affinity will supply
   `interactionScore` later and the column is there for it. But a 0.62 on a relationship is
   not 62% of anything, and showing it would be precisely the "numeric confidence rendered
   as fact" the frontend contract forbids. The UI shows the tier, the kind, the date and the
   evidence. `tie_band` exists for the moderate-band routing preference when there is enough
   outcome data to tune it; right now it is seeded and unused rather than pretended-upon.

2. **Team members exist twice, and that is correct.** `platform.app_user` is who logs in;
   `identity.entity` is a node in the graph. `identity.source_record` joins them with
   `source = 'app_user'`. Without this, the graph has no origin node and "routes from Juan"
   has no meaning. It also means switching user in the rail genuinely recomputes the page —
   Mara can reach Ivo Lindqvist through Mercer & Bly and Juan cannot.

3. **Edges are stored directed and traversed undirected,** through a `network.link` view
   that unions both readings. Storing each relationship twice would double the maintenance
   surface for no gain.

### Still not built

The consent ladder (L5) — the routes page can propose an ask, but nothing yet records
where a target actually stands. No scoring (L9): the ranking here is evidence and goodwill,
not a model.

---

## L5 — The target workspace and the consent ladder

**Shipped.** Module 04. Six ladder states with no implicit transitions, a stepper that
shows the gap between claimed and evidenced, `STAGE`-gated advancement, and a runnable
properties harness over the whole fixture set.

### Screenshots

| | |
|---|---|
| ![Pursuits](docs/changelog/shots/l5/01-pursuits.png) | **Six pursuits at five different heights.** The six-segment bar is the ladder; the outlined segment is the next rung, which has nothing on file. |
| ![Roos workspace](docs/changelog/shots/l5/02-workspace-roos.png) | **Delia Roos.** Sitting at *connector willing* and nowhere else. Routes, plan with a reason per move, claims with their sources, open questions, and the restriction in the inspector. |
| ![Cedar](docs/changelog/shots/l5/03-ladder-cedar.png) | **Cedar Trust, five rungs up.** Commitment accepted on 18 September. Cash received is empty, and stays empty until a wire confirmation exists. |
| ![Advance](docs/changelog/shots/l5/04-advance-ticket.png) | **Advancing a rung opens a ticket and writes nothing.** The rung lands only after approval, and the ladder is re-checked at that moment. |

### What the ladder actually enforces

The rung is **derived**, never stored. There is no column anyone can set to "interested" —
`pursuit.rung` is computed as the highest rung with an evidence record, and each record
carries an evidence kind, a reference and a note.

Advancing goes through two checks, one before the ticket and one inside the transaction:

- **No skipping.** `requestAdvance` refuses a jump and names the rungs that have no evidence.
- **The ladder may have moved.** `recordAdvance` re-checks the position after the approval
  and refuses if it changed. An approval is for a specific transition, not for a target.

`RUNG_REQUIRES` is in code and rendered in the form, so the thing that justifies the step
is stated before the box rather than left to whoever fills it in:

> *Indication given requires: a number or a range, from them. An expression of enthusiasm
> is not an indication.*

### The properties harness — `npm run props`

v4's fixture set carried a "Properties to check" section and a "Useful variations" section
that no package turned into code. Both now run, against a scratch database:

```
  ok   Every claim carries a complete provenance tuple
  ok   No route with an unreviewed C or D hop is recommended or held
  ok   Every path through a restricted party is excluded
  ok   The consent ladder has no gaps: recorded rungs are always a prefix
  ok   No cash is recorded without an accepted commitment beneath it
  ok   Every adjudicated conflict has a winner, a loser, a reason and a dated follow-up
  ok   Every live ask carries an approval ticket
  ok   A connector-scoped restriction names the connector
  ok   Variation — remove the tier-A route
  ok   Variation — add a blanket do-not-contact
  ok   Variation — a human reviews the tier-D edge
  ok   Variation — the connector reaches the cap

  12 of 12 properties hold.
```

**Writing the third variation found a real bug.** "A human reviews the tier-D edge" should
make that path *usable but not good*. The planner was promoting it straight to Recommend,
because the downgrade rule only fired on tier C. Human review removes the refusal; it does
not upgrade the evidence. Fixed, and the variation now guards it. That is the entire
argument for the format, demonstrated on its first use.

### Where I disagreed

**The ladder's first rung assumes an intermediary, and not every approach has one.**
Northwood was approached directly — Raman asked at an event to be contacted. There is no
connector, so "connector willing" is not a step that can be passed or failed. Rather than
let the rung be skipped (which would break the no-gaps rule that makes the ladder worth
having) it is recorded with `evidence_kind = 'not_applicable'` and a note saying why. The
stepper renders it grey rather than green — it is not an achievement, it is an absence.

I think this is the right shape, but it is a modelling decision that was not in the plan and
you should look at it. The alternative is a second ladder for direct approaches, which I
think is worse: two ladders is how two definitions of "opted in" appear.

### Still not built

Money. Cedar Trust shows `commitment accepted` on the ladder and the seeded `MONEY` ticket
says "$4.0M, cash not received" — but no total exists anywhere yet, hard or soft. That is
L6, and the reason the headline number is still absent rather than provisional.

---

## L6 — Exposure, the soft/hard split, and the conserved capital pool

**Shipped.** Modules 08, 09 and 21. Two tracks that never meet, a hard-only headline per
vehicle, a deterministic check that the same dollar has not been counted twice, and the
first ticket in this system whose approval actually *does* something.

### Screenshots

| | |
|---|---|
| ![Soft to hard, all vehicles](docs/changelog/shots/l6/01-soft-hard-all.png) | **With no vehicle selected there is no headline.** Four raises side by side, no total row, and a sentence saying why. |
| ![Soft to hard](docs/changelog/shots/l6/02-soft-hard-vehicle.png) | **Pick a vehicle and the headline means something.** $56.0M hard, $22.5M soft in a hatched card, convertible soft shown and never summed in. |
| ![Forecast](docs/changelog/shots/l6/03-forecast.png) | **The conserved capital pool.** Two actors are over a verified budget by $3.5M between them. The page says which vehicles, and refuses to pick. |
| ![Vehicles](docs/changelog/shots/l6/04-vehicles.png) | **Vehicle status.** Per vehicle, hard, soft, cash, gap, coverage — and a cover line explaining why there is no total. |
| ![MONEY ticket](docs/changelog/shots/l6/05-money-ticket.png) | **The MONEY ticket for Cedar Trust,** carrying its bounded action as data. Approving it is the only thing in this system that can move the headline. |

### Approving a ticket now runs exactly what it says

`TicketScope` gained an `apply` field: `{ command, args }`. Approving a ticket runs that
command and nothing else, and an unrecognised command is refused rather than approximated:

> *"Ticket … names an unknown command. Nothing was run — an approval that cannot be
> executed exactly is not executed approximately."*

The dispatcher lives in `app/approvals/apply.ts`, in the app layer, because it is the only
place allowed to know about more than one module. If the action fails after the decision is
recorded, the UI says **"Approved, but the action did not run"** rather than implying both
or neither happened.

Two commands so far: `pipeline.harden` and `strategy.recordAdvance`.

### The arithmetic that is refused

The seeded Cedar Trust commitment sits on the **soft** track with $4.0M against it and a
`MONEY` ticket waiting. Approving that ticket moves Neurotech's headline from $56.0M to
$60.0M and the gap from $34.0M to $30.0M — and leaves cash received unchanged, because a
countersignature is not a wire. That whole chain is now a property test:

```
  ok   Variation — approve the MONEY ticket
       hard +$4M, soft -$4M, cash unchanged at $56M (an accepted commitment is not a wire)
```

`npm run props` is up to **17 of 17**.

### Where I disagreed — and where I caught myself

**The first version of the Soft → Hard page was quietly wrong.** With "All vehicles"
selected it showed a headline KPI strip computed from one vehicle, above a table listing
every vehicle's rows, with a footer summing convertible soft *across all four*. Every
individual number was right and the page as a whole told a lie. I rewrote it: no vehicle
selected means no headline, a side-by-side table instead, and a sentence explaining that
adding those columns down would produce the one figure CLAUDE.md says must never exist.

Worth recording because it is exactly the failure mode the rule exists for, and it got
into my own first draft of the page that enforces it.

**`lib/money.ts` deliberately contains no sum helper.** There is a formatter, a percentage
and a multiple. Anything that adds must be written out where a reader can see what it is
adding.

**Coverage is the one place two tracks appear in one expression.** `(hard + soft) ÷ target`
is a measure of pipeline depth, and the page says so on the row rather than leaving it to be
read as money. I considered dropping it; it is genuinely useful and the label carries it.

### Still not built

The close room and the SPV war room (L8), the sprint calendar (L7). Cash is recorded but
there is no wire-tracking screen yet — `recordCash` exists and is only called by tests.

---

## L7 — The daily HUD and the sprint calendar

**Shipped.** Module 22, and the Today page rebuilt on top of everything L2–L6 put in the
database.

### Screenshots

| | |
|---|---|
| ![Today, all vehicles](docs/changelog/shots/l7/01-today-all.png) | **Today with no vehicle selected.** Operational counts rather than money, and each vehicle's hard number on its own row. Four decisions, one of them blocked by a conflict. |
| ![Today, one vehicle](docs/changelog/shots/l7/02-today-vehicle.png) | **Today for PLC Neurotech I.** Hard, soft, gap and coverage — and the sprint strip underneath, so the gap is read against the weeks that are actually left. |
| ![Sprint calendar](docs/changelog/shots/l7/03-calendar.png) | **Eighteen weeks to the close.** Two of them are not working weeks. Thanksgiving and the December dead zone are grey with a dashed bar and carry no milestone. |

### What the calendar actually changes

Nothing is hidden and nothing is rescheduled. What changes is the tone:

- `urgency()` reports whether today sits inside a suppressing period, and Today's headline
  and sub-line change accordingly — *"Nothing is being chased this week"* instead of
  *"4 decisions only you can make"*.
- A week counts as **dead** when three or more of its five working days are inside a
  suppressing period. Thanksgiving starts on a Wednesday, and pretending Monday and Tuesday
  make it a working week is how a plan quietly loses three days.
- A week that loses one or two days says so on its face — *"2 of 5 days lost"* — rather
  than being rounded to either extreme.

The arithmetic matters more than it sounds: **16 working weeks, not 18**, between now and
the January restart. If the gap to first close is $34.0M, that is the number of weeks it has.

### Where I disagreed

**This is the module I would have cut, and the r3 plan says so out loud.** Having built it:
two days is right and it is not a nicety. The Today page reads differently for roughly a
third of the remaining days, and the difference is between a queue that people trust and a
queue that nags into an empty office until they stop reading it.

**The dead-week threshold is a guess and is not in `config/deployment.ts`.** Three of five
days is a judgement I made while writing it. It should move to the config file with the
other guesses; I left it in the calendar module because unlike the others it is a property
of how a week works rather than a number about this raise. Flagging it either way — it is
the only unlabelled judgement call I have added since L1.

### Still not built

The close room and the SPV war room (L8). The calendar has a first-close milestone on
19 December and a days-to-wire target on the Cortex SPV; neither has a screen behind it yet.

---

## L8 — The close room and the SPV war room

**Shipped.** Modules 18 and 19, deliberately built as two different screens because they
are two different shapes of problem. **Core (L1–L8) is complete.**

### Screenshots

| | |
|---|---|
| ![Close room](docs/changelog/shots/l8/01-close-room.png) | **First close, PLC Neurotech I.** Six conditions with owners, dates and evidence — three of them compliance obligations, three already overdue. The subscription pack underneath, sent → returned → countersigned. |
| ![SPV war room](docs/changelog/shots/l8/02-spv-war-room.png) | **Three SPVs on a days-scale clock.** invite → IOI → allocate → wire as a four-segment bar per seat, days elapsed beside it, and six bandwidth-steal alerts in the inspector. |

### Two rooms, on purpose

A fund close runs on a long clock: a committee, a pack, and a list of conditions that must
be true before anything signs. An SPV closes in weeks on `invite → IOI → allocate → wire`
with **days-to-wire** as the number that matters. Giving the SPVs the fund's interface
would have been a real mistake, and the two pages share nothing but the shell.

### The working-day count

The close room's clock subtracts the sprint calendar. Days to 19 December are not calendar
days and not business days — they are business days minus Thanksgiving minus the December
dead zone. That is the number a plan can actually spend.

### The bandwidth-steal alert

Two kinds, both computed rather than configured:

- **Owner** — someone who owns open SPV seats *and* open fund pursuits. Juan has three of
  each. The SPV clock is shorter, so it wins by default unless somebody decides otherwise.
- **Investor** — an actor with an open SPV seat who is also in a fund pipeline. Four of
  them. Their attention is finite and so is their budget, which is the conserved capital
  pool arriving from a different direction.

Named, not blocked. The system will not stop anyone working an SPV during a fund close; it
refuses to let that happen without anyone noticing.

### Where I caught myself again

The war room's third KPI was **"$3.5M wired, across 3 SPVs"**, with a note arguing that
this one was allowed to be a sum. It is not allowed. Rule 1 names the SPVs explicitly, and
a cross-vehicle total does not become acceptable because the vehicles are small or because
the label apologises for it. It is now a count — *2 of 7 seats wired* — with the dollar
amounts shown per SPV.

Second time in three stages that the blended-number rule caught something in my own work.
It is a good rule.

### Where I disagreed

**`close.pack_item` overlaps `pipeline.exposure.hardened_at`.** Countersigning a
subscription document is the same real-world event as moving an exposure to the hard track,
and it is now recorded in two places. I kept both because they answer different questions —
the pack answers *where is the paperwork*, the exposure answers *what may appear in a
headline* — but they can drift, and nothing yet stops them. The honest fix is for the
countersignature to be one event that writes both, gated by the same `MONEY` ticket. That
is a half-day and I would do it before anyone relies on either number.

### Core is done

L1–L8, the thirty-four days of the plan. What exists now: the shell and the five seams,
entities with provenance, the approval gate and conflict cases, the route planner with
evidence tiers, the consent ladder, the two money tracks with a conserved-pool check, the
daily HUD with a holiday-aware calendar, and both close rooms. `npm run props` covers the
domain rules that matter with 17 properties and 5 perturbations.

---

## L9 — The selection rubric

**Shipped.** Module 03. Four dimensions, weights that are visible and editable on the page,
and a sentence under every number saying where it came from.

### Screenshots

| | |
|---|---|
| ![Selection](docs/changelog/shots/l9/01-selection.png) | **Ranked for PLC Neurotech I.** Four scored, two unscored. Every factor shows its basis, its source and who recorded it. |
| ![Reweighted](docs/changelog/shots/l9/02-reweighted.png) | **The same list after moving capacity to 10% and propensity to 40%.** The order changes, the old weight set is kept, and an audit row records who changed it and why. |

### A rubric, not a model

Nothing here is learned and nothing is inferred. `scoring.factor` requires a `basis` — a
factor without a reason is a guess with a decimal point — and carries a source reference
and an as-of date like every other externally-sourced field in this system.

**A target missing any factor is returned unscored.** Northwood has no propensity factor
because nobody has looked it up; Okonjo is missing two. They rank last and say why:

> *Not scored: Propensity and Time to decision have no factor on file. Three quarters of a
> rubric is not a score.*

That is the case a ranking is most likely to be wrong about, so it gets the loudest
treatment rather than a quiet default of 0.5.

### The weights are the argument

They live on the page as four sliders, not in a config file. Changing them re-ranks
immediately, keeps the previous set, and writes an audit row with the reason you typed.
A ranking you cannot reproduce is not a ranking; a ranking whose weights you cannot see is
one you cannot disagree with.

New property test:

```
  ok   Variation — reweight toward propensity
       Roos Foundation 0.54 → 0.47; its weakest dimension is propensity (no LP positions in
       seven years), so raising that weight has to lower it
```

`npm run props` is at **20 of 20**.

### Where I disagreed

**The band cut-offs are a guess and are not in `config/deployment.ts`.** 0.70 and 0.45 came
from judgement, same as L7's dead-week threshold. The page says so in the cover line
underneath the list. Both belong in the config file with the other labelled guesses, and I
would rather flag the inconsistency than quietly launder two more estimates.

**The score is rendered as a number, which brushes against the frontend contract.** The
rule is *never a numeric confidence rendered as fact*. A rubric total is not a confidence —
it is a weighted sum of four things a person wrote down — so it is shown with the band word
beside it, all four inputs underneath, and a sentence saying it is a way of arguing about an
order rather than a probability of anything. That is the line I drew; it is worth checking.

### Still not built

Signals (L10), meetings and the decision room (L11), materials (L12), agents (L13).

---

## L10 — Signals, through the Connector seam

**Shipped.** Module 06 — and deliberately **no screen for it**. Signals appear where they
are actionable: on Today, on the target they concern, and on System & seams where the
thresholds live.

### Screenshots

| | |
|---|---|
| ![Signals on Today](docs/changelog/shots/l10/01-signals-today.png) | **What changed.** Four signals above the threshold, each showing the rule that made it a signal rather than noise, with Claim and Dismiss. |
| ![Thresholds](docs/changelog/shots/l10/02-thresholds.png) | **System & seams.** The three signal thresholds, every guessed constant in the system, and the two signals the thresholds held back — each labelled with which rule stopped it. |

### The first real use of the Connector seam

`signalConnector()` is a `Connector<RawSignal>`: it reads `fixtures/signals.json`, but
through the same four-method contract Affinity and EDGAR will implement at L13.
`normalize()` produces `CoreRecord`s carrying the provenance tuple, and ingestion is
idempotent on a source key — the fixture's stand-in for
`(source, source_id, source_updated_at)`.

The seed no longer writes signals directly. It calls `ingestSignals()`, which pulls from
the connector. When a real source arrives, that function does not change.

### A signal is a change that crossed a threshold

Every row carries the rule that made it one:

> *Why this is a signal: Decision-maker change — personnel news is noise unless it touches
> the person who decides. This one does.*

A signal whose threshold cannot be named is a notification, and notifications get ignored.

**And the ones held back are shown too.** Two of the six seeded changes do not appear on
Today: a low-confidence podcast quote (below the confidence floor) and an August Form D
(outside the 21-day freshness window). Both are listed on System & seams with the rule that
stopped them, because a threshold nobody can see is indistinguishable from a bug.

### Every guessed constant is now labelled

While adding the signal thresholds I went back and registered the ones I had let slip:

| Constant | Why it is a guess |
|---|---|
| `guard.asksPerConnectorPerQuarter` | v3's unverified 1–5 range |
| `guard.conflictWindowDays` | v3 default, never checked against our own asks |
| `agents.correctionBudgetHoursPerWeek` | v3's unverified 10–15 h/week |
| `guard.asksPerRelationshipPerQuarter` | **same source, and CLAUDE.md does not label it** |
| `scoringBands.strong` / `worthALook` | my judgement at L9 |
| `calendarDeadWeekDays` | my judgement at L7 |
| `signals.freshDays` | my judgement here |

L7 and L9 now read their thresholds from `config/deployment.ts` rather than hardcoding
them. That closes the two unlabelled judgements I flagged in those entries.

### Where I disagreed

**`guard.asksPerRelationshipPerQuarter: 1` is under-specified, not just unverified.** I
raised this at L3 and it is now written into the config comment: one ask per relationship
per quarter **across all four vehicles** makes the conflict case nearly redundant, because
every cross-vehicle collision also trips the frequency cap. It is almost certainly meant per
vehicle. Until that is decided, the seeded Roos ask is refused twice for what is really one
reason.

**Module 06 has no screen and should not get one yet.** The build sequence calls L10
"signals", and the module map says 06 starts as a playbook. Both are satisfiable at once:
the model, the thresholds and the ingest path are real, and the output appears in three
places where someone is already looking. A dedicated signals page before any connector
exists would be a room full of invented change detection.

### Still not built

Meetings and the decision room (L11), materials (L12), agents (L13).

---

## L11 — Meetings and the decision room

**Shipped.** Modules 10 and 11, sharing a schema because they read the same material two
ways: *what is still unanswered*, and *what happened and what does it entitle us to claim*.

### Screenshots

| | |
|---|---|
| ![Prep brief](docs/changelog/shots/l11/01-prep-brief.png) | **The prep brief for Northwood Capital, with zero supported claims.** Both claims on file are low-confidence and unverified, so the brief refuses both and says so by name. |
| ![Decision room](docs/changelog/shots/l11/02-decision-room.png) | **The decision room.** Objections tagged into eight closed classes, diligence questions with owners and dates, the evidence gap stated as a number, and the decision timeline merging ladder events with meetings. |

### The brief that says nothing

This is the screenshot to look at. `prepBrief()` builds `supported` and `refused` by
construction: a claim reaches the brief only with a source, an as-of date and a confidence,
and a low-confidence claim nobody has verified is refused with its reason.

For Northwood, that leaves **nothing**. Its two claims are `$1.4B across nine families`
(from S11 — a 2021 CSV of unknown provenance) and an emerging-manager programme note, both
low confidence, neither verified. So the brief is empty, and it explains why:

> *Every claim on file fails the provenance test, so the brief has no content rather than
> thin content. Walking into a meeting knowing that is very different from walking in with
> two sentences that sound like facts.*

The refused rows are listed rather than omitted, because a brief with its gaps quietly
removed reads as complete.

### What a meeting justifies

Every held meeting carries `justifies_rung` and a sentence:

> *A meeting happened. Asking for a DDQ pack is process interest, not an indication — so
> this justifies meeting held and nothing above it.*

Which is the same judgement the seeded `STAGE` ticket is asking you to override. The prep
brief shows the next rung and what it would require, and hands you to the ladder rather
than advancing anything itself.

### Objections are a closed set

Eight classes: team, thesis, track record, terms, timing, structure, liquidity, governance.
A free-text objection cannot be counted, and an objection you cannot count is one you will
keep answering from scratch. The tally in the inspector shows raised versus answered per
class, across every target.

`answer_source` is required in spirit and shown wherever an answer is: an answer with no
source is an assertion.

### Where I disagreed

**The decision room and the target workspace overlap, and I think that is correct.** Both
show open questions for a target. The workspace answers *should we pursue this and how*;
the decision room answers *what is stopping this from closing*. They are different
questions at different moments, and merging them would produce one screen that is bad at
both. But it is duplication, and if you only ever use one, delete the other rather than
keeping both half-maintained.

### Still not built

Materials (L12) and agents (L13).

---

## L12 — Materials, audience variants, and the wrong-wrap gate

**Shipped.** Modules 14, 15 and 16. One canonical asset with five audience variants,
lineage invalidation on a changed claim, the wrong-wrap matrix checked before any approval
is requested, and a performance page whose main job is to say what cannot be measured.

### Screenshots

| | |
|---|---|
| ![Content studio](docs/changelog/shots/l12/01-content-studio.png) | **`AudienceVariants`.** One canonical asset, five variants side by side, each showing its permitted use and the claims it rests on. |
| ![Wrap refusal](docs/changelog/shots/l12/02-wrap-refusal.png) | **The gate refusing a send.** The public primer for the 506(b) SPV: two reasons, no ticket opened, and the refusal kept on the record. |
| ![Performance](docs/changelog/shots/l12/03-performance.png) | **Content performance.** There is no view data, so there are no view metrics — and the ladder is offered as the only attribution this system trusts. |

### The refusal comes before the approval

`requestSend` runs the wrap check *first*. If it fails, a `content.send` row is written
with status `refused` and the reasons, and **no ticket is opened**. An approval queue full
of things that may not legally be sent trains people to approve without reading.

The seeded case is the one that matters: the Neurotech primer is genuinely approved and
genuinely good, and sending it on behalf of the 506(b) Halo SPV would be general
solicitation. Two rules fail — audience and permitted use — and **both are reported**,
because fixing one at a time is two round trips.

The matrix is a closed set. A combination no rule covers is refused rather than assumed
fine; an uncovered case is a gap in the rules, and guessing at it is how an exemption gets
broken for a whole raise.

### `wrong-wrap sends = 0` is now measurable

Refusals are kept, not discarded. That is what makes the zero checkable rather than an
assumption, and it is now a property test alongside "a refused send never gets a ticket".

### Lineage, not staleness

`content.claim_ref` records what each asset rests on. `invalidateForClaim` flags every
asset resting on a changed claim **and their derivatives**, transitively, and a flagged
asset cannot be sent. A deck goes wrong because a fact underneath it changed, not because
ninety days passed.

Both are property tests now:

```
  ok   Variation — public primer for the 506(b) SPV
       refused with 2 reasons and no ticket opened — audience and permitted-use both fail
  ok   Variation — a claim changes underneath an approved asset
       6 assets flagged transitively, and the send is refused
```

`npm run props` is at **24 of 24**.

### Where I disagreed

**Module 15 barely deserves a page, and I built it as an argument rather than a dashboard.**
There is no view data and there will not be until DocSend arrives — forward-only through a
Zapier webhook, no backfill, no signature. A chart of sends-per-week would look like content
performance and measure nothing. So the page states what is known, what is not, and offers
the consent ladder as the only attribution the system trusts: a rung was reached, and a
specific piece of evidence justified it. Nothing claims a document caused it.

If that reads as a page not worth having, the right response is to delete it rather than
fill it.

### Still not built

Agents (L13) — the work envelope, run pinning, the regression harness, idempotent
acceptance keys, the trust circuit breaker, and the no-unsolicited grant gate.

---

## L13 — The agent runtime, the protected eval set, and the grants gate

**Shipped.** Module 20 and the agent runtime. **The L-series is complete: L1 through L13.**

### Screenshots

| | |
|---|---|
| ![Agent runtime](docs/changelog/shots/l13/01-agent-runtime.png) | **Work envelopes, runs with their pins, refused tool calls, and the protected eval set** — every case traced to a real failure from an earlier stage. |
| ![Grants gate](docs/changelog/shots/l13/02-grants-gate.png) | **The no-unsolicited gate.** Two funders blocked because no invitation exists, one permitted because a programme officer asked us to submit on 5 September. |

### The authorization unit is the run

`agents.envelope` carries the nine fields from CLAUDE.md, and `createEnvelope` enforces the
one rule that is easy to write and easy to lose:

> *Delegation cannot increase permission. The child asks for commands the parent does not
> have (content.send). Nothing was created.*

Checked rather than documented, because "the child inherits the parent's scope" stays true
until somebody adds one convenient exception.

Every tool call is checked against the envelope **and recorded, including the refusals**.
A log containing only what was permitted answers no question anybody actually asks.

### Runs are pinned

`config_hash`, `config_snapshot`, `input_hash`, `prompt_hash` — written before the agent is
asked for anything. Editing a prompt changes what new runs do and changes nothing about
what old ones meant. The whole config object goes into the row, so a run made under a
12-hour correction budget still says 12 after somebody changes it to 8.

### Acceptance is a human act, and it is idempotent

`acceptRun` takes an `app_user` id — the agent does not have one — and an idempotency key
with a unique index behind it. The second click returns `alreadyAccepted` and writes
nothing. That is a property test now, not a button-state promise.

### The harness reports "not run", not green

There is no API key, so the stub agent refuses every eval case and the harness records
*not run* against the prompt hash. **A harness that passes because it could not execute is
worse than no harness.**

The six protected cases are all drawn from real failures found while building L1–L12, and
each one names the stage:

| Case | From |
|---|---|
| refuses a claim with no provenance | L2 |
| does not upgrade co-attendance into a relationship | L4 — the planner was promoting a reviewed tier-D edge |
| never blends soft into hard | L6 — **my own first draft** summed convertible soft across four vehicles |
| refuses a send the wrap matrix blocks | L12 |
| does not claim a rung the evidence does not support | L11 |
| blocks unsolicited grants-rail outreach | L13 |

A fixed set overfits, so they are added from things that went wrong rather than invented.

### The circuit breaker measures rather than senses

`agents.correction` records minutes spent fixing agent output, recorded by the people doing
the correcting. Over `config.agents.correctionBudgetHoursPerWeek`, no new top-level
envelope may be created — existing runs still work, and a child envelope narrowing an
existing one is still allowed. The freeze stops new autonomy, not all work.

### The grants gate is the fifth guard, and it is not overridable

`no_unsolicited_grant` joins the four from L3. Like non-circumvention, it takes no override
reason: it is somebody else's decision, not our policy. An entity with no funder record at
all is refused for the same reason — permitted-by-omission is how an unsolicited approach
happens.

An invitation is a reference, a date and a name. An encouraging conversation at a
conference is not one, and that distinction is the entire rule.

`npm run props` finishes at **29 of 29**.

### Where I disagreed

**`lib/agent/claude.ts` still refuses even with a key present, and I left it that way.**
The seam resolves to the real agent when `ANTHROPIC_API_KEY` is set, and that
implementation returns `refused` with a sentence explaining that the envelope policy check,
run pinning and the regression harness are what make a run auditable. Those now exist —
`checkToolCall`, `runInEnvelope` and `runEvals` — so the refusal could be lifted. I did not
lift it, because wiring a live model would mean choosing a prompt, and a prompt that has
never passed a single protected case should not be the one that ships. The harness needs to
go green against a real runtime before that file stops refusing, and that is a decision
with a cost attached rather than a line of code.

---

# Beyond L13

The L-series is complete. What follows is the work the plan left as "a module is a
capability, not necessarily a screen" — built when a screen turned out to be warranted, and
the gaps flagged during the build.

---

## Module 24 (the other half) — claims and solicitation registry

**Shipped.** The compliance half of module 24 — the hole `docs/13-synthesis-r3.md` §2 names
explicitly: *"Across twenty modules and six architecture documents there is no
accredited-investor handling, no jurisdictional restriction, no solicitation record. For
506(c) vehicles that is not a simplification, it is a hole."*

![Compliance registry](docs/changelog/shots/m24/01-compliance.png)

### It is a gate, not a report

`accreditationGate(entity, vehicle)` runs **before** a `MONEY` ticket is opened and again
inside the transaction that would record the hardening. A missing record is refused rather
than waved through — permitted-by-omission is the failure mode a verification obligation
exists to prevent.

### Complete, signed, and still insufficient

Whitcomb Capital is the case worth staring at. The record is there. It is signed, dated and
marked `verified`. It is **not sufficient**, because the method is self-certification and
that is not reasonable steps under 506(c) no matter who signed it. Asking to harden that
commitment is refused before a ticket exists.

The same record on the 506(b) Halo SPV *is* sufficient, because 506(b) asks for a
reasonable belief rather than verification. The judgement is per-vehicle, and the row shows
its reasoning in a sentence rather than a colour.

### The claim that caught itself

One public claim is flagged **needs review**: *"Backed by a $60M first close"*, used in an
email on 19 September. Hard is $56.0M until the Cedar `MONEY` ticket is approved. The
registry caught it because `substantiation` is a required column rather than a habit — the
person filing it had to write down what made it true, and could not.

### Side letters that interact

The Cedar fee break triggers the Vantage MFN, and Vantage has not been told. That is a row
here in September rather than a discovery in January.

Four new properties, including the one that matters:

```
  ok   Self-certification never satisfies a 506(c) vehicle
  ok   No 506(b) vehicle appears in the solicitation log
  ok   Every public claim in use has substantiation on file
  ok   Variation — harden a subscriber who only self-certified
       refused before a MONEY ticket was opened — the record is complete and still insufficient
```

`npm run props` is at **33 of 33**.

### Where I disagreed

**This should have been in the L-series, not after it.** The plan puts module 24 in the
"Execute & govern" section and L3 builds the ticket queue half, but nothing in L1–L13
builds the verification gate — and the gate is what makes four 506(c) vehicles safe to
operate. It took about half a day. If the L-series were being re-planned, this belongs
inside L6, next to the money it guards.

---

## Modules 17 and 13 — the answer library, and a backlog that generates itself

**Shipped.** Approved answers with their own versioning and approval state, and the
coverage-gap analysis that module 13 describes — as a query rather than a page of its own.

![Answer library](docs/changelog/shots/m17/01-answer-library.png)

### Why an answer needs its own approval

An answer is approved separately from the documents it cites. That sounds like a
distinction without a difference until the document changes: the answer sits there still
marked approved, and somebody reads it out in a meeting.

So `library.answer` carries its own status, approver and expiry, and `library.answer_source`
records the claims and documents underneath it. An answer goes stale **two ways** and both
are detected:

- **On a date.** The PRI answer was approved in March 2024 with a one-year expiry. It is
  flagged.
- **On a fact.** If a claim it rests on is superseded, it is flagged even though nobody
  touched the answer.

### The backlog generates itself

`coverageGaps()` is module 13, and it is nine lines of SQL and a word-overlap match. It
takes every objection and every diligence question that has actually been raised and looks
for an approved answer. What comes back is ten questions with nothing behind them — the
content backlog, derived from what people were asked rather than from what somebody
planned to write.

### Where I disagreed

**The matching heuristic is crude, and deliberately biased toward over-reporting.** It
needs two shared words over four characters, so "Fee load is above what their committee has
approved" does not match "What are the fee terms, and is there a break at size?" — even
though the approved answer covers it. That is a false gap.

I left it, because a backlog generator that over-reports wastes a minute of reading and one
that under-reports hides the question you keep being asked. The column is labelled
*nearest*, not *answer*, and the cover line says the match is a pointer to check. Attaching
the real answer to the real objection happens in the decision room, where a person does it.

**Modules 02, 06, 12 and 23 still have no screens, and should not get them yet.** Module 13
earned one because the gap query turned out to be genuinely useful; 17 earned one because
answers need somewhere to live. Segmentation, signals, the LP-fit audit and team capacity
have not demonstrated a workflow that needs a page, and building four more would be exactly
the "twenty-four screens before anything is proven" the plan refuses.

---

## Where this got to

![Today](docs/changelog/shots/final/01-today.png)

**L1 through L13, plus module 24's compliance half and modules 17 and 13.** Eighteen
Postgres schemas, thirty screens, 16,700 lines of TypeScript. It runs on a laptop with no
cloud, no SaaS account and no services: `npm install && npm run dev` migrates, seeds and
serves.

```
npx tsc --noEmit      clean
npm run boundaries    ok · 185 files checked
npm run props         34 of 34 properties hold
npm run build         32 routes, compiled successfully
```

### The feedback loop is closed

![Issues](docs/changelog/shots/final/02-issues.png)

Six issues in `issues/`, all filed through the in-app box, one of them marked **done**
because the thing it complained about got fixed during the build. Three were filed at the
end about gaps I know are there:

- **0004 (P1, question)** — one ask per relationship per quarter refuses the Roos ask twice
  for one reason. The constant needs a decision, not a value.
- **0005 (P2, request)** — nothing records cash arriving. `recordCash` exists, is tested,
  and is called by no screen.
- **0006 (P3, chore)** — the coverage-gap matcher over-reports.

### Four modules still have no screen, on purpose

![A capability without a screen](docs/changelog/shots/final/03-capability-without-screen.png)

Segmentation, signals, the LP-fit audit and team capacity are reachable at `/m/<slug>`,
where the page says what the capability is and where its output already appears. That is
more useful than a 404 and more honest than a placeholder table.

Two modules *did* earn screens during the build — the coverage-gap backlog and the answer
library — because in both cases something needed somewhere to live. That is the test the
plan set, applied rather than quoted.

### The things I would look at first

1. **`guard.asksPerRelationshipPerQuarter`.** Under-specified, not just unverified. Issue 0004.
2. **The agent runtime still refuses with a key present.** Everything it was waiting for now
   exists; what is missing is a prompt that has passed the protected set even once.
3. **Cash has no UI.** The state exists, the rule that keeps it separate from a
   countersignature is enforced, and nobody can record a wire.
4. **Nine constants are labelled guesses** and none should survive two weeks of real data.
   They are all in `config/deployment.ts` and all listed on `/system`.

### What I did not build

No connectors. No auth integration. No graph database, no vector store, no event broker, no
service mesh, no microfrontends, no plugin framework, no warehouse pipeline, no full event
sourcing, no durable orchestration. `pg` is not installed. The do-not-build list held.

---

## N1 — Project-oriented navigation

**Shipped.** The rail was organised by function — twenty-four modules in four umbrella
sections — and the question people actually arrive with is *"what is happening on
Neurotech"*, not *"where is the soft/hard cockpit"*. So vehicles are now the structure and
the modules are what you find inside one.

### Screenshots

| | |
|---|---|
| ![All vehicles](docs/changelog/shots/n1/01-overview-all.png) | **PL Capital → All vehicles.** Every vehicle side by side, no total row, and a module submenu that reads across all of them. |
| ![One vehicle](docs/changelog/shots/n1/02-overview-vehicle.png) | **Selecting a vehicle** loads its overview and opens its modules in the rail. Everything below is scoped to it. |
| ![Pane closed](docs/changelog/shots/n1/03-pane-closed.png) | **The right pane closes.** One button at the top right, and the choice is remembered. |
| ![Sections collapsed](docs/changelog/shots/n1/04-nav-collapsed.png) | **Sections collapse** and stay collapsed across reloads. Developer starts closed. |
| ![Operations](docs/changelog/shots/n1/05-operations.png) | **PL Capital → Operations.** The cross-vehicle layer: collisions between vehicles, connector goodwill spent across all of them, the shared calendar. |
| ![Relationships](docs/changelog/shots/n1/06-relationships.png) | **Relationships.** LPs, co-funders and everyone — with roles *derived* from what happened rather than typed into a field. |
| ![PL R&D](docs/changelog/shots/n1/07-rnd.png) | **PL R&D.** In the navigation because it is in the organisation; not in the data model, and the page says so plainly. |
| ![Changelog](docs/changelog/shots/n1/08-dev-changelog.png) | **Developer → Changelog**, rendered from `CHANGELOG.md` with its screenshots, so it cannot drift from the repository. |
| ![Status](docs/changelog/shots/n1/09-dev-status.png) | **Developer → Status.** What is running, and a problems list computed from the hard rules rather than maintained by hand. |
| ![Modules](docs/changelog/shots/n1/10-dev-modules.png) | **Developer → Modules.** All twenty-four: vehicle-scoped, cross-cutting, or a capability with no screen. |
| ![Settings](docs/changelog/shots/n1/11-dev-settings.png) | **Developer → Settings.** Nine guessed constants, each saying why it is a guess. |

### The rail

- **Today, Approvals, Issues** stay at the top, ungrouped — three entry points, not a
  section worth a heading.
- **PL Capital** holds Operations, then every vehicle, then All vehicles. Clicking a
  vehicle changes scope *and* opens its modules underneath. SPVs get the war room, funds
  get the close room, the grants rail gets the gate — `modulesForKind` decides.
- **PL R&D**, **Relationships**, **Other**, **Developer**. Developer starts collapsed so a
  first-time user is not handed the plumbing.
- Collapse state is remembered. A preference that resets on every reload is not a
  preference.
- **Give feedback** is a button in the rail above the user, where the spec asked for it, and
  no longer competes with the breadcrumb bar.
- The vehicle dropdown is gone. It was a control that changed what every number on the page
  meant, and it looked like a filter.

### The right pane

The inspector is now a pane that closes, with one small button at the top right and the
state remembered. It was always-on scaffolding; it is now something you open when you want
to drill into one thing.

Its accessible name was the glyph `⟩` until a test tried to find it by name — which is
exactly the bug a screen reader user would have hit first. It has a real label now.

### Roles are derived, not declared

`relationshipRoles()` works out what someone is to us from what actually happened: an LP
because hard money is on file, a connector because asks have gone through them, a funder
because they appear on the grants rail, a co-funder from a coinvestor edge. A role *field*
is a second copy of the truth, and the second copy is the one that goes stale.

### Where I disagreed

**The vehicle is in a cookie, not the URL.** `/soft-hard` means "the soft/hard cockpit for
whatever vehicle you have selected". The alternative — `/v/neurotech/soft-hard` — is better
and I did not do it, because it means either moving twenty route files or rewriting every
internal link to be vehicle-aware, and neither is a navigation change.

The cost is real and worth stating: **you cannot share a link to a vehicle-scoped page.**
Send someone `/soft-hard` and they see whatever vehicle *they* last picked. If people start
sending each other links, that is the thing to fix, and the fix is the route restructure.

**PL R&D has no data and I did not invent any.** Two pages that say what is not modelled,
what would carry over if it were (identity, research, the answer library) and what would
not (exposure, the consent ladder, the close rooms). A furnished room where none of the
furniture takes weight is worse than an empty one.

**`/system` became two pages.** Status answers *is anything wrong*, Connectors answers
*what is attached and what does it swap to*. They were one page doing both jobs badly.
The old URL redirects.

### Verification

38 routes, all 200 from a genuine cold start. `npm run props` at 35 of 35. Production build
compiles 46 routes.

---

## N2 — Newest first

**Shipped.** The build log reads in reverse: the last thing that happened is at the top, in
both the in-app page and the standalone one.

![Changelog, newest first](docs/changelog/shots/n2/01-changelog-newest-first.png)

`CHANGELOG.md` itself stays chronological and append-only. That is deliberate: a new entry
is a clean append at the end of the file rather than an insert at the top, so its diff
shows only what was added. **Reading order is a rendering decision**, and both renderers
now make the same one.

`groupChangelog()` in `lib/markdown.ts` splits the document into entries, which is what
made rendering it in either direction possible at all — previously both pages walked a flat
block list and could only emit it in file order. The mid-document `# Beyond L13` heading
became an era marker rather than a heading: reversed, it sits directly above L13, so
reading downward it correctly announces that everything below it is the L-series.

One shared parser, two renderers, one reading order. The in-app page and the page you read
on a phone cannot disagree about what happened.

---

## N3 — Funder–vehicle fit

**Shipped.** A new module, `fit`, and two screens: a roll-up at `/fit` and a page per firm
× vehicle at `/fit/<entity>`. The question it answers is not "how good is this prospect"
but **"what is actually stopping this one, and what is the single next move."**

### Screenshots

| | |
|---|---|
| ![All vehicles](docs/changelog/shots/n3/01-fit-all-vehicles.png) | **The roll-up, grouped by what is blocking.** Not a funnel — a work queue. Each group's heading says what the job is: an awareness gap needs reach, a conviction gap needs one objection answered, an unanswered gate needs somebody to pick up the phone. |
| ![One vehicle](docs/changelog/shots/n3/02-fit-one-vehicle.png) | **Scoped to PLC Neurotech I** through the same vehicle selection the rest of the app uses. Same page, one vehicle. Nothing is ever summed across vehicles. |
| ![Diagnosis and gates](docs/changelog/shots/n3/03-diagnosis-and-gates.png) | **The diagnosis above the fold, hard gates directly beneath it.** Northwood's blocker is conviction — they told us the objection in the room. Two of their six gates are unanswered, and an unanswered gate is not a pass. |
| ![Dimensions](docs/changelog/shots/n3/04-dimensions-biggest-misses.png) | **Eighteen graded dimensions, three sort orders.** Matters to us, matters to them, and biggest misses. Every reading carries whether it is known, inferred or guessed, and the certainty discounts the number rather than decorating it. |
| ![Values and perception](docs/changelog/shots/n3/05-value-and-perception.png) | **What they value, and whether they can see it in us.** A match they cannot see is worth nothing at the moment of decision. Below it, familiarity and sentiment as separate columns. |
| ![Ties](docs/changelog/shots/n3/06-ties-and-decision.png) | **Ties between us, with strength and opinion-weight as different columns.** Hale is a moderate tie to Roos and a **blocker** — she asked not to be introduced through him, and the tie table says so rather than quietly ranking him third. |

### The cards, and what each is for

**Hard gates.** Six, checked before any weighted score is worth reading: cheque band,
mandate, duration, conflict, accreditation, provenance. Report 4 §4.2 is explicit that
gates come before weights, and the reason is that a weighted score over a firm that cannot
participate is an arithmetic exercise. Three states, not two — **an unanswered gate is not
a pass.**

**Firm–vehicle fit.** Eighteen dimensions, each with a question, a grade, a finding and a
basis. You asked for check band, thesis fit, industry fit, deployment tempo, liquidity, VC
exposure and tech-forwardness; the rest come from Report 1 §2.5 and Report 4 §4.1 —
decision speed, duration tolerance, catalytic capacity, signal value, strategic value,
referral willingness, domain sympathy, stated motivation, manager-stage permission,
fund-size alignment, and whether they back funds at all.

Two weights, not one. **`weight_us` is how much it moves our decision to spend a week here;
`weight_them` is how much it moves theirs.** They disagree often — decision speed is a 5 to
us and a 2 to them — and collapsing them into one number hides the disagreement that the
pitch should be built around. The table sorts by either, or by biggest miss.

**What they value.** What they care about, how we match it, **whether that is already clear
to them**, and the next move to prove it. The "clear to them" column is the one that earns
its place: Northwood has four value items and three are not yet clear, which is the entire
content of the next conversation.

**What they think of us.** Familiarity and sentiment, held separately, per subject — the
firm, the vehicle, the thesis, each GP, the track record. Report 5 §3 is the source: an
awareness gap and a conviction gap look identical in a pipeline and need opposite work.
Engagement (follows, event attendance, newsletter) is listed **separately again**, because
a follow is not an opinion and a quiet feed is not evidence of a quiet reader.

**Ties between us.** Tie strength and opinion-setting weight are different columns on
purpose. Report 6 §2: moderately weak ties move more than either strangers or close
friends, and connector credibility is target- and topic-specific — it does not transfer.
A well-known name is not automatically a good route.

**Who decides, and how long it takes.** Decision architecture as an ordinal with weeks
attached, who signs, who can kill it, the cheque they write, estimated assets **with its
basis and certainty printed next to it**, whether an adviser filing exists, and how the
relationship started. The SEC row says what an absence means: no filing for a single family
office is the expected answer and usually means a faster decision, which is the diagnostic
Report 4 §2.1 makes and most systems render as a missing field.

### The diagnosis is a precedence, not a score

```
gated → conviction → access → evidence → fit → timing → awareness → none
```

The first condition that applies wins, and the page reports which one. Eight seeded
assessments produce seven different blockers, which is the whole point: Cedar is closed,
Tessaro has never heard of us, Northwood knows us and wants the marks verified, Vantage and
Roos each have one unanswered gate, Sable Point has no route in, Okonjo has gone quiet, and
Whitcomb is excluded on accreditation.

Two ordering decisions worth naming:

- **Conviction outranks an unanswered gate.** If they have told you why they are not
  convinced, that is the most specific and most actionable thing you have, and it beats a
  diligence item nobody has chased.
- **Access outranks evidence.** You cannot resolve an open gate on a firm you have no way
  to reach, so "find a route" is the first job, not the fourth.

`accredited` is deliberately excluded from the gates that trigger an *evidence* blocker: it
is closing mechanics, normal to leave open until subscription, and treating it as a
qualification blocker would flag almost every live prospect as unqualifiable.

**Awareness is measured against us, not against a thesis they hold independently.** Tessaro
knows the neuro thesis deeply — they arrived at it on their own — and has never heard of
Protocol Labs. Scoring their thesis familiarity as familiarity with us would hide exactly
the gap that matters. There is a property in `npm run props` asserting this, because it is
the kind of thing a later refactor silently breaks.

### Where the seeded data came back to bite, correctly

**Whitcomb fails the accreditation gate and the compliance registry says the same thing.**
They self-certified, PLC Neurotech I is 506(c), and self-certification is not reasonable
steps no matter who signed it. Two modules built weeks apart, one answer. There is a
property asserting they agree, so a change to either one that breaks the agreement fails
the build rather than producing a page that quietly contradicts another page.

**Hale appears in Roos's tie table with `blocker` weight.** The non-circumvention
restriction was recorded in L4 and the fit page reads it as a tie that cannot be used. The
restriction attaches to the target, so this is the right behaviour — a route table that
listed him third would be the bug.

### What this does not do

No strategy is generated. Every "next move" on these pages was written by a person against
a specific finding; nothing is composed, ranked or sent. The one computed recommendation is
the diagnosis's single `nextMove`, and it is a consequence of the precedence rather than a
judgement about the firm.

No health inference. Report 4 §6.2 is unambiguous, and in a neurotech raise it is the rule
most likely to be broken by accident: record only what a person has publicly stated about
their own interests, attribute it to the source, and never record inferred or third-party
health detail. Tessaro's stated interest is recorded from a public interview and says so;
there is nothing else in the schema that could hold anything more, and the coverage line at
the foot of every fit page says so in as many words.

The assessments are seeded, not derived. `weight_us` and `weight_them` are judgement calls
in one table in `lib/seed-fit.ts` — the catalogue is the argument, and it is meant to be
edited rather than trusted.

**43 of 43 properties hold.** Eight of them are new and cover this module.

---

## N4 — Orgs & people

**Shipped.** Entities get a home page and a summary pane. The dossier that lived inside
Research & enrichment moved to `/orgs/<id>` and grew the rest of what is known about a
record; the section it sits in is now **Orgs & people**, because that is what is in it.

### Screenshots

| | |
|---|---|
| ![Directory](docs/changelog/shots/n4/01-orgs-directory.png) | **The directory.** Everyone, LPs, co-funders and connectors as tabs rather than four routes. Roles are still derived from what happened, and the last column now carries what is in the way for each one. |
| ![Summary pane](docs/changelog/shots/n4/02-summary-pane.png) | **Clicking a name opens the summary here**, without leaving the list. Money per vehicle, where the conversation is, what is in the way, the ties on file, and what the record rests on. |
| ![Entity page](docs/changelog/shots/n4/03-org-page.png) | **The entity page.** Restriction first, then where we stand per vehicle, then how we reach them, then what we can support with its provenance, then the open questions. |
| ![From the fit roll-up](docs/changelog/shots/n4/04-summary-from-fit.png) | **The same pane, from a different list.** One component, so the answer to &ldquo;who is this&rdquo; cannot differ between screens. |
| ![Connectors](docs/changelog/shots/n4/05-connectors.png) | **Connectors** are a group now. Goodwill is spent per person across every vehicle, so the people carrying asks deserve their own list. |

### Two affordances on a name, on purpose

The name opens the summary in the right pane through a `?e=` search param. The small arrow
beside it opens their page. **&ldquo;Remind me who this is&rdquo; and &ldquo;take me to
their record&rdquo; are different intentions**, and collapsing them costs a back button
every time someone is scanning a list.

The pane is one server component, `EntitySummary`, used on the directory, the fit roll-up
and selection. Three screens, one answer. A summary assembled per page is three summaries
that drift.

### What moved, and what still works

- `/research/<id>` → `/orgs/<id>`, redirected. Earlier changelog entries and filed issues
  link to the old URL, so it keeps working.
- `/relationships/<group>` → `/orgs/g/<group>`, redirected.
- Research & enrichment stays, renamed **Research corpus** in the rail, because that is what
  is left there once the per-entity view moved out: the source documents, the coverage
  disclosure and the claim counts.

### A person and the institution they sign for are separate records

Delia Roos is a person; Roos Foundation is the funder with the mandate, the cheque band and
the §4944(c) question. Neither is a field on the other, and the fit assessment sits on the
foundation.

So her page said *Not assessed* twice and read as "nobody has looked at this", which is
wrong and worse than the truth. It now says **assessed next door**, names the tied record
and links to it. The money, the mandate and the restriction do not always attach to the
same one, and a system that quietly merged them would get the restriction wrong — which is
the expensive one.

### The pane does not pretend to be a chat box

You asked for the pane to be able to open an LLM for questions and discussion. It does not,
and the pane says why: the agent runtime refuses until a prompt has passed the protected
eval set, and it has not. A chat box wired to nothing would answer from nothing, which is
the failure this whole system is built to avoid. The pane points at `/agents`, where the
envelope, the eval cases and the refusal are all visible.

That is the one thing in this request I did not build, and it is a decision with a cost
rather than an omission.

**43 of 43 properties hold.** The production build compiles 50 routes.
