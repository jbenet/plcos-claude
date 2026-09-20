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
