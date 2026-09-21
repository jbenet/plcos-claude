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

---

## N5 — The vehicle is in the URL, and the readings point one way

**Shipped.** Four changes you asked for, plus the alignment bugs the N3 screenshots showed.

### Screenshots

| | |
|---|---|
| ![Score and rank](docs/changelog/shots/n5/01-score-and-rank.png) | **A score, a rank, and the pool it sits in.** 60 out of 100, 5th of 7 for this vehicle, ahead of 2 of the other 6, pool 56–84 with the median marked. The URL is `/neurotech/fit/<target>`. |
| ![Readings](docs/changelog/shots/n5/02-readings.png) | **Every reading points the same way: up is good for this raise.** A bar for strength, a sign for direction, and words that say whose side it is on. Importance is a number now, not pips. |
| ![Ranked roll-up](docs/changelog/shots/n5/03-rollup-ranked.png) | **The roll-up carries rank and score per row**, so the grouping by blocker no longer hides where each one sits in the pool. |
| ![Top of the pool](docs/changelog/shots/n5/04-top-of-pool.png) | **Cedar at 84, 1st of 7** — and the distribution shows how narrow the top of this pool actually is. |
| ![Blocked, ranked last](docs/changelog/shots/n5/05-blocked-last.png) | **Whitcomb scores 80 and ranks 7th of 7.** The strip says why in the same breath: a failed hard gate is not a ranking question. |

### `/<vehicle>/fit/<target>`

Fit was the first module where the vehicle belonged in the path rather than the cookie, so
it moved: `/neurotech/fit`, `/rails/fit`, `/all/fit`, and `/neurotech/fit/<target>`. **A
link to a fit page now means the same thing to whoever you send it to.** `/fit` and
`/fit/<id>` redirect to whatever vehicle is selected, so nothing that already linked to
them breaks.

The rail takes the vehicle from the URL when the URL has one. Left to the cookie it would
have said *All vehicles* while the page said Neurotech, which is the kind of quiet
disagreement that makes a reader stop trusting the chrome. Switching vehicles from the rail
while on a scoped module keeps you on that module rather than throwing you back to the
overview.

This is the trade-off I flagged in N1 — the vehicle lives in a cookie, and the fix is a
route restructure — applied to one module. `NavModule.scoped` marks it, `moduleHref()`
builds it, and the other twelve are unchanged until they earn it.

### The readings now point one way

`Neuro exposure — Weak` made you work out the polarity of the dimension before you knew
whether it was good news, and on eighteen rows that is a mistake waiting to happen. Every
reading in the module now says the same thing in the same direction:

```
++  Strong for us      ·  In our favour   ·  Neither way   −  Against us   ✕  Blocks this
```

A bar carries the strength, the sign carries the direction without relying on colour, and
the words say whose side it is on. The same component does value-item matches and
tie-weights, so nothing in the module grades on a different axis from anything else.

### Importance is a number, not a signal-strength bar

You were right that the pips read as signal strength, which is a different quantity
pointing a different way — and two ambiguous bars in one row is one too many. They are
`5/5` and `3/5` now, under headings that say *matters to us* and *matters to them*.

### An aggregate score, a rank, and the distribution behind both

A 0–100 score where the decimal used to be, and never on its own:

- **Rank in the pool** — "5th of 7 assessed for PLC Neurotech I", with "ahead of 2 of the
  other 6" spelled out.
- **The whole distribution** on one strip: a dot per assessment, this one filled, blocked
  ones dashed, the median ticked and the range labelled. 0.60 is meaningless until you know
  whether the rest of the list is at 0.3 or 0.9.
- **The ordering stated:** anything failing a hard gate ranks last however well it scores.
  Whitcomb scores 80 and comes 7th, which looks wrong until you read the sentence that says
  why — so that sentence is on the strip rather than in a footnote.
- The roll-up carries `#rank` and the score on every row, and the median and range are in
  the KPI strip.

I kept the caveat prominent: the pool is seven, the weights are judgement, and a rank over
seven hand-graded records is a conversation starter rather than a verdict. A leaderboard
that hides that is how a rubric turns into a model nobody argues with.

### The alignment bugs

- **The rail stopped at the first screen.** It is `position: sticky; height: 100vh`, so on a
  long page everything below the fold showed ground colour where the rail should be. The
  column is painted on `.app` now, which is what the full-page screenshots in N3 and N4 were
  showing.
- **The diagnosis "move" was right-aligned prose.** Ragged-left body text in a two-column
  fact row. It is a labelled block now, reading left to right like everything else.
- **Familiarity wrapped around its meter** — "Never heard / of us" beside a bar. The words
  go on top, the bar underneath, both left-aligned.
- **`.row.sel` painted a clay bar on every cell** rather than one down the left edge.
- **The values table squeezed "how we match it" to a sliver** because auto layout gave the
  space to the last column. Fixed layout, explicit widths.
- **Five KPIs wrapped 4 + 1**, leaving one tile alone on a second line.
- **`Nothing blocking` wrapped inside its own chip** in the directory table. The short
  blocker vocabulary is a separate map from the long one, so the heading can stay a sentence
  while the cell stays a label.

**43 of 43 properties hold.** 55 routes return 200 from a genuine cold start.

---

## N6 — A green theme, and preferences of your own

**Shipped.** Two themes, a preferences page separate from Developer → Settings, feedback
and settings sharing a row in the rail, the grants rail under PL R&D, and the exemption
moved off the nav and onto the vehicle.

### Screenshots

| | |
|---|---|
| ![Preferences](docs/changelog/shots/n6/01-preferences.png) | **Preferences.** Theme, the three browser-stored layout preferences named by their keys, and who you are. Configuration lives elsewhere and the page says where. |
| ![Green theme](docs/changelog/shots/n6/02-green-theme.png) | **Green, applied.** The accent, the ground and the rail move. The four semantic colours do not. |
| ![Green overview](docs/changelog/shots/n6/03-green-overview.png) | **The vehicle overview in green**, with the exemption banner that replaced the `506(c)` suffix in the rail. Grants rail now sits under PL R&D. |
| ![Green fit](docs/changelog/shots/n6/04-green-fit.png) | **The fit page in green.** Passing gates are still the semantic green, selection is the accent green, and a blocker is still clay. |
| ![Grants under R&D](docs/changelog/shots/n6/05-grants-under-rnd.png) | **The grants rail is a vehicle with its own modules**, drawn in the section where the work actually sits. |

### The theme could not be one token

`--clay` was doing two jobs: it was the brand colour *and* it meant refused, blocked,
needs evidence. Re-pointing it to green would have turned every blocker green, which is
worse than having no themes.

So the roles are separate tokens now:

```
--accent   brand, selection, "you are here". This is what a theme changes.
--clay     refused · blocked · needs evidence.
--green    passed · hard money.     --amber  needs a look.     --purple  inferred.
```

**A theme re-points the accent, the ground and the rail. It never re-points the four
semantic colours.** A palette that meant different things on different themes would be
worse than one palette, and a reader who learned it on clay would be wrong on green.

The green accent is deliberately brighter than the semantic `--green`, so a selected row
and a passing gate stay two distinguishable greens — and every state still carries a word
beside its colour, which is the rule that makes the whole thing safe.

The theme is applied by an inline script in `<head>` before first paint. Read in an effect
it would render clay first and swap on every navigation.

### Preferences is not Settings

`/settings` holds what a person chooses for themselves. `/dev/settings` holds what the
system was configured with, including nine constants labelled as guesses. Putting a theme
picker next to a circuit-breaker threshold would have been a category error, and the kind
that gets a constant changed by someone who thought they were picking a colour.

Both pages name the three keys in `localStorage` and both can reset them. A preference you
cannot find is one you cannot undo.

### The rail

Feedback and settings share a row — `✎ Feedback` and a gear — directly above the user.

**The grants rail moved to PL R&D.** It is still a vehicle with its own modules and its own
gate; it is drawn in the section where its work sits rather than under PL Capital.

**`506(c)` came off the nav rows.** The exemption is not a five-character suffix: it decides
what may be sent to whom and who must be verified before money is recorded. It is now a
banner at the top of the vehicle overview that says what it means in a sentence —
solicitation permitted and verification mandatory for 506(c), no solicitation and a
pre-existing relationship required for 506(b), invitations rather than subscriptions for
the grants rail — with links to the send gate and the compliance registry.

---

## N7 — People, firms, and the fact that they are different records

**Shipped.** `identity.affiliation` — who acts for which organisation, in what capacity,
between which dates. A person can act for several, which is normal rather than an error.

### Screenshots

| | |
|---|---|
| ![People](docs/changelog/shots/n7/01-people-tab.png) | **The directory lists everyone**, and now has *People* and *Firms & institutions* tabs. Each row says who somebody acts for, or how many people a firm has on file. |
| ![Firm people](docs/changelog/shots/n7/02-firm-people.png) | **A firm page carries its people.** Northwood's decision-maker, her capacity, the dates she has held it, and the other firm she also appears at. |
| ![Two firms](docs/changelog/shots/n7/03-person-two-firms.png) | **A person page leads with where they sit.** Raman decides at Northwood and worked at Vantage until August — and Vantage is already an LP in both of our vehicles. |
| ![Summary pane](docs/changelog/shots/n7/04-summary-acts-for.png) | **The summary pane carries it too.** Hale advises at Mercer & Bly and formerly advised Roos, where a do-not-approach instruction is on file. |
| ![Firms](docs/changelog/shots/n7/05-firms-tab.png) | **Firms & institutions** — the records that hold a mandate, a cheque band and a restriction. |

### Why this is not `network.edge`

An edge says two people have a relationship we might route through. **An affiliation says a
person acts for an organisation.** Conflating them means a CIO's employment reads as a warm
tie to their own employer, which is not a tie at all and would rank as one.

So affiliations are their own table, many-to-many and dated:

```
principal · decides · our contact · adviser · board · works there
```

**Capacity is recorded, not inferred from a title.** "Decides" means somebody confirmed
they sign. A head-of-investments nobody has asked is *works there*. Adeyemi at Brenner is
marked `inferred` from an annual report with the word on the row, because nobody has
confirmed it with him.

### Former roles stay visible

`ended_on` makes a row former, and former rows render greyed with a **former** flag rather
than disappearing. A route planned through a seat somebody left eighteen months ago is the
quiet way a relationship graph goes wrong, and hiding the leaving is what makes it quiet.

Two of the seeded rows exist to make that legible: Roos and Okonjo both left the Halvorsen
Institute board in December 2023, which is exactly the "shared affiliation, no evidence
they ever spoke" tier-C edge the route planner already refuses to trust.

### What the seed surfaced

**Priya Raman decides at Northwood and was an investment director at Vantage Partners until
31 August.** Vantage is an LP in *both* of our vehicles, has never been asked for a
reference, and Report 6 is blunt that under-asking existing LPs is the most common mistake
managers make. That route did not exist in the system an hour ago and it is the best one on
the Northwood page.

**Jonah Hale advises at Mercer & Bly and formerly advised the Roos Foundation.** The
do-not-approach instruction attaches to Delia Roos, not to the Mercer seat — so the second
row is marked former and restricted, and the first is untouched. Two capacities, one
person, and only one of them is blocked.

### The directory

Six tabs: everyone, people, firms & institutions, LPs, co-funders, connectors. The
person/firm split is the one that earns its place — **a firm is assessed and a person is
approached**, which is why a principal can read *not assessed* while their foundation is,
and why the org page says so and links across.

New fixture people so the firms are not empty: Gordon Whitcomb, Marisa Tessaro, Rosa
Iglesias, Curtis Adeyemi, Rachel Kaplan, Hannah Boyle. They are fixtures, not research.

**43 of 43 properties hold.**

---

## N8 — Feedback with a picture on it

**Shipped.** Pressing Feedback screenshots the page *before* the drawer opens, shows it in
the box with **Include screenshot** already ticked, and lets you draw on it. The annotated
PNG is filed beside the issue in the repository.

### Screenshots

| | |
|---|---|
| ![The box](docs/changelog/shots/n8/01-feedback-with-shot.png) | **The box, with the page in it.** Captured at the moment you pressed the button, before the drawer covered anything. Ticked by default; untick it and nothing is sent. |
| ![Annotating](docs/changelog/shots/n8/02-annotating.png) | **Clicking the image opens it full size to annotate.** Freehand, arrow, box, text; five colours; undo, clear, cancel, done. |
| ![Annotated](docs/changelog/shots/n8/03-annotated-thumb.png) | **Back in the box, marked *annotated*.** The annotated image is what gets filed — there is no second copy of the clean one. |
| ![On the issue](docs/changelog/shots/n8/04-issue-with-shot.png) | **Issue 0007, filed through the box while building this.** The picture is a PNG in `issues/attachments/`, so the complaint, the screenshot and the fix travel in one pull request. |

### How the capture works

`modern-screenshot` renders the DOM through an SVG `foreignObject`, which means the
browser's own engine draws it — inset shadows, gradients and the real fonts all survive. It
captures **the visible viewport**, not the whole document: a complaint is about what was on
screen, and four thousand pixels of a page you had scrolled past is noise.

Three details that were wrong first:

- **Fonts.** Without `await document.fonts.ready` the clone rendered in fallback metrics and
  every heading re-wrapped. A screenshot that does not match the screen is worse than no
  screenshot.
- **The button's own label.** It said *Capturing…* in the first captures, because the label
  changed before the snapshot. It stays *Feedback* now; the pulse beside it is marked
  `nocapture` and the capture filter drops it.
- **Scale.** Capped so a retina viewport produces a few megabytes rather than ten.

If the capture fails, the box says so and files the complaint anyway. A failed screenshot is
not a reason to lose what somebody was about to say.

### The attachment goes through the seam

`IssueDraft` gained an optional attachment; **the sink names the file**, so a caller cannot
choose a path. `FileIssueSink` writes `issues/attachments/NNNN-screenshot.png` and records
the relative path in the frontmatter *and* as a markdown image link, so the file reads
correctly in an editor and on GitHub. `GitHubIssueSink` will upload the same bytes somewhere
else without any caller changing.

The API accepts only a `data:image/png;base64,…` payload, keeps only the base64 body, and
caps the size. The serving route normalises the path, re-roots it under the issues
directory and serves nothing but PNGs.

### Two bugs found by building it

**The editor painted underneath the topbar.** It is rendered from inside the rail, and
`.rail` is `position: sticky` — which makes its own stacking context, so `z-index: 60` in
there still lost to the topbar's `z-index: 5`. A click on **Done** landed on the pane
toggle. The drawer and the editor are portalled to `<body>` now. A test found it; a person
would have found it with a mis-click.

**The first text label went missing from the saved image.** Clicking Done blurs the text
input, which commits the label — and the click handler in that same tick still saw the
pre-blur state. Marks live in a ref as well as in state, and the export reads the ref.

**43 of 43 properties hold.**

---

## N9 — The daily standup, and a calendar that keeps nothing

**Shipped.** Two pages under a new **Overview** section: a standup whose past days do not
move, and a compressed timeline across every vehicle with a per-vehicle version under each.

### Screenshots

| | |
|---|---|
| ![Standup](docs/changelog/shots/n9/01-standup-today.png) | **Today.** Every vehicle side by side with no total row, counts that are counts, this week, today, yesterday, and an ordered action list. The numbers are live and the bar says so. |
| ![Pinned](docs/changelog/shots/n9/02-standup-pinned.png) | **Saturday the 19th, pinned at 08:05.** Two vehicles, $56.0M hard, four approvals — the numbers as they read that morning. Opening it today does not recompute a thing. |
| ![Actions](docs/changelog/shots/n9/03-standup-actions.png) | **What to do, in order** — with why it is on the list, a *suggested* owner, what is blocking it, and the ticket kind it will need. |
| ![Calendar](docs/changelog/shots/n9/04-calendar-all.png) | **Sixteen weeks across every vehicle.** Bars are spans, diamonds are deadlines, dots are days. Today is the vertical line. |
| ![Per vehicle](docs/changelog/shots/n9/05-calendar-vehicle.png) | **The same calendar scoped to one vehicle**, at `/neurotech/calendar`, in the vehicle's own submenu. |

### A past day must read the way it read that morning

This is the whole design of the standup. A page that recalculates its numbers when you
open it in November is **a new opinion wearing an old date** — and it makes "we agreed this
on the 19th" unfalsifiable.

So `standup.day` carries a `metrics` snapshot, pinned when the day is captured, and a past
day never recomputes. The 18th says $52.0M hard; the 19th says $56.0M; today is live,
labelled *live*, and offers to be pinned. The label and the unit travel with each number,
so a day rendered next year still says what the number meant even if the code that
produced it has been rewritten.

Pinning is one-way: the update only writes where `captured_at is null`, so a second press
cannot quietly rewrite what the team met on. It is not a gated command — it records what
the numbers were; it does not send, promise or move anything.

Yesterday's list is shown as it was written. Nothing on it re-derives its status from
today's data, so an item that says *open* was open when that meeting ended.

### Three things the actions list refuses to do

- **It does not assign.** The owner column says *suggested* under every name, and nothing
  on the page writes to anybody's queue.
- **It names the gate.** Where an action would need an approval, the ticket kind is on the
  row — so the standup cannot propose something that would fail closed at the command.
- **It says why.** An action with no reason is a task somebody wrote down, and `why` is a
  not-null column.

Carrying is visible: an item on its third day says so in amber. Adjudicating the Roos
collision has been open since the 18th, and the page makes that uncomfortable on purpose.

### Linear and Affinity are mocked, and say so

Both panes are fixture rows in `standup.external`, labelled **mocked — no connector before
L13** in the card header and again in the cover line. Linear's custom-field schema is still
UNVERIFIED in all three design packages, which is one of the four open questions in
CLAUDE.md; Affinity is not attached. The panes show the shape the summary will take.

The outreach pane's right-hand column is **the consent ladder rung, not a CRM status** —
when Affinity is attached it will fill the same shape through the Connector seam and the
rung will still be what a piece of evidence justifies.

### The calendar keeps nothing

Not one row on the calendar is stored for it. Every bar is a dated record that already
exists somewhere else: a close target, a condition due date, an SPV seat from invite to
wire, an ask, a meeting, a ticket expiry, an accreditation letter, a funder invitation, a
sprint period. **A second copy of the plan is the copy that goes stale**, so `lib/timeline.ts`
reads each module's public API and merges.

The cost is stated on the page: **anything nobody has dated does not appear**, and an empty
lane means "nothing scheduled here" rather than "nothing happening here".

Bars are packed greedily into sub-rows so two never overlap — an unreadable gantt is a
decorative one. And per CLAUDE.md the chart has a **list equivalent, not a fallback**: a
bar three pixels wide is unreachable by keyboard, half of what is on the chart is a single
day, and the table carries every row including the thirteen outside the window.

**43 of 43 properties hold.** 58 routes return 200 from a cold start.

---

## N10 — Overview first, and the standup reads in order

**Shipped.** Four layout changes, no new capability.

| | |
|---|---|
| ![Overview section](docs/changelog/shots/n10/01-overview-section.png) | **Overview is the first section**, and Today, Approvals and Issues are in it. |
| ![Collapsed](docs/changelog/shots/n10/02-overview-collapsed.png) | **Collapsed, the approvals count moves to the heading** — a signal that disappears when you tidy the nav is a signal you stop trusting. |

### The rail

Today, Approvals and Issues used to float above every heading as three loose rows. They are
the same kind of entry as the standup and the calendar — *what is in front of me* — so they
are one **Overview** section at the top, and they collapse with everything else.

Collapsing it would have hidden the open-approvals count, so the pip moves to the section
heading when the section is closed.

### The standup reads in time order

- **Focus this week** is now a full-width row across the top, two columns of items rather
  than one narrow list.
- **Yesterday and today sit side by side underneath it**, left to right in the order they
  happened. Yesterday is read-only history; today is the one you are about to change.
- **Every vehicle, side by side** replaced eighteen KPI tiles with one row per vehicle —
  hard, soft, gap, and what the hard number rests on. Still no total row, and soft still
  has its own column because it is its own track.
- **Linear and recent outreach are equal width.** They are two views of the same question —
  what happened somewhere we are not looking — and one of them being wider implied a
  precedence that does not exist.

**43 of 43 properties hold.**

---

## N11 — The screenshot is now the screen

**Shipped.** The feedback capture asks the browser for the actual composited frame instead
of redrawing the page, and the annotator's toolbar sits on the image.

| | |
|---|---|
| ![Real capture](docs/changelog/shots/n11/01-real-capture.png) | **"Captured from your screen."** The box says which path it got, because the two are not equivalent and you should not have to guess. |
| ![Toolbar](docs/changelog/shots/n11/02-toolbar-on-the-image.png) | **The toolbar is directly above the image**, and **freehand is the default tool** — this circle was drawn without selecting anything. |
| ![Undo](docs/changelog/shots/n11/03-undo-redo.png) | **⌘Z and ⌘⇧Z work**, with buttons that disable when there is nothing to undo or redo. Esc cancels. |

### Redrawing the page was not the same as photographing it

You were right that it looked like a different rendering, because it was one.
`modern-screenshot` re-draws the DOM through an SVG `foreignObject` — the browser's own
engine, but a second pass. Text re-wraps at sub-pixel boundaries, form controls draw
differently, scrollbars vanish, and anything the compositor does at paint time is
approximated. **A feedback screenshot that is subtly not what the person saw is worse than
useless**: they describe the thing they saw and the picture quietly disagrees.

`getDisplayMedia` with `preferCurrentTab` asks the browser for the frames it actually
composited. One frame, then the track is stopped. That is the screen.

Two consequences, both real:

- **It needs a permission prompt.** That is the price of exact pixels, and it is worth it.
- **It cannot filter anything out.** The DOM path dropped elements marked `nocapture`; a
  screen capture takes what is on the screen, including the feedback button's own busy
  pulse. That is honest, so it stays.

The renderer remains as the fallback for a declined prompt or a browser without the API,
and the box labels which one produced the image — **"Captured from your screen"** or
**"Redrawn from the page"**, the latter with a sentence on what can differ.

The API needs the click's own user activation, so nothing may be awaited before it. The
busy flag is now set *after* the call rather than before.

### The annotator

- **The toolbar floats directly above the image.** It was pinned to the top of a full-screen
  overlay while the picture was centred below it — which is a toolbar nobody finds.
- **Freehand is the default.** It is what people reach for; every other tool is a refinement
  of "point at the thing".
- **⌘Z / Ctrl+Z undoes, ⌘⇧Z / Ctrl+Y redoes, Esc cancels.** A new mark ends the redo branch,
  the way every editor behaves, and **Clear is undoable** — it pushes everything onto the
  redo stack rather than destroying it. The shortcuts are suppressed while a label is being
  typed, where the browser's own undo belongs to the input.

The changelog screenshots above are themselves real screen captures: the shot browser
launches with tab capture auto-accepted, so this page shows the path it is describing.

---

## N12 — Breadcrumbs that match the rail

**Shipped.** Every breadcrumb in the app now names a section that actually exists, and the
middle ones are links.

| | |
|---|---|
| ![Deep crumb](docs/changelog/shots/n12/01-deep-crumb.png) | **`PLC Neurotech I / Funder–vehicle fit / Northwood Capital`** — three levels, and the middle two go back where they say. |
| ![Corpus](docs/changelog/shots/n12/02-crumb-hover.png) | **`Other / Research corpus / Every source document`.** The section, the page, the thing. |

### What was wrong

Twenty pages still said **Discover & qualify**, **Convert & coordinate**, **Create &
substantiate**, **Execute & govern** or **Learning & agent quality**. Those were the four
L-series umbrella sections, and the rail stopped having them at N1 — two months of
versions ago in changelog time. Every page carried its own hand-typed copy, so nothing
broke and nothing noticed.

**`href` on a breadcrumb was being thrown away.** `Page` mapped crumbs to `{label}` and
dropped the link, so `Issues / 0007 · …` looked like a path and behaved like text. Deep
pages were one-way.

### What it is now

Breadcrumbs mirror the rail, because the rail is the map:

```
Overview / Today · Approvals · Issues · Daily standup / <date> · Calendar
PL Capital / <vehicle> / <module> / <target>
PL R&D / Operations · PL Neuro · Grants rail
Orgs & people / <group or person>
Other / Research corpus / Every source document
Developer / Modules / <module>
```

A vehicle-scoped module gets its crumb from `moduleCrumbs(slug, vehicleName)`, which reads
the title straight out of `VEHICLE_MODULES`. **That is the fix, not the relabelling** — the
stale headings survived for two versions precisely because each page kept its own copy of
the nav's structure.

Section names come from one exported `SECTION` map for the same reason.

A crumb carries an `href` when it is a page and none when it is a section heading, so a
link goes somewhere and a non-link is honestly inert.

### One orphan found

`/calendar` — the sprint strip with the dead weeks — lost its rail entry when the new
Calendar went in at N9, and became reachable only from a timeline bar. It is back under
**Other**, where a page that computes working days against holidays belongs.

---

## N13 — A markdown editor in the feedback box

**Shipped.** The body of a piece of feedback is a markdown field with **Write** and
**Preview**, and you can drop or paste images into it.

| | |
|---|---|
| ![Write](docs/changelog/shots/n13/01-markdown-write.png) | **Write.** Monospace source, a small formatting bar, and the file it is going to become. |
| ![Preview](docs/changelog/shots/n13/02-markdown-preview.png) | **Preview**, rendered with the same component the issue page uses — so what you check before filing is what appears afterwards. |
| ![On the issue](docs/changelog/shots/n13/03-issue-rendered.png) | **Issue 0008, filed through the box while building this** — heading, bold, inline code, a list, and a dropped PNG sitting beside the issue in the repository. |

### Not a WYSIWYG surface, on purpose

The body of an issue is **a markdown file in this repository**, and somebody will open it
in an editor or read it in a diff. So the thing you type is the thing that gets stored, and
Preview is a second tab rather than the only view.

Both tabs use one renderer, `components/ui/Markdown.tsx`, shared with the issue page. **A
preview that can disagree with the page is a preview nobody checks twice** — and the issue
page was previously splitting the body on blank lines into paragraphs, so markdown someone
wrote was shown raw.

### Dropping an image

Drop or paste anywhere in the box. PNG, JPEG, GIF and WebP up to 8 MB; anything else is
refused with a line saying what was skipped and that the rest went in.

The interesting part is what goes into the text. The editor inserts
`![name](attachment:2)` — **a token, not a path**, because the sink owns the filenames.
Writing a path in the browser would mean a caller could choose where a file lands, and the
whole point of `IssueSink` is that it decides. `FileIssueSink` writes
`issues/attachments/NNNN-image-1.png`, rewrites the tokens, and stores the list in the
frontmatter:

```yaml
screenshot: attachments/0008-screenshot.png
attachments: [attachments/0008-screenshot.png, attachments/0008-image-1.png]
```

The screenshot stays out of the prose and renders in its own card; dropped images render
inline where they were written. The preview resolves `attachment:N` to the data URL still
sitting in the browser, so you see the picture before anything is filed.

One thing that needed care: the screenshot takes attachment slot 1 when the box is ticked,
so the body's tokens shift by one. The offset travels with the request rather than the
editor renumbering itself every time the checkbox moves — the text you wrote should not
change because you changed your mind about a screenshot.

**43 of 43 properties hold.**

---

## N14 — The strategy board

**Shipped.** A new module, `plays`, and a page per vehicle at `/<vehicle>/strategy`. It
answers a question no other screen does: **given everything we know, what is the next best
use of a week?**

| | |
|---|---|
| ![Assessment](docs/changelog/shots/n14/01-assessment.png) | **Where the raise stands** — nineteen readings across six groups, each with a verdict, what it means, and what it does not. |
| ![Board](docs/changelog/shots/n14/02-board.png) | **The option space, ranked.** Every play cites the finding that put it there, and plays whose lever answers a weak reading float to the top. |
| ![Compounding](docs/changelog/shots/n14/03-compounding.png) | **What compounds**, kept as a separate horizon rather than a low priority. |
| ![Commit](docs/changelog/shots/n14/04-commit.png) | **Propose and commit** in your own words. Lines, @handles and dates are pulled out and kept beside the text. |
| ![Assigned](docs/changelog/shots/n14/05-assigned.png) | **Assignment is a second press**, and it queues a Linear ticket. |

### Three disciplines in the schema

**1. A play must cite what put it on the list.** `because` is not null. An action with no
finding behind it is a task somebody thought of in the shower, and a board full of those is
a to-do list wearing a strategy's clothes. Every seeded play points at something real in
this database — a fit diagnosis, a failed gate, a claim the registry could not substantiate,
an edge nobody reviewed.

**2. Suggesting an owner is not assigning one.** A play stays `proposed` until a person
presses Assign, and that press is what writes the handoff. A board that assigned as it
ranked would fill somebody's week with whatever the arithmetic liked this morning.

**3. Long-horizon work is a separate horizon, not a low priority.** Ranked against
short-term work it always loses, which is exactly how compounding effort starves. When the
close is inside six weeks the section says so and tells you to read it as next-vehicle
planning — rather than hiding it, which is how it gets forgotten.

### The assessment reads other modules; it stores nothing

Nineteen readings, each from the module that owns the fact: pipeline depth and gap from
`pipeline`, blocker mix and evidence coverage from `fit`, ladder progress from `strategy`,
approved-and-current material from `content`, unanswered questions from `library`, edge
tiers and connector goodwill from `network` and `coordination`.

Each reading carries a verdict and **the levers that would move it** — which is what turns a
dashboard into a strategy. The board marks any play whose lever answers something that came
back weak.

### Leverage, and why all three inputs are on the row

```
leverage = (likelihood ÷ 5) × targets touched ÷ person-days
```

A rate: expected movement per day of somebody's life. It puts *"get the operating-company
marks independently verified"* — five days, four targets — above four separate emails,
which is the judgement the page exists to make.

It is shown as `3.20` with `4/5 · 0.5d · ×2` underneath, because **a score nobody can
decompose is a score nobody can argue with**, and arguing with it is the point. The
likelihood and the effort are judgement written by a person, and they are meant to be
challenged on the page rather than trusted.

### Eleven levers

`source · enrich · segment · materials · reach · route · convince · validate · convene ·
process · ask`

A closed set, so the board can be counted by lever and a weak reading can name the ones
that would move it. Each carries a sentence about what it is for — *convince* is useless
before somebody has stated an objection; *reach* is the slowest lever and the only one that
works while nobody is working.

### Linear, written down rather than pretended

Assigning a play or writing a commitment inserts a row in `plays.handoff` with the exact
payload that *would* be sent, `state = 'pending'`, and a note saying no connector is
attached. The strategy board renders that payload verbatim under a disclosure.

**That is the difference between a stub and a lie.** A stub that claimed to have created a
ticket would be indistinguishable from one that had, right up until somebody went looking
for it.

Every integration point is now in **`docs/14-linear-integration-points.md`**: the outbox,
the payload shape, the four things a connector must do, and the five decisions that are not
made yet — including the one CLAUDE.md already flags as unverified. It also names the trap:
`IssueSink` is where a complaint about *this software* goes and `plays.handoff` is where
work on the fundraise goes, they look similar, and merging them would put product bugs into
the fundraising board.

One small correctness fix on the way: `appendAudit` now takes an optional `Queryable`, so
an audit row is written inside the transaction it describes. An audit entry that can
survive a rollback of its own event is the one thing an append-only log must never do.

**43 of 43 properties hold.**

---

## N15 — Strategy for one funder

**Shipped.** `/<vehicle>/strategy/<target>` — the same board, aimed at one name, with the
thing in between: **what that funder needs before they can say yes.**

| | |
|---|---|
| ![State of play](docs/changelog/shots/n15/01-state-of-play.png) | **Where we actually are** — fit, rung, money, ties, who we deal with, last touch. None of it stored here. |
| ![Needs](docs/changelog/shots/n15/02-needs.png) | **What they need**, with what each need calls for. Northwood has three: two unmet, one nobody has established. |
| ![Options](docs/changelog/shots/n15/03-option-space.png) | **The option space**, ranked, plus whole-vehicle plays matched to this target's unmet needs. |
| ![Tessaro](docs/changelog/shots/n15/04-tessaro.png) | **Tessaro, for contrast.** They already understand the field — that need is *met* — and have never heard of us. Opposite work from Northwood. |

### The needs table is the whole point

Two funders can both read as *not convinced* and need completely opposite work. Northwood
has met us and wants somebody other than us confirming the marks. Tessaro has never heard
of us and already holds the thesis — their domain need is **met**, and nothing we could
write about neuroscience would help.

So `plays.need` sits between the diagnosis and the board:

```
know_domain · know_us · believe_returns · believe_access
validation · mechanics · timing · permission
```

Each row carries **what they need in their terms**, **how we know**, and a `met` that can
be true, false, or null — *nobody has established it* is a third state and the most common
one. Each kind carries what it calls for: validation needs a person they already trust
saying it, and nothing we write substitutes.

A play aimed at the wrong need converts nothing and costs exactly the same as one aimed at
the right one.

### Lateral moves are on the board on purpose

The highest-converting move is often not another email. An LP joined this fund after
finding a podcast episode, learning the domain and hearing the thesis argued — nobody sent
them anything. Another relationship was built by a seat at a workshop.

That is why `convene` and `reach` are levers rather than marketing activities, and why
Tessaro's board carries *prime with the podcast episode before the introduction* at
certainty **guess** — one instance is not a pattern, and the row says so rather than
quietly treating it as one.

### Whole-vehicle plays that would help here

Below the target's own board, the page lists vehicle-level plays whose lever answers one of
*this* target's unmet needs — matched through a small table from need kind to levers. Work
that fixes the same problem for several funders at once is usually the better week, and it
would otherwise never appear on a page about one name.

### What is not stored here

The fit reading, the rung, the money, the ties, the affiliations and the restriction all
come from the modules that own them. The page cannot disagree with the pages they come
from, and a do-not-approach instruction appears at the top of this one because it attaches
to the target rather than to a route.

**43 of 43 properties hold.**

---

## N16 — Warm introductions, weighted by influence

**Shipped.** The route planner now answers two questions in order: **may this route be
used**, and then, among the ones that may — **how much weight does it actually carry?**

| | |
|---|---|
| ![Routes](docs/changelog/shots/n16/01-routes-influence.png) | **Four paths to the same person**, ordered by verdict and then by influence. |
| ![Decomposition](docs/changelog/shots/n16/02-decomposition.png) | **Five components, each with its weight and its reason.** Duettmann scores 71: perfect on topic, moderate on standing with us, and the basis for every bar is a sentence rather than a number. |

### Influence runs after the rules, never instead of them

This is the important structural point. `planRoutes` decides admissibility — worst hop,
unreviewed tier C/D, restrictions, goodwill cap. **Only then** are the survivors scored.
Scoring first would let a well-connected name promote a path a restriction excludes, which
is the exact failure rule 8 exists to prevent.

Hale scores 39 and sorts last, below a route scoring 32, because he is excluded. The
ordering is `verdict, then influence` and it cannot be the other way round.

### Five components, from Report 6

| | what it measures | why |
|---|---|---|
| **Standing with us** | skin in the game | An LP with money already wired is making a different statement from an acquaintance. Larger cheque, louder — on a flattening curve, because *being* an LP is most of the signal. |
| **Standing with them** | what this target thinks of them | The scarce thing, and the one most systems substitute fame for. |
| **Credible on this topic** | domain match | **Credibility does not transfer.** Report 6 §2. |
| **Tie strength** | the inverted U | Moderate 1.0, weak 0.78, close 0.62. A close tie mostly knows the people we already know (Rajkumar et al., *Science* 377:6612). |
| **Goodwill left** | capacity and track record | The resource you cannot buy back. |

Every component renders with its 0–1 score, its weight, and **a sentence saying why** — not
"standing 4/5" but *"co-authored the memo Delia Roos publicly cited"*. The weights live in
`config.routeInfluence` and two of them are registered as guesses, so arguing with them is a
config change rather than a code change.

### `network.standing` — credibility is per domain

Anne Quill is the case that makes the point: **crypto 4/5, neuro 1/5.** A strong name in
the wrong field is a weak route, and a single "influence" scalar would have ranked her as a
good way into a neuroscience foundation.

Five domains — neuro, crypto, allocators, science, operating — and each vehicle kind
declares which ones it is judged on. Every row carries a basis, because a strength with no
basis is a number somebody liked.

### A person and the institution they sign for

Duettmann initially scored 46 with *"nothing on file about what this target thinks of
them"* — while the record plainly said Roos publicly cited her memo. That link is recorded
against **Roos Foundation**; the route target is **Delia Roos**, the person.

So the standing lookup now widens through `identity.affiliation`: a link on the foundation
is evidence about its sole trustee. It counts at 0.9 of a direct reading and the basis says
which record it came from. Duettmann went to 71.

### The ask to make

Each route carries a composed, **bounded** ask, because Report 6 is clear that "can you
introduce me" converts worse than a specific request somebody can answer in two sentences.
An LP gets asked to say why *they* committed; a topic authority gets asked for a forward
with the paragraph already written.

**43 of 43 properties hold.**

---

## N17 — How we could find out what we do not know

**Shipped.** An enrichment catalogue at `/research/enrichment`, and a section on every
target's strategy page listing what is missing about *them* and what would close it.

| | |
|---|---|
| ![Gaps](docs/changelog/shots/n17/01-gaps.png) | **What is missing across the universe**, derived from the fit board rather than stored. A guess and an unanswered gate are different failures, and both are labelled. |
| ![Catalogue](docs/changelog/shots/n17/02-catalogue.png) | **Seventeen methods in seven kinds** — buy, integrate, query, ask, observe, interview, infer — each with what it yields, its cost, and the line it must not cross. |
| ![Rejected](docs/changelog/shots/n17/03-rejected.png) | **A rejected method stays on the page**, with the reason. |
| ![Per target](docs/changelog/shots/n17/04-target-gaps.png) | **Northwood's ten open fields**, each matched to the methods that would close it. |

### Three columns a list of tools would not have

**`produces_tier` — the ceiling, not the hope.** A scraped follow graph is tier D however
much of it there is. A 990-PF grant history is tier A because it is a filing. Recording the
ceiling is what stops a bulk source being mistaken for proof six months later, when nobody
remembers where it came from.

**`blocked_by` — in a sentence.** Affinity is listed and blocked: no connector before L13,
and the plan tier decides whether it is Data Share or polling, which is CLAUDE.md's open
question 1. A method nobody can run is still worth listing, because **the blocker is often
the cheaper thing to fix.**

**`limits` — the line.** Model-assisted search carries the one that matters in this raise:
*never infer health information about a person or their family; record only what somebody
has publicly stated about their own interests, and attribute it.* Report 4 §6.2. In a
neurotech context that drift is one careless sentence away, so it is written on the row
rather than in a policy document nobody opens.

### A rejected method stays on the page

Bulk people data from LinkedIn is listed, marked **rejected**, with the reason: there is no
sanctioned API at the tier we would need and scraping breaches their terms.

Recording the refusal is the point. Delete it and somebody proposes it again in six months
thinking it was an oversight, and the reasoning gets reconstructed from memory. It is also
excluded from the per-target suggestions, because offering a rejected method as *what would
close this* is how a decision gets quietly relitigated by somebody who never saw why it was
made.

### The gaps are derived

A dimension graded on a guess, a dimension inferred on something that carries weight, a
hard gate nobody answered. Computed from the fit board every time the page loads, never
stored — a second copy of what we do not know is the copy that goes stale.

Which also means the page can say **"no method covers this"**, and that is the most useful
row on it: a field nothing in the catalogue can fill is a field that has to be asked.

### The seven kinds are ordered by what they actually cost

`ask` and `interview` come first because they are free, produce tier A, and are the ones
people skip. *Ask the connector what they actually know* takes fifteen minutes, prevents
the reluctant-connector failure, and is skipped constantly. *The four questions for a first
meeting* fills six dimensions at once and is available exactly once per target.

Then the things that cost money, then the things that cost engineering, and `infer` last —
free, instant, and never better than tier C.

**43 of 43 properties hold.**

---

## N18 — No permission prompt, and an editor you write in

**Shipped.** Opening the feedback box takes no screenshot and shows no dialog. You ask for
one, with two buttons. And the body is a rich editor whose source is one click away.

| | |
|---|---|
| ![No screenshot yet](docs/changelog/shots/n18/01-no-screenshot-yet.png) | **The box opens instantly.** *Add a screenshot: Whole page · Pick a part.* Optional, and the complaint files without one. |
| ![Rich](docs/changelog/shots/n18/02-rich-editor.png) | **Rich by default.** Headings, bold, inline code and lists, stored as markdown. |
| ![Source](docs/changelog/shots/n18/03-source-view.png) | **Markdown, one click away** — and it is the document rather than an export of it. |
| ![Region](docs/changelog/shots/n18/04-region-picker.png) | **Pick a part.** The drawer hides so you can see the page you are drawing a box on. |
| ![Cropped](docs/changelog/shots/n18/05-cropped.png) | **Just that region**, in the box, ready to annotate. |

### Redaction beat fidelity

N11 switched to `getDisplayMedia` for exact pixels. You hit the permission dialog, which is
the cost I had waved through — and it is not a one-off cost, it is **every complaint,
before anybody has typed a word.**

Worse, exact pixels cannot be redacted. By the time the compositor is finished they are
just pixels, so the feedback panel is in its own screenshot and anything sensitive on
screen goes with it.

The DOM renderer can redact: anything marked `nocapture` is dropped. And the N11 fix —
waiting for `document.fonts.ready` before cloning — closed most of the fidelity gap that
sent me to `getDisplayMedia` in the first place. So **the renderer is the default, with no
prompt**, and the exact-pixels path stays in `lib/capture.ts` as `capturePageExact` for
anybody who wants it and will accept the dialog.

### Two buttons, and nothing on open

```
Add a screenshot:  [▢ Whole page]  [⌖ Pick a part]
```

*Pick a part* hides the drawer, puts a crosshair overlay on the live page, and lets you drag
a rectangle — Escape cancels, and a drag under eight pixels counts as a mis-click rather
than an empty selection. The page is then drawn and **cropped to the rectangle**, because a
region usually cuts across several elements and the honest thing is to draw the page and
cut the rectangle out of it.

The drawer hides during both, which is now belt and braces: the `nocapture` filter already
drops it, and hiding it also means you can see what you are selecting.

### An editor rather than a textarea

TipTap with `tiptap-markdown`. **Rich is the default**, because most feedback is prose and
asking somebody to remember asterisks in order to file a bug is a tax on the complaint.

**Markdown is one click away and it is the real thing.** The body of an issue is a file in
this repository and somebody will read it in a diff, so the source view is the document
rather than an export of it. A round trip through both views is lossless — heading, bold,
inline code and list all survive in each direction, which is checked rather than assumed.

Images keep the `attachment:N` discipline from N13. The rich view swaps those tokens for
the picture while you type and swaps them back when it serialises, so the stored body never
contains a data URL and **the sink still owns every filename.**

**43 of 43 properties hold.** 48 routes return 200 from a cold start.

---

## N19 — The capture that never came back

**Shipped.** The hang is fixed, the automatic screenshot is back, screenshots are a list,
and the text tool has a floating field with size, weight and colour.

| | |
|---|---|
| ![Seeded](docs/changelog/shots/n19/01-seeded-and-buttons.png) | **One screenshot already there** when the box opens, with **Mis-aligned?** beside it and two buttons to retake. |
| ![Two](docs/changelog/shots/n19/02-two-screenshots.png) | **Screenshots add up.** A whole-page redraw and a picked region, each with its own × and its own Annotate. |
| ![Text tool](docs/changelog/shots/n19/03-text-tool.png) | **The label looks like the label.** Same colour, same weight, same size on screen as the one about to be drawn. |
| ![Placed](docs/changelog/shots/n19/04-placed-label.png) | **Placed, at size L, with an arrow.** |

### The bug

`/dev/changelog` has a hundred and twenty-five screenshots on one page. `domToPng` inlines
every image it can reach, so it did not fail there — **it ran until nobody was waiting any
more.** The drawer hides itself during a capture so it stays out of its own picture, and
that hidden state was only ever cleared by a promise that never resolved.

Three fixes, and the first one is the one that matters:

1. **Every capture has a hard ceiling and a `finally`.** Twelve seconds, then it gives up.
   Anything that can hang has to be able to give up, and the panel must never be left
   hidden behind one. The box says so rather than sitting there.
2. **Images outside the viewport are skipped.** They are not in the picture and inlining
   one costs the same as inlining one that is. This is what made the changelog page
   uncapturable rather than merely slow.
3. **A capture that comes back empty is reported.** Declined, unsupported, or too slow —
   the complaint still files, and the box says what happened.

### The automatic screenshot is back, and the buttons do something different

Taking nothing on open made the buttons easy to miss, and you were right that it is the
wrong default. So:

- **On open**, the redraw runs. No dialog, the panel redacted out of it, one screenshot
  already in the box.
- **The buttons retake with the browser's own screen capture** — exact pixels, and a
  permission prompt. That is the trade, and it is now something somebody chooses rather
  than something that happens to them.

Beside every automatic capture sits **Mis-aligned?**, which on hover explains that the
redraw can get spacing, wrapping or a form control subtly wrong, and that the buttons below
fix it with a real capture that will ask permission and cannot leave the panel out.

### Screenshots are a list

They **add**; they never replace. A second shot of a different part of the page is a second
piece of evidence, and one somebody has already annotated must not vanish because they
pressed the button again. Each carries its own × and its own annotate button, and the
frontmatter grew from `screenshot:` to `screenshots: [...]` — the singular spelling is still
read, so issues 0007 and 0008 still render.

### A text tool you can see

The label now floats with its own bar: **S · M · L · XL**, a bold toggle, the colour swatches
and **Place**. The field renders at the size, weight and colour of the label it is about to
become, because a text tool you have to imagine is a text tool people place twice.

Escape inside the field cancels the label; Escape outside it still closes the editor.

### Also

`npm run dev` binds `0.0.0.0`, so a phone or another laptop on the same network can open it
— `allowedDevOrigins` lists the private ranges, which is the only place this is ever served
from.

**43 of 43 properties hold.**

---

## N20 — Screenshots that use the window

**Shipped.** Changelog images grow with the window and open full size on click, in both
renderers.

![Wide](docs/changelog/shots/n20/01-changelog-wide.png)

The prose stays at a readable measure — about 66 characters — because that is what makes
text readable. **The screenshots do not**, because the reason somebody widens the window is
to see the screenshot, and a picture pinned to the width of a paragraph defeats that.

So figures break out of the prose column to `min(1560px, 100vw − 40px)`, centred on the
same axis. At 1680px the image is 1560 wide beside a 594-wide paragraph; at 900px it is 860
wide with no horizontal scroll.

Clicking opens the original. In the app that is a new tab; on the standalone page it is a
lightbox in twenty lines of vanilla JavaScript rather than a dependency — **that page has
to open from a `file://` URL with nothing installed**, which is most of the reason it exists.

The web-sized copies went from 1400px to 2000px across. A 1560-wide slot showing a
1400-wide image is a soft image, and the resize was tuned before the images had room.

---

## N21 — Data enrichment as a priority queue

**Shipped.** Renamed, moved under **Orgs & people**, and rebuilt: one sortable table
instead of seven, a ranking you can re-weight on the page, and a queue with a limit.

| | |
|---|---|
| ![Queue and table](docs/changelog/shots/n21/01-queue-and-table.png) | **The queue above the table.** Human and agent limits, and what the gaps actually are. |
| ![Weights](docs/changelog/shots/n21/02-weights.png) | **Six sliders**, each with what raising it does. Every default is a guess about this team at this moment, which is why they are on the page. |
| ![Filters](docs/changelog/shots/n21/03-filters.png) | **Filter and sort.** *Agent can run it* is the filter that matters most. |
| ![Chosen](docs/changelog/shots/n21/04-chosen.png) | **Chosen, and counted.** The queue says 1 of 5, and the row says who chose it. |

### Seven tables could not answer the question

The catalogue was grouped by kind, which made *"what should we do next?"* — the only
question anybody actually has — impossible to answer without reading all seven. Kind is a
column now.

### Cost is three numbers, because time is not free

`effort_days` conflated a person-day with an hour of model time, and those behave nothing
alike. The row shows all three:

```
3.5   ← the rating
$0 · 0.25d you · 2h AI
```

Money, person-days and model-hours land in one unit through weights on the page. **A
person-day is the scarcest thing this team has**; an AI hour is nearly free and still not
free, because somebody reads the output and decides whether to believe it.

**Nothing is free, and the floor says so.** A question asked inside a meeting you were
already having still costs the decision to ask it and the minutes spent writing down the
answer. Without a floor, anything recorded as zero divides by nothing and lands on top with
a number nobody can read — which is how a ranking stops being read at all.

### Priority is value ÷ cost, with a thumb on the scale

Value is **how many open gaps it would close, weighted by the best evidence tier it can
justify**. Four gaps at tier D is worth less than two at tier A, and a number that ignored
the tier would rank the bulk scraper first every single time.

The **bias toward agent-run methods** defaults to 1.4× and is a slider. It is a bet on
*repeatability* rather than on magic: a search an agent can run is worth more than its cost
suggests, because it can be run again next quarter on a universe twice the size.

The result reads the way the reports argue it should: *ask them directly what they have
backed* (14.0) and *the four questions for a first meeting* (12.0) sit above the paid
database (2.8), because they are nearly free and produce tier A.

### The queue has a limit because finishing beats starting

Five human-run, twelve agent-run, both adjustable. Choosing something counts against its
limit; past it, everything else reads **hold** with the reason on its own row. Nothing is
hard-blocked — the counts just stop pretending. The agent limit is larger because agents
wait rather than work, and it is still a limit because **every run has to be read**.

That last point is why `docs/14-linear-integration-points.md` grew a section proposing **a
dedicated Linear board for agent runs**: one issue per run, the work envelope in the
description, a *needs review* column that is a real queue with real people in it, and a
thread where "this looks wrong because…" can live. Three things stay on our side — the
envelope the policy check reads, acceptance (`acceptRun` takes a user id and an idempotency
key; closing an issue is a signal, not an authorisation), and the config and input hashes,
because a tracker cannot promise that editing a prompt does not retroactively change what a
completed run meant.

### Also

The scorer moved to `modules/research/scoring.ts` with no database import, so the table
re-ranks in the browser as the sliders move. **A scoring rule that only runs on the server
is a rule nobody plays with**, and playing with it is how anyone finds out whether they
believe it.

**43 of 43 properties hold.**

---

## N22 — Routes: who to route to, and who carries it

**Shipped.** The target list became a working column, the influence bars got their reasons
back beside them, and proposing an ask now names an owner.

| | |
|---|---|
| ![Picker and bars](docs/changelog/shots/n22/01-picker-and-bars.png) | **Score in the list**, sorted by it, with the records around each name underneath. Both side panes are narrower. |
| ![Search](docs/changelog/shots/n22/02-search.png) | **Typing "Kaplan"** finds the trust *and* the person who signs for it. |
| ![Filter](docs/changelog/shots/n22/03-score-filter.png) | **Score ≥ 75**, in the browser, instantly. |
| ![Propose](docs/changelog/shots/n22/04-propose.png) | **Who carries it**, with why that person is suggested and where the ask actually goes. |

### The list you scan before spending a week

It used to be a name and a type, which is not enough to choose with. There is **no point
finding a beautiful route to somebody nobody has qualified**, so the row carries the fit
score, sorts by it, and filters on it.

Search covers the name *and the records around it* — the organisations a person acts for,
the people who act for an organisation. Typing "Kaplan" turns up the trust and Rachel
Kaplan. It runs in the browser, because this list is small and a round trip per keystroke
would make it feel slower than it is.

**A person borrows their organisation's score, marked with an asterisk.** You route to a
person; the fit reading sits on the institution they sign for. Showing them as unscored
would have been true and useless, and showing the number unmarked would have been a lie.

Both side columns are narrower — the queue from 330 to 258, the inspector from 328 to 296
— because the middle pane is where the work is.

### Bars and reasons, on the same line

Five bars in one block with five sentences underneath asks the reader to hold five numbers
in their head and then match them up, which nobody does. It is one row per component now:
label, bar, number with its weight, and the reason, across.

**Goodwill left** is one of the five, so it gets a bar like everything else — a connector at
their cap is not a route, whatever the graph says.

### "Where does that go? Who owns it?"

Both were fair questions the page did not answer.

**Who owns it** is a field now, with a suggestion and the reason for it: whoever already
carries an ask through this connector — *because a second person asking the same favour
spends the relationship twice* — then whoever owns an ask on this target, then you. The
reason is shown, because a suggestion with no reason is a default in disguise.

**Where it goes** is stated under the button: it writes the ask, runs the four guards, and
opens an `INTRO_ASK` ticket in Approvals with its scope. **Nobody is contacted until that
ticket is approved**, and the owner is who the approval authorises to make it.

`ProposeAskCommand` gained an `ownerId` that defaults to the proposer. An ask with no owner
is an ask that waits for somebody to feel responsible.

**43 of 43 properties hold.**

---

## N23 — Bars under their labels, screenshots in the page

**Shipped.** Two things that were wasting space: the influence bars, and the changelog's
habit of throwing you into a new window.

| | |
|---|---|
| ![Influence bars](docs/changelog/shots/n23/01-bars.png) | **Label, bar under it, reason beside both.** Same five components, about 200px less height. |
| ![Lightbox](docs/changelog/shots/n23/03-lightbox.png) | **A screenshot expands here.** Esc, the ×, or a click anywhere closes it. |

### The reason is the part with words in it

The four-column row — label, bar, number, reason — gave the reason a 150px column and the
bar a 76px one. So every row was as tall as its sentence needed, with a column of empty
space sitting under the bar, and the sentence itself came out five words wide.

The label and the bar are now stacked in one 190px column with the number on the label's
line, and the reason takes the rest. **Nothing was cut** — the same five components, the
same numbers, the same weights. The block is about 200px shorter and the sentences read at
a normal width.

### Clicking a screenshot no longer leaves the page

It opened the PNG in a new tab, which means losing your place in a page of 138 images to
look at one of them. A click now expands it in place. **Esc closes it, so does the ×, so
does a click anywhere** — three ways out, because a dialog with one is a trap if you miss it.

⌘-click and middle-click still open the file in a tab: the anchor is still an anchor, and
only a plain left click is intercepted. The overlay is portalled to `<body>`, because the
rail is `position: sticky` and therefore its own stacking context — an overlay rendered
inside it paints under the topbar, which is the same bug the annotation editor hit.

The standalone build log already worked this way. The in-app page now matches it.

**43 of 43 properties hold.** Verified in a browser: click opens, Esc closes, the × closes,
the backdrop closes, and no tab is opened.

---

## N24 — The sentences get the whole card

**Shipped.** The reason column was still four words wide, because a 118px verdict column
was reserving space down the entire height of the card.

| | |
|---|---|
| ![Full width](docs/changelog/shots/n24/01-wide.png) | **The influence block spans the verdict column now.** Two lines a reason instead of five. |
| ![Narrow window](docs/changelog/shots/n24/02-narrow.png) | **In a small window** the reason goes under its bar rather than beside it. |

### A column reserved for four short lines

`Recommend · 71 influence · 2 of 3 asks · Connector · 3 carried` is about 80px of content.
The column holding it is 118px wide and, being a flex child, it was that wide for the whole
route — past the influence table, past the ask, past the propose form. Everything with
words in it was squeezed into what was left.

The card is a grid now: tier, path and verdict on the first row, and **the influence table,
the ask and the propose form on a second row spanning to the card's right edge**. The
reasons went from five lines to two.

### Narrow windows get the stacked form

The three panes are fixed widths, so the middle one can be about 300px on a 1180px window,
and a reason beside its bar is then four words a line. Below **560px of card**, the reason
goes under the bar and takes the whole row.

It is a container query, not a media query: the window is not what is squeezing that
column, the two side panes are. Measuring the thing that is actually short is the only
version of this that stays correct when the panes change width again.

**43 of 43 properties hold.** `npm run shots` takes a `width` now, so the narrow layout is
captured by the same script as everything else rather than by hand.

---

## N25 — Data enrichment: numbers on one line, prose on the next

**Shipped.** Same complaint as N24, a different table. The method's description was living in
a 150px column while four numeric columns sat half empty beside it.

| | |
|---|---|
| ![Two-row rows](docs/changelog/shots/n25/01-rows.png) | **One line of numbers, one line of prose.** Rows are about half as tall and the sentences are sentences. |
| ![Sorted by cost](docs/changelog/shots/n25/02-sorted-by-cost.png) | **Sorted by cost.** The sub-labels under each number stay on one line now. |

### A row is two rows

Every method carries a number set — value, cost, priority — and two or three sentences
explaining itself. Those want opposite things: the numbers want narrow aligned columns, the
prose wants width. Sharing one row, each gets the wrong one.

So each method is two table rows now. The first is the numbers, with the name, the kind and
the verdict. The second spans the whole table and holds the chips, the description, the cost
basis, the limits and the reason for the verdict. **The row is roughly half as tall as it
was** and nothing was dropped.

The number sub-labels — `12 gaps · tier A`, `$1,200 · 0.5d you · 6h AI`, `value ÷ cost × 1.4`
— no longer wrap; their columns were widened to fit them on one line, which is cheap because
they are the only things in those columns.

### A message that disagreed with the counter above it

Holding a method said *"The human queue is full."* while the counter at the top of the page
read **0 of 5**. Both were rendered from the same state. The queue was not full — five
higher-priority methods simply rank above it, which is a different sentence:

> 5 human-run methods rank above it, which is the whole queue. Finish those before starting this.

A page that says two contradictory things about the same number teaches you to trust neither.

**43 of 43 properties hold.**

---

## N26 — Who runs it, said on every row

**Shipped.** One side was labelled and the other was silent.

| | |
|---|---|
| ![Both labelled](docs/changelog/shots/n26/01-both-labelled.png) | **Every method now says who runs it.** Clay for a person, green for an agent. |
| ![A person runs it](docs/changelog/shots/n26/02-person-runs-it.png) | **A person runs it** — a filter as well as a label. |
| ![Agent runs it](docs/changelog/shots/n26/03-agent-runs-it.png) | **Agent runs it.** Cheap, repeatable, and still needs reading. |
| ![The queue](docs/changelog/shots/n26/04-queue.png) | **The two queues** carry the same two colours. |

### An absent label is not a label

`agent can run it` appeared on the methods an agent can run, and nothing appeared on the
rest. That reads as an oversight — a row somebody forgot to tag — rather than as *a person
does this one*. Both cases are labelled now: **a person runs it** and **agent runs it**.

**Clay for a person, green for an agent**, because the agent is the faster one and person-time
is the scarce thing being spent. The words say it too — the colour is a second reading of the
label, never the only one, which is why these are not two shades of the same dot.

The two queue counters carry the same pair: *Human · the slow one*, *Agent · the fast one*.
Same colours, same meaning, so the row and the counter teach each other.

`A person runs it` is also a filter now, beside `Agent runs it`. Asking "what does this cost
me personally this week" was previously only answerable by reading every row.

### While in there

A rejected method printed its reason twice — once as **Blocked.** and again as the verdict's
reason, from the same string. One finding, printed once.

**43 of 43 properties hold.**

---

## N27 — A pass through the feedback queue

**Shipped.** Two issues off the board: one because the feature landed three versions ago and
nobody closed the file, one because it was a ten-minute fix that had been sitting at P2.

| | |
|---|---|
| ![Issue filters](docs/changelog/shots/n27/01-issue-filters.png) | **Filter by status, priority and kind.** Defaults to hiding `done`, and says how many rows that hid. |

**0001 — the issues page has no filter.** It does now: status, priority and kind, in the
browser, because the list is one markdown file per issue and a round trip per chip would
cost more than the filtering. It defaults to **not done**, since the open queue is the
question people arrive with, and the header says `N shown · M filtered out · K on file` so a
filter can never quietly become a smaller world.

**0008 — drag-and-drop images into the feedback body.** Closed as already done in N18. The
attachments on that issue were themselves filed by dropping them into the box, which is a
reasonable standard of proof.

The remaining open issues are real work: **0007** wants the fit score to say which of the
eighteen readings moved it, which needs assessment history nothing currently keeps. **0005**
wants cash arriving to be a recorded event rather than a column. **0002**, **0004** and
**0006** are still worth the argument they will start.

**43 of 43 properties hold.**


---

## N28 — The factory floor

**Shipped.** One view of everything trying to happen, drawn five different ways, for every
vehicle and for all of PL Capital at once.

| | |
|---|---|
| ![The line](docs/changelog/shots/n28/01-the-line.png) | **The line.** Seven stations, work sitting in each, lanes by vehicle. |
| ![The load](docs/changelog/shots/n28/02-the-load.png) | **The load.** Who is carrying what, and who is over their limit. |
| ![The flow](docs/changelog/shots/n28/03-the-flow.png) | **The flow.** Where work stops moving, with the drop-off drawn. |
| ![The clock](docs/changelog/shots/n28/04-the-clock.png) | **The clock.** The fortnight ahead, and the pile with no date on it. |
| ![The room](docs/changelog/shots/n28/05-the-room.png) | **The room.** Instruments. The one you could read from across a room. |
| ![One vehicle](docs/changelog/shots/n28/06-one-vehicle.png) | **Per vehicle**, lanes become people instead of raises. |

### Five, on purpose

They are experiments, and they are not variations on a theme. Each answers a question the
other four answer badly, and the tab strip states the question rather than naming a chart
type, because **a picture nobody can state the question for is decoration**.

- **The line** — the literal factory. Seven columns: the six rungs of the consent ladder plus
  one in front of them for work that is sourced and has no rung yet. Lanes are vehicles
  across PL Capital and people inside one vehicle, because at that point the question stops
  being "which raise" and starts being "who".
- **The load** — stage ignored entirely, sorted by person. A column per owner, hard and soft
  side by side and never stacked. It marks anyone over six things in flight, and counts
  what is stalled underneath, because a person holding eleven stalled items is not busy,
  they are stuck, and a list makes those look identical.
- **The flow** — the ladder as a funnel with the drop-off drawn as a pool hanging under each
  station. Currently 20 → 10 → 5 → 2, then a disconnected 10 and 8 at the end, which the
  page explains rather than hides: those closed before any of this existed and their early
  rungs were never written down.
- **The clock** — three weeks forward, one mark per dated record, and beside it the count of
  work with **no date at all**. That number is the point of the view. Late things get
  noticed; unscheduled things do not.
- **The room** — a card per vehicle, the same eight numbers on each. Nothing here encodes
  anything a number could not, which is why it is the one that is hardest to misread.

### One vocabulary across all five

Switching tabs must not mean relearning the colours, so the encoding is shared and stated in
the inspector: **size is money at stake** on a square-root scale, **fill strength is how
recently anything was recorded**, and **hue is reserved for exceptions** — clay for blocked,
amber for dated-soon, green for cash in the bank. A floor with nothing wrong on it has almost
no colour on it. Every one of those also appears as a word or a glyph on the mark, because
colour is never the only signal.

Two rules shaped it more than any design decision:

- **An item nobody has a number for is drawn at the minimum width with a `?`.** Nine of the
  thirty-three are in that state. Sizing them by a guess would have made the picture prettier
  and the page a liar.
- **Hard and soft never share a bar, a stack or a total.** The load view puts them in two
  columns rather than stacking them, because a stack is a blended total drawn instead of
  written, and it is the same lie either way.

### The list is not a fallback

Under every tab is the same floor as a sortable table, where every dimension the canvases
encode is a column in words — including the *basis* for each one. `$18M · hard · Signed:
sub-doc:brenner-v2`. `69d · Wired · cash landed 69 days ago, finished, not stalled`. It is
the version you can copy into an email, and it is the version that survives being wrong
about colour.

### Nothing is stored

`lib/floor.ts` reads eleven modules at request time and keeps nothing. A wall display with
its own copy of the state is a wall display that disagrees with the pages people act on. The
cost is stated on the page: anything nobody wrote down is not on the floor, and **the floor
looking calm is not evidence that it is**.

### More synthetic work to look at

The earlier seeds are teaching fixtures — six pursuits, each making one rule visible. That is
too few to design a wall display against, so `lib/seed-floor.ts` adds fourteen more pursuits
across every vehicle, eight scheduled meetings, four agent runs in flight and two more
capital-pool budgets. Its dates are **relative to when the database is seeded**, unlike every
other seed here: a floor whose newest record is four months old looks calm, and calm is the
one reading these views must never give by accident.

**43 of 43 properties hold** on the richer data, including the conserved capital pool and
every soft/hard separation.

---

## N29 — Five more, about the space rather than the state

**Shipped.** The first five views draw what is happening. These five draw the ground it
happens on, the machine it moves through, the moves available and what they cost.

| | |
|---|---|
| ![The map](docs/changelog/shots/n29/01-the-map.png) | **The map.** Every name placed by capacity and fit — and 22 of 28 held back in the fog, because nobody has scored them. |
| ![The plant](docs/changelog/shots/n29/02-the-plant.png) | **The plant.** The whole machine with a gauge at every station and a valve at every approval. |
| ![The moves](docs/changelog/shots/n29/03-the-moves.png) | **The moves.** A build menu: what each move needs, costs and buys, locked entries included. |
| ![The grid](docs/changelog/shots/n29/04-the-grid.png) | **The grid.** Targets against levers. A row with no open cell is the finding. |
| ![The economy](docs/changelog/shots/n29/05-the-economy.png) | **The economy.** What is about to run out. It is almost never money. |

### The fog is the feature

The map places every name on two axes from the selection rubric — **can they write it** and
**does the mandate match** — with the cheque as the size. Six of twenty-eight can be placed.
The other twenty-two sit in a strip underneath, labelled, because placing an unscored name
anywhere at all would turn *"we have not looked"* into *"we looked and it was mediocre"*.
Those are opposite facts and an RTS minimap already has the right idiom for the difference.

Inside the fog, `researched` and `name only` are drawn apart too. One is a name with a firm
profile behind it; the other is a row in a list.

### Gauges at every station, valves between them

The plant is the assembly line end to end: eight stations, and under each one what is sitting
in it, what arrived in the last month, what left, the median dwell, and what is jammed.
Between stations sit the **valves** — the approval kind that gates that step and how many
tickets are open on it. A valve with nothing in it is not a bottleneck; it is a closed valve
nobody has asked to open.

**Dwell is the honest half of a cycle time**, and the view says so: it measures the gap
between two evidence records on one pursuit, so it is how long *we* took to learn the next
thing, not how long they took to decide. A station with a long dwell and nothing jammed is
usually a recording habit.

### A build menu with the locked entries left in

Nine moves in four families, left to right in prerequisite order. Each carries what it
**needs**, what it **costs**, what it **buys**, how many things it is available on right
now, and whether a person or an agent runs it — the same clay-and-green pair as the
enrichment table. Gated moves say so.

The one with no prerequisite at all is *enrich a name we have not scored*, available on 22.
That is the same 22 as the fog, seen from the other end.

### Blocked and not-yet are different colours

The grid is targets against eight levers — route, ask, meet, material, answer, structure,
number, close — with four states per cell. It exists to separate **blocked** from **not
yet**: a lever we are forbidden to pull and one that is simply out of reach look identical
on a status list and demand opposite responses. A row with no open cell at all is not a
target going badly; it is a target we have run out of legal moves on, which is a different
conversation with a different person.

### What actually runs out

Person-time first: **11 items in flight against a working limit of six**, and the card says
the six is a guess rather than a measurement. Then connector goodwill, open approvals, the
agent correction budget, materials that go stale when a claim underneath them moves, and the
conserved capital pool — where two actors are already over the budget they told us they had,
counted across every vehicle.

Every cap names its source, and the ones marked GUESS in `config/deployment.ts` say so on the
card. A capacity line nobody can source gets planned around anyway.

### Same vocabulary, second projection

`lib/board.ts` takes the floor as an input rather than rebuilding it — one projection of
state, two readings. Size, fill and hue mean exactly what they mean on the first five tabs,
and the tab strip is grouped so it is clear which question each half answers.

**43 of 43 properties hold.**
