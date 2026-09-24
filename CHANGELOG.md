# Changelog

One entry per stage of the L-series. Each entry says what landed, what was deliberately
left out, and where I disagreed with the plan. Screenshots live in
`docs/changelog/shots/<stage>/`, as 2000 px WebP since N40 (CLAUDE.md, *Working notes*).

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
| ![Today](docs/changelog/shots/l1/01-today.webp) | **Today.** The shell: dark rail with four umbrella sections, breadcrumb with a visible last-sync line, KPI strip, and the empty approval queue rendered as a designed state rather than a blank panel. |
| ![Approvals](docs/changelog/shots/l1/02-approvals.webp) | **Approvals.** The five ticket kinds and what each will gate, plus the five-states-five-check-marks rule as a live component rather than a paragraph. |
| ![Feedback box](docs/changelog/shots/l1/03-feedback-box.webp) | **The feedback box.** Shows the context it is about to capture before you press the button. Writes `issues/NNNN-slug.md`. |
| ![Issues](docs/changelog/shots/l1/04-issues.webp) | **Issues.** Read straight off the filesystem through the `IssueSink` seam. The SLA ladder sits in the inspector. |
| ![Issue detail](docs/changelog/shots/l1/05-issue-detail.webp) | **Issue detail.** Prose, plus the `json context` block exactly as captured. |
| ![System and seams](docs/changelog/shots/l1/06-system-seams.webp) | **System & seams.** What each seam is running now, what it swaps to, and why the swap stays cheap. Plus every constant that is a guess, named as one. |

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
| ![Research](docs/changelog/shots/l2/01-research.webp) | **Research & enrichment.** Fourteen entities, thirteen claims. The two counts that matter are *unverified* and *weakly supported* — both are the kind of number a system normally hides. |
| ![Dossier](docs/changelog/shots/l2/02-dossier.webp) | **A dossier.** Every claim shows source, as-of, confidence and who verified it, in that order, on the same line as the value. Open questions sit beside it, not buried in it. |
| ![EvidenceRef](docs/changelog/shots/l2/03-evidence-ref.webp) | **`EvidenceRef`.** The popover states *what the document can support* — not just where it came from. That sentence is what stops a conference attendee list from becoming a relationship. |
| ![Corpus](docs/changelog/shots/l2/04-corpus.webp) | **The corpus.** Eleven source documents, each labelled strong, moderate or weak, each with its own "supports" line. |

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
| ![Conflict ticket](docs/changelog/shots/l3/01-approvals-conflict.webp) | **A blocked INTRO_ASK.** The scope says what the approval authorizes *and what it does not*. Below it, both guards that refused, each showing what it looked at. |
| ![Adjudication](docs/changelog/shots/l3/02-adjudication.webp) | **Adjudicating the conflict.** Two claimants side by side, a reason code, and a follow-up date for the loser that the form will not submit without. |
| ![MONEY ticket](docs/changelog/shots/l3/03-approvals-money.webp) | **A MONEY ticket.** "Cash received — No, a separate state" is on the face of the approval, because that is the line this system exists to keep. |
| ![Ask log](docs/changelog/shots/l3/04-ask-log.webp) | **Module 07.** Every ask, made or not, with connector load in the inspector: Duettmann is at 2 of 3 this quarter. |
| ![Today](docs/changelog/shots/l3/05-today-queue.webp) | **Today,** now showing the real queue. |

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
| ![Routes](docs/changelog/shots/l4/01-routes.webp) | **Four paths to Delia Roos, ranked.** Recommend, Hold, Not a route, Excluded — each with the reason, the tier of every hop, and the evidence behind it. |
| ![Full page](docs/changelog/shots/l4/02-routes-full.webp) | **The list and the drawing.** The path list is the primary view; the graph adds shape and nothing else. Dashed lines are paths that cannot be used. |
| ![No route](docs/changelog/shots/l4/03-no-route.webp) | **The state this whole rule exists for.** "No path exists in the material available" — said in those words, with the corpus, the hop limit, and what was not inspected. |

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
| ![Pursuits](docs/changelog/shots/l5/01-pursuits.webp) | **Six pursuits at five different heights.** The six-segment bar is the ladder; the outlined segment is the next rung, which has nothing on file. |
| ![Roos workspace](docs/changelog/shots/l5/02-workspace-roos.webp) | **Delia Roos.** Sitting at *connector willing* and nowhere else. Routes, plan with a reason per move, claims with their sources, open questions, and the restriction in the inspector. |
| ![Cedar](docs/changelog/shots/l5/03-ladder-cedar.webp) | **Cedar Trust, five rungs up.** Commitment accepted on 18 September. Cash received is empty, and stays empty until a wire confirmation exists. |
| ![Advance](docs/changelog/shots/l5/04-advance-ticket.webp) | **Advancing a rung opens a ticket and writes nothing.** The rung lands only after approval, and the ladder is re-checked at that moment. |

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
| ![Soft to hard, all vehicles](docs/changelog/shots/l6/01-soft-hard-all.webp) | **With no vehicle selected there is no headline.** Four raises side by side, no total row, and a sentence saying why. |
| ![Soft to hard](docs/changelog/shots/l6/02-soft-hard-vehicle.webp) | **Pick a vehicle and the headline means something.** $56.0M hard, $22.5M soft in a hatched card, convertible soft shown and never summed in. |
| ![Forecast](docs/changelog/shots/l6/03-forecast.webp) | **The conserved capital pool.** Two actors are over a verified budget by $3.5M between them. The page says which vehicles, and refuses to pick. |
| ![Vehicles](docs/changelog/shots/l6/04-vehicles.webp) | **Vehicle status.** Per vehicle, hard, soft, cash, gap, coverage — and a cover line explaining why there is no total. |
| ![MONEY ticket](docs/changelog/shots/l6/05-money-ticket.webp) | **The MONEY ticket for Cedar Trust,** carrying its bounded action as data. Approving it is the only thing in this system that can move the headline. |

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
| ![Today, all vehicles](docs/changelog/shots/l7/01-today-all.webp) | **Today with no vehicle selected.** Operational counts rather than money, and each vehicle's hard number on its own row. Four decisions, one of them blocked by a conflict. |
| ![Today, one vehicle](docs/changelog/shots/l7/02-today-vehicle.webp) | **Today for PLC Neurotech I.** Hard, soft, gap and coverage — and the sprint strip underneath, so the gap is read against the weeks that are actually left. |
| ![Sprint calendar](docs/changelog/shots/l7/03-calendar.webp) | **Eighteen weeks to the close.** Two of them are not working weeks. Thanksgiving and the December dead zone are grey with a dashed bar and carry no milestone. |

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
| ![Close room](docs/changelog/shots/l8/01-close-room.webp) | **First close, PLC Neurotech I.** Six conditions with owners, dates and evidence — three of them compliance obligations, three already overdue. The subscription pack underneath, sent → returned → countersigned. |
| ![SPV war room](docs/changelog/shots/l8/02-spv-war-room.webp) | **Three SPVs on a days-scale clock.** invite → IOI → allocate → wire as a four-segment bar per seat, days elapsed beside it, and six bandwidth-steal alerts in the inspector. |

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
| ![Selection](docs/changelog/shots/l9/01-selection.webp) | **Ranked for PLC Neurotech I.** Four scored, two unscored. Every factor shows its basis, its source and who recorded it. |
| ![Reweighted](docs/changelog/shots/l9/02-reweighted.webp) | **The same list after moving capacity to 10% and propensity to 40%.** The order changes, the old weight set is kept, and an audit row records who changed it and why. |

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
| ![Signals on Today](docs/changelog/shots/l10/01-signals-today.webp) | **What changed.** Four signals above the threshold, each showing the rule that made it a signal rather than noise, with Claim and Dismiss. |
| ![Thresholds](docs/changelog/shots/l10/02-thresholds.webp) | **System & seams.** The three signal thresholds, every guessed constant in the system, and the two signals the thresholds held back — each labelled with which rule stopped it. |

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
| ![Prep brief](docs/changelog/shots/l11/01-prep-brief.webp) | **The prep brief for Northwood Capital, with zero supported claims.** Both claims on file are low-confidence and unverified, so the brief refuses both and says so by name. |
| ![Decision room](docs/changelog/shots/l11/02-decision-room.webp) | **The decision room.** Objections tagged into eight closed classes, diligence questions with owners and dates, the evidence gap stated as a number, and the decision timeline merging ladder events with meetings. |

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
| ![Content studio](docs/changelog/shots/l12/01-content-studio.webp) | **`AudienceVariants`.** One canonical asset, five variants side by side, each showing its permitted use and the claims it rests on. |
| ![Wrap refusal](docs/changelog/shots/l12/02-wrap-refusal.webp) | **The gate refusing a send.** The public primer for the 506(b) SPV: two reasons, no ticket opened, and the refusal kept on the record. |
| ![Performance](docs/changelog/shots/l12/03-performance.webp) | **Content performance.** There is no view data, so there are no view metrics — and the ladder is offered as the only attribution this system trusts. |

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
| ![Agent runtime](docs/changelog/shots/l13/01-agent-runtime.webp) | **Work envelopes, runs with their pins, refused tool calls, and the protected eval set** — every case traced to a real failure from an earlier stage. |
| ![Grants gate](docs/changelog/shots/l13/02-grants-gate.webp) | **The no-unsolicited gate.** Two funders blocked because no invitation exists, one permitted because a programme officer asked us to submit on 5 September. |

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

![Compliance registry](docs/changelog/shots/m24/01-compliance.webp)

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

![Answer library](docs/changelog/shots/m17/01-answer-library.webp)

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

![Today](docs/changelog/shots/final/01-today.webp)

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

![Issues](docs/changelog/shots/final/02-issues.webp)

Six issues in `issues/`, all filed through the in-app box, one of them marked **done**
because the thing it complained about got fixed during the build. Three were filed at the
end about gaps I know are there:

- **0004 (P1, question)** — one ask per relationship per quarter refuses the Roos ask twice
  for one reason. The constant needs a decision, not a value.
- **0005 (P2, request)** — nothing records cash arriving. `recordCash` exists, is tested,
  and is called by no screen.
- **0006 (P3, chore)** — the coverage-gap matcher over-reports.

### Four modules still have no screen, on purpose

![A capability without a screen](docs/changelog/shots/final/03-capability-without-screen.webp)

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
| ![All vehicles](docs/changelog/shots/n1/01-overview-all.webp) | **PL Capital → All vehicles.** Every vehicle side by side, no total row, and a module submenu that reads across all of them. |
| ![One vehicle](docs/changelog/shots/n1/02-overview-vehicle.webp) | **Selecting a vehicle** loads its overview and opens its modules in the rail. Everything below is scoped to it. |
| ![Pane closed](docs/changelog/shots/n1/03-pane-closed.webp) | **The right pane closes.** One button at the top right, and the choice is remembered. |
| ![Sections collapsed](docs/changelog/shots/n1/04-nav-collapsed.webp) | **Sections collapse** and stay collapsed across reloads. Developer starts closed. |
| ![Operations](docs/changelog/shots/n1/05-operations.webp) | **PL Capital → Operations.** The cross-vehicle layer: collisions between vehicles, connector goodwill spent across all of them, the shared calendar. |
| ![Relationships](docs/changelog/shots/n1/06-relationships.webp) | **Relationships.** LPs, co-funders and everyone — with roles *derived* from what happened rather than typed into a field. |
| ![PL R&D](docs/changelog/shots/n1/07-rnd.webp) | **PL R&D.** In the navigation because it is in the organisation; not in the data model, and the page says so plainly. |
| ![Changelog](docs/changelog/shots/n1/08-dev-changelog.webp) | **Developer → Changelog**, rendered from `CHANGELOG.md` with its screenshots, so it cannot drift from the repository. |
| ![Status](docs/changelog/shots/n1/09-dev-status.webp) | **Developer → Status.** What is running, and a problems list computed from the hard rules rather than maintained by hand. |
| ![Modules](docs/changelog/shots/n1/10-dev-modules.webp) | **Developer → Modules.** All twenty-four: vehicle-scoped, cross-cutting, or a capability with no screen. |
| ![Settings](docs/changelog/shots/n1/11-dev-settings.webp) | **Developer → Settings.** Nine guessed constants, each saying why it is a guess. |

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

![Changelog, newest first](docs/changelog/shots/n2/01-changelog-newest-first.webp)

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
| ![All vehicles](docs/changelog/shots/n3/01-fit-all-vehicles.webp) | **The roll-up, grouped by what is blocking.** Not a funnel — a work queue. Each group's heading says what the job is: an awareness gap needs reach, a conviction gap needs one objection answered, an unanswered gate needs somebody to pick up the phone. |
| ![One vehicle](docs/changelog/shots/n3/02-fit-one-vehicle.webp) | **Scoped to PLC Neurotech I** through the same vehicle selection the rest of the app uses. Same page, one vehicle. Nothing is ever summed across vehicles. |
| ![Diagnosis and gates](docs/changelog/shots/n3/03-diagnosis-and-gates.webp) | **The diagnosis above the fold, hard gates directly beneath it.** Northwood's blocker is conviction — they told us the objection in the room. Two of their six gates are unanswered, and an unanswered gate is not a pass. |
| ![Dimensions](docs/changelog/shots/n3/04-dimensions-biggest-misses.webp) | **Eighteen graded dimensions, three sort orders.** Matters to us, matters to them, and biggest misses. Every reading carries whether it is known, inferred or guessed, and the certainty discounts the number rather than decorating it. |
| ![Values and perception](docs/changelog/shots/n3/05-value-and-perception.webp) | **What they value, and whether they can see it in us.** A match they cannot see is worth nothing at the moment of decision. Below it, familiarity and sentiment as separate columns. |
| ![Ties](docs/changelog/shots/n3/06-ties-and-decision.webp) | **Ties between us, with strength and opinion-weight as different columns.** Hale is a moderate tie to Roos and a **blocker** — she asked not to be introduced through him, and the tie table says so rather than quietly ranking him third. |

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
| ![Directory](docs/changelog/shots/n4/01-orgs-directory.webp) | **The directory.** Everyone, LPs, co-funders and connectors as tabs rather than four routes. Roles are still derived from what happened, and the last column now carries what is in the way for each one. |
| ![Summary pane](docs/changelog/shots/n4/02-summary-pane.webp) | **Clicking a name opens the summary here**, without leaving the list. Money per vehicle, where the conversation is, what is in the way, the ties on file, and what the record rests on. |
| ![Entity page](docs/changelog/shots/n4/03-org-page.webp) | **The entity page.** Restriction first, then where we stand per vehicle, then how we reach them, then what we can support with its provenance, then the open questions. |
| ![From the fit roll-up](docs/changelog/shots/n4/04-summary-from-fit.webp) | **The same pane, from a different list.** One component, so the answer to &ldquo;who is this&rdquo; cannot differ between screens. |
| ![Connectors](docs/changelog/shots/n4/05-connectors.webp) | **Connectors** are a group now. Goodwill is spent per person across every vehicle, so the people carrying asks deserve their own list. |

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
| ![Score and rank](docs/changelog/shots/n5/01-score-and-rank.webp) | **A score, a rank, and the pool it sits in.** 60 out of 100, 5th of 7 for this vehicle, ahead of 2 of the other 6, pool 56–84 with the median marked. The URL is `/neurotech/fit/<target>`. |
| ![Readings](docs/changelog/shots/n5/02-readings.webp) | **Every reading points the same way: up is good for this raise.** A bar for strength, a sign for direction, and words that say whose side it is on. Importance is a number now, not pips. |
| ![Ranked roll-up](docs/changelog/shots/n5/03-rollup-ranked.webp) | **The roll-up carries rank and score per row**, so the grouping by blocker no longer hides where each one sits in the pool. |
| ![Top of the pool](docs/changelog/shots/n5/04-top-of-pool.webp) | **Cedar at 84, 1st of 7** — and the distribution shows how narrow the top of this pool actually is. |
| ![Blocked, ranked last](docs/changelog/shots/n5/05-blocked-last.webp) | **Whitcomb scores 80 and ranks 7th of 7.** The strip says why in the same breath: a failed hard gate is not a ranking question. |

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
| ![Preferences](docs/changelog/shots/n6/01-preferences.webp) | **Preferences.** Theme, the three browser-stored layout preferences named by their keys, and who you are. Configuration lives elsewhere and the page says where. |
| ![Green theme](docs/changelog/shots/n6/02-green-theme.webp) | **Green, applied.** The accent, the ground and the rail move. The four semantic colours do not. |
| ![Green overview](docs/changelog/shots/n6/03-green-overview.webp) | **The vehicle overview in green**, with the exemption banner that replaced the `506(c)` suffix in the rail. Grants rail now sits under PL R&D. |
| ![Green fit](docs/changelog/shots/n6/04-green-fit.webp) | **The fit page in green.** Passing gates are still the semantic green, selection is the accent green, and a blocker is still clay. |
| ![Grants under R&D](docs/changelog/shots/n6/05-grants-under-rnd.webp) | **The grants rail is a vehicle with its own modules**, drawn in the section where the work actually sits. |

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
| ![People](docs/changelog/shots/n7/01-people-tab.webp) | **The directory lists everyone**, and now has *People* and *Firms & institutions* tabs. Each row says who somebody acts for, or how many people a firm has on file. |
| ![Firm people](docs/changelog/shots/n7/02-firm-people.webp) | **A firm page carries its people.** Northwood's decision-maker, her capacity, the dates she has held it, and the other firm she also appears at. |
| ![Two firms](docs/changelog/shots/n7/03-person-two-firms.webp) | **A person page leads with where they sit.** Raman decides at Northwood and worked at Vantage until August — and Vantage is already an LP in both of our vehicles. |
| ![Summary pane](docs/changelog/shots/n7/04-summary-acts-for.webp) | **The summary pane carries it too.** Hale advises at Mercer & Bly and formerly advised Roos, where a do-not-approach instruction is on file. |
| ![Firms](docs/changelog/shots/n7/05-firms-tab.webp) | **Firms & institutions** — the records that hold a mandate, a cheque band and a restriction. |

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
| ![The box](docs/changelog/shots/n8/01-feedback-with-shot.webp) | **The box, with the page in it.** Captured at the moment you pressed the button, before the drawer covered anything. Ticked by default; untick it and nothing is sent. |
| ![Annotating](docs/changelog/shots/n8/02-annotating.webp) | **Clicking the image opens it full size to annotate.** Freehand, arrow, box, text; five colours; undo, clear, cancel, done. |
| ![Annotated](docs/changelog/shots/n8/03-annotated-thumb.webp) | **Back in the box, marked *annotated*.** The annotated image is what gets filed — there is no second copy of the clean one. |
| ![On the issue](docs/changelog/shots/n8/04-issue-with-shot.webp) | **Issue 0007, filed through the box while building this.** The picture is a PNG in `issues/attachments/`, so the complaint, the screenshot and the fix travel in one pull request. |

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
| ![Standup](docs/changelog/shots/n9/01-standup-today.webp) | **Today.** Every vehicle side by side with no total row, counts that are counts, this week, today, yesterday, and an ordered action list. The numbers are live and the bar says so. |
| ![Pinned](docs/changelog/shots/n9/02-standup-pinned.webp) | **Saturday the 19th, pinned at 08:05.** Two vehicles, $56.0M hard, four approvals — the numbers as they read that morning. Opening it today does not recompute a thing. |
| ![Actions](docs/changelog/shots/n9/03-standup-actions.webp) | **What to do, in order** — with why it is on the list, a *suggested* owner, what is blocking it, and the ticket kind it will need. |
| ![Calendar](docs/changelog/shots/n9/04-calendar-all.webp) | **Sixteen weeks across every vehicle.** Bars are spans, diamonds are deadlines, dots are days. Today is the vertical line. |
| ![Per vehicle](docs/changelog/shots/n9/05-calendar-vehicle.webp) | **The same calendar scoped to one vehicle**, at `/neurotech/calendar`, in the vehicle's own submenu. |

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
| ![Overview section](docs/changelog/shots/n10/01-overview-section.webp) | **Overview is the first section**, and Today, Approvals and Issues are in it. |
| ![Collapsed](docs/changelog/shots/n10/02-overview-collapsed.webp) | **Collapsed, the approvals count moves to the heading** — a signal that disappears when you tidy the nav is a signal you stop trusting. |

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
| ![Real capture](docs/changelog/shots/n11/01-real-capture.webp) | **"Captured from your screen."** The box says which path it got, because the two are not equivalent and you should not have to guess. |
| ![Toolbar](docs/changelog/shots/n11/02-toolbar-on-the-image.webp) | **The toolbar is directly above the image**, and **freehand is the default tool** — this circle was drawn without selecting anything. |
| ![Undo](docs/changelog/shots/n11/03-undo-redo.webp) | **⌘Z and ⌘⇧Z work**, with buttons that disable when there is nothing to undo or redo. Esc cancels. |

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
| ![Deep crumb](docs/changelog/shots/n12/01-deep-crumb.webp) | **`PLC Neurotech I / Funder–vehicle fit / Northwood Capital`** — three levels, and the middle two go back where they say. |
| ![Corpus](docs/changelog/shots/n12/02-crumb-hover.webp) | **`Other / Research corpus / Every source document`.** The section, the page, the thing. |

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
| ![Write](docs/changelog/shots/n13/01-markdown-write.webp) | **Write.** Monospace source, a small formatting bar, and the file it is going to become. |
| ![Preview](docs/changelog/shots/n13/02-markdown-preview.webp) | **Preview**, rendered with the same component the issue page uses — so what you check before filing is what appears afterwards. |
| ![On the issue](docs/changelog/shots/n13/03-issue-rendered.webp) | **Issue 0008, filed through the box while building this** — heading, bold, inline code, a list, and a dropped PNG sitting beside the issue in the repository. |

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
| ![Assessment](docs/changelog/shots/n14/01-assessment.webp) | **Where the raise stands** — nineteen readings across six groups, each with a verdict, what it means, and what it does not. |
| ![Board](docs/changelog/shots/n14/02-board.webp) | **The option space, ranked.** Every play cites the finding that put it there, and plays whose lever answers a weak reading float to the top. |
| ![Compounding](docs/changelog/shots/n14/03-compounding.webp) | **What compounds**, kept as a separate horizon rather than a low priority. |
| ![Commit](docs/changelog/shots/n14/04-commit.webp) | **Propose and commit** in your own words. Lines, @handles and dates are pulled out and kept beside the text. |
| ![Assigned](docs/changelog/shots/n14/05-assigned.webp) | **Assignment is a second press**, and it queues a Linear ticket. |

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
| ![State of play](docs/changelog/shots/n15/01-state-of-play.webp) | **Where we actually are** — fit, rung, money, ties, who we deal with, last touch. None of it stored here. |
| ![Needs](docs/changelog/shots/n15/02-needs.webp) | **What they need**, with what each need calls for. Northwood has three: two unmet, one nobody has established. |
| ![Options](docs/changelog/shots/n15/03-option-space.webp) | **The option space**, ranked, plus whole-vehicle plays matched to this target's unmet needs. |
| ![Tessaro](docs/changelog/shots/n15/04-tessaro.webp) | **Tessaro, for contrast.** They already understand the field — that need is *met* — and have never heard of us. Opposite work from Northwood. |

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
| ![Routes](docs/changelog/shots/n16/01-routes-influence.webp) | **Four paths to the same person**, ordered by verdict and then by influence. |
| ![Decomposition](docs/changelog/shots/n16/02-decomposition.webp) | **Five components, each with its weight and its reason.** Duettmann scores 71: perfect on topic, moderate on standing with us, and the basis for every bar is a sentence rather than a number. |

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
| ![Gaps](docs/changelog/shots/n17/01-gaps.webp) | **What is missing across the universe**, derived from the fit board rather than stored. A guess and an unanswered gate are different failures, and both are labelled. |
| ![Catalogue](docs/changelog/shots/n17/02-catalogue.webp) | **Seventeen methods in seven kinds** — buy, integrate, query, ask, observe, interview, infer — each with what it yields, its cost, and the line it must not cross. |
| ![Rejected](docs/changelog/shots/n17/03-rejected.webp) | **A rejected method stays on the page**, with the reason. |
| ![Per target](docs/changelog/shots/n17/04-target-gaps.webp) | **Northwood's ten open fields**, each matched to the methods that would close it. |

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
| ![No screenshot yet](docs/changelog/shots/n18/01-no-screenshot-yet.webp) | **The box opens instantly.** *Add a screenshot: Whole page · Pick a part.* Optional, and the complaint files without one. |
| ![Rich](docs/changelog/shots/n18/02-rich-editor.webp) | **Rich by default.** Headings, bold, inline code and lists, stored as markdown. |
| ![Source](docs/changelog/shots/n18/03-source-view.webp) | **Markdown, one click away** — and it is the document rather than an export of it. |
| ![Region](docs/changelog/shots/n18/04-region-picker.webp) | **Pick a part.** The drawer hides so you can see the page you are drawing a box on. |
| ![Cropped](docs/changelog/shots/n18/05-cropped.webp) | **Just that region**, in the box, ready to annotate. |

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
| ![Seeded](docs/changelog/shots/n19/01-seeded-and-buttons.webp) | **One screenshot already there** when the box opens, with **Mis-aligned?** beside it and two buttons to retake. |
| ![Two](docs/changelog/shots/n19/02-two-screenshots.webp) | **Screenshots add up.** A whole-page redraw and a picked region, each with its own × and its own Annotate. |
| ![Text tool](docs/changelog/shots/n19/03-text-tool.webp) | **The label looks like the label.** Same colour, same weight, same size on screen as the one about to be drawn. |
| ![Placed](docs/changelog/shots/n19/04-placed-label.webp) | **Placed, at size L, with an arrow.** |

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

![Wide](docs/changelog/shots/n20/01-changelog-wide.webp)

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
| ![Queue and table](docs/changelog/shots/n21/01-queue-and-table.webp) | **The queue above the table.** Human and agent limits, and what the gaps actually are. |
| ![Weights](docs/changelog/shots/n21/02-weights.webp) | **Six sliders**, each with what raising it does. Every default is a guess about this team at this moment, which is why they are on the page. |
| ![Filters](docs/changelog/shots/n21/03-filters.webp) | **Filter and sort.** *Agent can run it* is the filter that matters most. |
| ![Chosen](docs/changelog/shots/n21/04-chosen.webp) | **Chosen, and counted.** The queue says 1 of 5, and the row says who chose it. |

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
| ![Picker and bars](docs/changelog/shots/n22/01-picker-and-bars.webp) | **Score in the list**, sorted by it, with the records around each name underneath. Both side panes are narrower. |
| ![Search](docs/changelog/shots/n22/02-search.webp) | **Typing "Kaplan"** finds the trust *and* the person who signs for it. |
| ![Filter](docs/changelog/shots/n22/03-score-filter.webp) | **Score ≥ 75**, in the browser, instantly. |
| ![Propose](docs/changelog/shots/n22/04-propose.webp) | **Who carries it**, with why that person is suggested and where the ask actually goes. |

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
| ![Influence bars](docs/changelog/shots/n23/01-bars.webp) | **Label, bar under it, reason beside both.** Same five components, about 200px less height. |
| ![Lightbox](docs/changelog/shots/n23/03-lightbox.webp) | **A screenshot expands here.** Esc, the ×, or a click anywhere closes it. |

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
| ![Full width](docs/changelog/shots/n24/01-wide.webp) | **The influence block spans the verdict column now.** Two lines a reason instead of five. |
| ![Narrow window](docs/changelog/shots/n24/02-narrow.webp) | **In a small window** the reason goes under its bar rather than beside it. |

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
| ![Two-row rows](docs/changelog/shots/n25/01-rows.webp) | **One line of numbers, one line of prose.** Rows are about half as tall and the sentences are sentences. |
| ![Sorted by cost](docs/changelog/shots/n25/02-sorted-by-cost.webp) | **Sorted by cost.** The sub-labels under each number stay on one line now. |

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
| ![Both labelled](docs/changelog/shots/n26/01-both-labelled.webp) | **Every method now says who runs it.** Clay for a person, green for an agent. |
| ![A person runs it](docs/changelog/shots/n26/02-person-runs-it.webp) | **A person runs it** — a filter as well as a label. |
| ![Agent runs it](docs/changelog/shots/n26/03-agent-runs-it.webp) | **Agent runs it.** Cheap, repeatable, and still needs reading. |
| ![The queue](docs/changelog/shots/n26/04-queue.webp) | **The two queues** carry the same two colours. |

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
| ![Issue filters](docs/changelog/shots/n27/01-issue-filters.webp) | **Filter by status, priority and kind.** Defaults to hiding `done`, and says how many rows that hid. |

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
| ![The line](docs/changelog/shots/n28/01-the-line.webp) | **The line.** Seven stations, work sitting in each, lanes by vehicle. |
| ![The load](docs/changelog/shots/n28/02-the-load.webp) | **The load.** Who is carrying what, and who is over their limit. |
| ![The flow](docs/changelog/shots/n28/03-the-flow.webp) | **The flow.** Where work stops moving, with the drop-off drawn. |
| ![The clock](docs/changelog/shots/n28/04-the-clock.webp) | **The clock.** The fortnight ahead, and the pile with no date on it. |
| ![The room](docs/changelog/shots/n28/05-the-room.webp) | **The room.** Instruments. The one you could read from across a room. |
| ![One vehicle](docs/changelog/shots/n28/06-one-vehicle.webp) | **Per vehicle**, lanes become people instead of raises. |

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
| ![The map](docs/changelog/shots/n29/01-the-map.webp) | **The map.** Every name placed by capacity and fit — and 22 of 28 held back in the fog, because nobody has scored them. |
| ![The plant](docs/changelog/shots/n29/02-the-plant.webp) | **The plant.** The whole machine with a gauge at every station and a valve at every approval. |
| ![The moves](docs/changelog/shots/n29/03-the-moves.webp) | **The moves.** A build menu: what each move needs, costs and buys, locked entries included. |
| ![The grid](docs/changelog/shots/n29/04-the-grid.webp) | **The grid.** Targets against levers. A row with no open cell is the finding. |
| ![The economy](docs/changelog/shots/n29/05-the-economy.webp) | **The economy.** What is about to run out. It is almost never money. |

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

---

## N30 — The rest of the feedback queue

**Shipped.** Four of the five remaining issues, and the fifth is now a decision waiting on
Juan rather than a bug waiting on me.

| | |
|---|---|
| ![Record the wire](docs/changelog/shots/n30/01-record-the-wire.webp) | **0005.** Cash received was a state nobody could reach. It has a control now. |
| ![What moves this number](docs/changelog/shots/n30/02-what-moves-the-score.webp) | **0007.** Every reading, what it supplies, and what would move it. |
| ![One collision](docs/changelog/shots/n30/03-one-collision.webp) | **0004.** Two refusals that were the same collision, printed once. |

### 0005 — nothing records cash arriving

`pipeline.recordCash` existed, was tested, and was called by no screen. The hard track now
has **Record the wire** on every row that is countersigned and not yet received: a date, a
bank reference, and a refusal without the reference, because "it landed" with no receipt is
a recollection.

It is deliberately **not** gated by a MONEY ticket, and that is worth stating rather than
sliding past. The five approval kinds authorise things we are about to do. A wire is
something that has already been done to us, and **a system that refuses to record money it
has received is lying about its own bank account.** The audit log carries the actor, the
reference and the date.

### 0007 — the fit score does not say which reading moved it

The firm page has a *What moves this number* table: each reading, the points of the final
score it supplies, what it would add if the finding went to strong, and what it would do if
the same finding were **verified** rather than guessed.

That last column can be negative, which is the interesting part. Verifying a weak guess
*lowers* the score, because the certainty discount was flattering it. Research can deliver
that column; only the counterparty can deliver the other one.

On Cedar Trust the table also says the thing worth knowing: the largest single change
available is two points, so that score is not one conversation away from anything.

**The diff is still missing and the issue stays open for it.** This system keeps one
assessment per firm and vehicle, so there is no earlier reading to subtract. It needs an
`fit.assessment_revision` table written on every change — at which point "which reading
moved it since August" becomes a query rather than a feature.

### 0004 — one collision, counted twice

The frequency cap counts across vehicles, so every cross-vehicle collision also trips it and
the approvals page printed two refusals for one event. When every ask the frequency guard
counted is one of the competing asks, that block is now marked subsumed, the heading reads
**1 guard refusing · 1 more is the same collision**, and the row says so in words.

**The decision underneath it is untouched and still needed.**
`guard.asksPerRelationshipPerQuarter` cannot be both a per-vehicle cap and a cross-vehicle
one. Per vehicle, the conflict case does the real work; across vehicles, the conflict case is
nearly redundant. This change only stops one ambiguity from being reported as two problems.

### 0006 — the coverage-gap matcher

It wanted two shared words over four characters, so *fee load* and *fee terms* shared nothing
and an answered question was reported as uncovered. It now stems crudely, drops stopwords,
and keeps the short domain words — *fee*, *term*, *lock* — that the length filter was
throwing away. Two shared stems, or one of six characters or more.

Still biased toward over-reporting: a gap listed twice wastes a minute, a gap hidden is the
question you keep being asked and never write down.

### 0002 — the vehicle switcher

The cookie holds a map of handle → slug rather than a single slug, so switching to Mara,
changing vehicle and switching back leaves Juan looking at Juan's choice. Still a cookie,
still per browser — what it is not any more is *shared between the people using that
browser*. A cookie written before the change is read as belonging to whoever is signed in
when it is first seen.

**43 of 43 properties hold.** Two issues stay open on purpose, each with the specific thing
it is waiting for written into the file.

---

## N31 — The feedback box stops arguing with the reporter

**Shipped.** Issues 0009, 0010 and most of 0012 — everything about the dialog itself.

| | |
|---|---|
| ![No title needed](docs/changelog/shots/n31/01-no-title-needed.webp) | **The title is optional.** Intake writes one from your first line. |
| ![Markdown source](docs/changelog/shots/n31/02-markdown-source.webp) | **The Markdown tab stopped fighting.** Fenced blocks and double spaces survive. |
| ![Shortcuts](docs/changelog/shots/n31/03-shortcuts.webp) | **`?` lists the shortcuts**, this dialog's first. |

### The Markdown tab was unusable and the reason was a loop

The textarea was controlled by the same `value` the rich editor writes. Every keystroke went
out to the parent, came back through TipTap's serialiser — which trims trailing whitespace
and escapes backticks — and was handed back as a *different string*. So a trailing space
vanished as you typed it, the cursor jumped to the end of the box, and a fenced code block
could not be written at all.

**While the Markdown tab is open the textarea is the document.** Nothing round-trips until
Rich is asked for, and the hand-off back into the editor no longer emits an update. Typing
` ```json ` into the box and getting ` ```json ` back is a low bar and it was not being met.

### Nothing is required except the complaint

The title is optional: intake takes the first real line of the body, strips the markdown
furniture and cuts it to 72 characters. **Making somebody name a bug before they can describe
it is a tax on the complaint**, and the name invented under that pressure is usually worse
than the sentence they actually wrote.

A report with neither a title nor a description is still refused, because intake can invent a
name and cannot invent the complaint.

### Keys

`esc` closes — the shortcut card first, then the annotation editor, then the box, one level
at a time. `⌘↵` files it. `?` opens a card listing them, this dialog's first, with a line
under the buttons so nobody has to guess the card exists.

### Priorities stopped promising dates

P0 used to say *"triaged same business day · fixed in 1–2 days"*. Nothing here knows how long
a fix takes, that date was invented by a dropdown, and **a promise the queue cannot keep
teaches everybody to file at P0.** The four now read *Blocking · Serious · Normal · Someday*
with what each means, and the page says plainly that no date is promised against a priority —
how fast the queue moves is a fact about the queue.

### And the confirmation stopped lecturing

*"Written to `issues/0009-….md`. It is a file in this repository, so it travels in the same
pull request as its fix and survives `npm run db:reset`."* → *"Thanks — it is in the queue
with this page, your filters and any screenshots attached."*

**43 of 43 properties hold.**

---

## N32 — An annotation you can change your mind about

**Shipped.** Issue 0014. The text tool put a label down and that was the end of it: one
line, on a white card, in a field that Escape emptied.

| | |
|---|---|
| ![Typing](docs/changelog/shots/n32/01-typing.webp) | **A transparent, multi-line field** that wraps at its own width. |
| ![Placed and movable](docs/changelog/shots/n32/02-placed-and-movable.webp) | **After placing:** drag it, resize it by the corner, double-click to retype. |

### Escape was destroying work

> "i lost 3 annotations accidentally by trying to exit the text field by reflex."

Escape is how people leave a text field. It was wired to *cancel the label*, so the reflex
that means "stop typing" meant "throw away what I typed". It now leaves the field and
**keeps the text**, then the selection, then the editor — one level per press. The only
label that disappears is an empty one, and it disappears because it is empty.

### A label is an object, not a stamp

The field is a transparent textarea, so the label reads against the screenshot instead of
sitting on a white card. **Return is a line break.** It wraps at a width you set by dragging
the corner, and after it is placed you can move it, resize it, double-click into it, and
change its size, weight and colour — the floating bar now edits *the selected label* rather
than presetting the next one.

Placed labels live as DOM elements while you work and are composited onto the image once, at
export, wrapped the same way they were on screen.

### The one that took the longest was two lines

The text tool looked like it did nothing: you clicked, a field appeared, and typing went
nowhere. Focusing the field inside the click that created it lost the focus again when the
browser finished handling that same click on the canvas underneath. One `preventDefault`,
one `requestAnimationFrame`. And dragging did nothing because the label captures the pointer
when the drag starts, so the moves arrived at the label while the handler was on the canvas.

**Undo still does not step back through a move or a resize** — the undo stack is a stack of
marks, not of states, and a drag edits a mark in place. Said here rather than discovered.

**43 of 43 properties hold.**

---

## N33 — Issues move in with the developers, and the floor becomes Visualizations

**Shipped.** Issues 0011, 0013 and the rest of 0012.

| | |
|---|---|
| ![Fixed in](docs/changelog/shots/n33/01-issues-fixed-in.webp) | **A Fixed in column**, linking to the changelog entry that closed it. |
| ![Fix history](docs/changelog/shots/n33/02-fix-history.webp) | **On the issue**, the version, what it changed and a link to the paragraph. |
| ![Everything](docs/changelog/shots/n33/03-everything.webp) | **Three scopes, three URLs.** This one includes PL R&D. |

### Where a fix went

Every issue now carries the version that closed it. The list has a column; the issue page
names what that version changed and links to the paragraph in the changelog.

It is **derived, not tracked**: the closing note in the file already said `**Done (N30).**`,
so that is what is read, with a `fixed_in:` field taking precedence when somebody wants to be
explicit. A second place to write the same fact is a second place for it to be wrong, and the
lookup goes through the changelog heading, so renaming an entry moves the link rather than
breaking it.

Issues also moved under **Developer**, in the rail and in the breadcrumb. They are a
development queue that happens to be filed from inside the product.

### One name, two labels, and one of them was wrong

*Factory floor* appeared twice in the rail — once under Overview and once under All vehicles
— pointing at the same URL. Two entries claiming different scopes and serving the same page
means one of them is lying to you.

Three scopes now, and the grants rail is the difference between the first two:

- **`/everything/visualizations`** — every vehicle on file, PL R&D included. In Overview, at
  the bottom, under Calendar.
- **`/all/visualizations`** — PL Capital's vehicles. Under *All vehicles*.
- **`/<vehicle>/visualizations`** — one raise.

A rail that cannot be approached until a funder invites us does not belong in a capital
roll-up, which is why the middle one leaves it out and says so on the page.

And the name: **Visualizations**. "Factory floor" was the brief, not the label.

### The rest of 0012

`tab` moves between fields — the answer to *"what is the shortcut to unselect the textbox"* —
and the hint line under the buttons says so rather than leaving it to be found. `?` opens the
contextual card. It is not global yet and the card admits it.

**43 of 43 properties hold.**

---

## N34 — Five more, and everything becomes clickable

**Shipped.** Fifteen views now, one filter bar over all of them, and a context console that
opens when you point at anything. The design brief for this slice was a set of reference
boards whose best idea was not any single chart but the discipline underneath them: every
mark is a record, every record can be opened, and every claim about a person says what it
rests on.

| | |
|---|---|
| ![The network](docs/changelog/shots/n34/01-the-network.webp) | **The network.** Us, the people who could carry an ask, the money — and only recorded lines between them. |
| ![The leverage](docs/changelog/shots/n34/02-the-leverage.webp) | **The leverage.** One recorded thing on the left, everything waiting behind it on the right. |
| ![The coverage](docs/changelog/shots/n34/03-the-coverage.webp) | **The coverage.** Six kinds of record per pursuit, least recorded first. |
| ![The radar](docs/changelog/shots/n34/04-the-radar.webp) | **The radar.** Distance is time since a dated exchange; the list beside it is everyone nobody has spoken to. |
| ![The strip](docs/changelog/shots/n34/05-the-strip.webp) | **The strip.** A month of operations per vehicle, with the undated pile counted beside it. |
| ![Console](docs/changelog/shots/n34/06-console.webp) | **Click anything.** The console shows what is recorded, its basis, and where to act. |
| ![Filter](docs/changelog/shots/n34/07-filter.webp) | **One filter, every tab.** Signal: blocked — and the bar says what it hid. |

### Everything is a record, so everything opens

Two things landed before any new drawing. A **filter bar** — find, owner, signal, rung —
that narrows the projection before any view sees it, so a search for "Roos" reshapes the
line, the load, the map, the grid and the list at once rather than being reimplemented
fifteen times with fifteen sets of bugs. The count beside it says how many pursuits the
filter hid, because a filtered picture that looks like an unfiltered one is the most
expensive mistake this page could make.

And a **context console**. Pointing at a mark opens a panel with the record behind it —
rung and what the next rung needs, the figure and its basis, the last record and how old it
is, the blocker in full — with links to the screens where it can actually be changed. A
panel that explains but cannot hand off is a dead end.

### The network — who can move whom

Three columns: the team, the people who could carry an ask, the targets. A line is a
**recorded** relationship edge or an ask somebody actually carried. Tier A and B draw solid;
C and D draw dashed until a person confirms them; a restriction draws clay. Being in the
address book is not being an advocate, and two people at the same conference are not a
path — the drawing refuses to imply reach it cannot evidence, because somebody would plan a
quarter around it.

### The leverage — what one piece of work releases

The only view that ranks work by how many other things it unblocks. Open tickets, questions
the library has no answer for, assets carrying a refresh flag, collisions, restrictions,
actors over their budget, connectors at their cap — each with the pursuits waiting behind it.
The SEND ticket on the Neurotech primer holds two pursuits; the INTRO_ASK on Delia Roos holds
two more. **Releasing a prerequisite does not advance anything; it lets somebody try.**

### The coverage — what we do not know

Six kinds of recorded context per pursuit: a figure, an assessment, confirmed access, a dated
exchange, an open action, a dated entry to its rung. Least recorded first. It is the only
view that draws what is *not* there, and it turned up something worth seeing: the wired
commitments — Brenner, Vantage, Kaplan — show a cheque and nothing else. They closed before
the ladder existed and nobody wrote the rest down. That is not a bug; it is exactly what the
view is for.

### The radar — when anybody last spoke to them

Rings are days since a **dated exchange**: a meeting that happened, an ask that was made, a
rung above "connector willing", which by definition needs a reply. Not since we wrote a note
to ourselves. The list beside it is every pursuit with no dated exchange at all — they cannot
be placed on a recency chart, and putting them on the outer ring would turn *nobody has
spoken to them* into *they have gone cold*, which is a different and more flattering claim.

### The strip — a month of operations

The fortnight behind, today, the fortnight ahead; one lane per vehicle, three tracks in each:
exchanges, work due, agent run updates. The columns on the right hold what falls outside the
window and, more usefully, what has **no date at all** — the pile that never appears on a
calendar and never gets chased, because undated is not the same as late. Agent runs that name
no target get a lane of their own rather than vanishing.

### What broke and why

Two hydration failures, both the same lesson. SVG tooltips built from several template
strings render as one text node on the server and several on the client; they are one
string now. Dates formatted with the machine's locale and timezone differ between server
and browser; every date on these views is UTC and hand-formatted. And `.lev` was already the
leverage number on the strategy page, so the new cards inherited its monospace — renamed.

**43 of 43 properties hold.**

---

## N35 — The feedback box, second pass: the crop, the batch, the pictures

**Shipped.** Issues 0015, 0017 and 0018 — and four older bugs in the same box that fixing them
turned up.

| | |
|---|---|
| ![Pick a part](docs/changelog/shots/n35/01-pick-a-part.webp) | **Pick a part captures what you picked**, edge to edge, at 2×. |
| ![Dropped image annotated](docs/changelog/shots/n35/02-dropped-image-annotated.webp) | **Pictures dropped into the description can be drawn on** — and stay where they sit in the text. |
| ![Give more feedback](docs/changelog/shots/n35/03-give-more-feedback.webp) | **Give more feedback**, and a list of everything filed while the box was open. |

### 0015 — the crop was off, and the arithmetic says exactly how far

The screen capture shrank the frame to 2000px wide *first*, then cropped it using
`devicePixelRatio` as though nothing had been shrunk. On a 2× screen that multiplied every
coordinate by 2 where the true factor was about 1.4 — the rectangle landed 44% further right
and further down than the one drawn, and came out bigger. It was off in y too; x just has
further to drift across a wide page.

The crop now happens on the full-resolution frame, and the scale is **measured** — frame
pixels ÷ viewport pixels, per axis — not assumed. Tested with a red box dragged corner to
corner at 2×: the old code cut a rectangle with **0%** of the box in it, the new one **100%**.
If somebody shares a window or a whole screen instead of the tab, the frame is the wrong shape
for viewport coordinates, so the part is drawn from the page instead and the thumbnail says so.

### 0017 — reports come in batches

Five issues in five minutes is how feedback actually arrives. The confirmation now leads with
**Give more feedback**, and `⌘↵` does the same thing there, so the rhythm is type, `⌘↵`, `⌘↵`,
type. It clears the words, pictures, kind and priority, and takes a fresh screenshot — the last
one belongs to the issue it was filed with. Everything filed while the box has been open is
listed under the buttons.

### 0018 — pictures in the description can be annotated

Images dropped into the description get a strip of their own under it, each with **Annotate**,
and drawing on one replaces it where it sits in the text. Getting there turned up three older
bugs in the same editor:

- **Rebuilding the rich view dropped every dropped-in picture from the view** — including the
  plain Markdown → Rich toggle, since N18. TipTap refuses `data:` URLs when it parses unless
  told otherwise; dropping only ever worked because it inserts the node directly.
- **The second picture replaced the first.** An inserted image was left selected, so the next
  drop — or the second file of a two-file drop — overwrote it.
- **Text after a picture was glued onto its line** — `![shot](attachment:1)More words.` — so the
  issue file read back as a different document from the one typed. Images close their block now.

Plus one I introduced in N31: dropping a picture while the **Markdown** tab was open wrote the
reference only into a copy of the text the tab was not showing, and switching back to Rich
then overwrote it.

### And the titles

Every one of these five issues had an intake title cut mid-clause — *"…are hard to see (in
this…"* — because intake took the first *line* and cut it at 72 characters. It now takes the
first **sentence**, drops parenthetical asides before cutting anything, prefers a clause
boundary to a word boundary, and only then reaches for an ellipsis. The five were retitled
with it; a title somebody typed is never touched.

Checking that exposed a round-trip bug in the issue files themselves: titles are written with
`JSON.stringify` and were read back by stripping the quotes, so `Fix: the "rail"` came back
with literal backslashes in it. They are read with `JSON.parse` now.

**43 of 43 properties hold.**

---

## N36 — Labels you can read, and a new name on the door

**Shipped.** Issues 0016 and 0019.

| | |
|---|---|
| ![Section headings](docs/changelog/shots/n36/01-section-headings.webp) | **The tab groups are headings**, and every small label is a step darker and heavier. |
| ![Labels](docs/changelog/shots/n36/02-labels.webp) | **Everywhere, not just here** — the same change on every page that uses a label. |
| ![The name](docs/changelog/shots/n36/03-the-name.webp) | **PLC Raise Tools**, from one constant. |

### 0016 — two jobs, two fixes

The faint text was doing two different jobs, so it got two different fixes.

**The tab groups are sections**, so they are headings now — *State of play*, *The space and
the moves*, *Reach, leverage and blind spots* — in the display face with a rule above each,
instead of a third tiny line of uppercase between two rows of cards.

**Every small uppercase label is one step darker and one step heavier**, on every page: a new
`--label` colour between ink and muted, weight 500, half a point larger. They passed the
contrast ratio before and were still hard to see, because small caps in a light weight with
wide tracking read as a texture rather than as words. Each theme has its own shade, and labels
on the dark canvases keep theirs.

### 0019 — PLC Raise Tools

The rail, the browser tab, the R&D page, the published build log and the label on anything
handed to Linear all say **PLC Raise Tools**. It is one constant — `config/deployment.ts` →
`product` — because the request said *for now*, and going back should be one block rather than
a search.

*Capital OS* stays as the codename: in the code, the docs, the design history, and in the
storage keys and cookie names. Those last two cannot be renamed without signing everybody out
and resetting their theme and layout, which is a lot to spend on a name that might change back.
The screenshot script's capture flag had to change with the title — it auto-selects the tab by
name, and a stale name quietly falls back to the other capture path.

**43 of 43 properties hold.**

---

## N37 — Pictures you can point at, and a box that can grow

**Shipped.** Issue 0020, three asks in one.

| | |
|---|---|
| ![Annotate from the picture](docs/changelog/shots/n37/01-annotate-from-the-picture.webp) | **Annotate and × live on the picture.** The strip that repeated every image is gone. |
| ![Wider](docs/changelog/shots/n37/02-wider.webp) | **⇤ Wider**: most of the page, the words on the left and the pictures on the right. |

### On the picture, not beside it

N35 put an Annotate button on each dropped-in picture — in a strip under the box that showed
every image a second time. One more thing to scroll past, and it went on showing a picture
after it had been deleted from the text. Every picture in the description now carries
**✎ Annotate** and **×** on its own corner, with an *annotated* mark once it has been drawn on.

It is a real node view, not an overlay guessing at positions. And the picture carries its
**own number** through the editor now — in the image's title, which markdown carries through
a parse and a serialise and which is stripped before anything is stored. Before, the editor
only knew a picture by its data URL, so two identical pictures were indistinguishable and
annotating the second could have changed the first.

### Deleted means not sent

Deleting a picture from the text left it in the upload. This issue is its own evidence:
`0020-image-1.png` is attached and nothing in its text points at it — the wrong picture, dragged
in, deleted, and filed anyway. Now only the pictures the text still refers to are sent, in the
order the text refers to them, and the references are renumbered to match, because the server
resolves `attachment:N` by position. The hint under the box says *"2 in the text — only those
are sent"*.

### A box that can grow

**⇤ Wider** in the corner takes the drawer to most of the page: the description on the left
with a taller editor, the captured context and screenshots on the right. It is remembered in
this browser — a preference about a screen, not something anybody else needs.

Also: StarterKit ships a Link extension in TipTap 3 and the editor was adding a second one,
which is what the console's *"Duplicate extension names found"* warning was about. And intake
titles may run to 80 characters now, which fits this issue's first sentence whole.

**43 of 43 properties hold.**

---

## N38 — Two kinds of data, and a wall between them

**Shipped.** The first step toward real Affinity data, and nothing contacts Affinity yet. The
tool now runs in one of two profiles. **Demo** is the fictional data every earlier entry was
built on. **Real** is where the raise will live. They never share a database, a folder, a
port, a build directory or a cookie. Everything that could move real data somewhere it
shouldn't go now refuses to. The plan for the rest, with your decisions, is
`docs/15-affinity-integration.md`.

| | |
|---|---|
| ![Data](docs/changelog/shots/n38/01-data-page.webp) | **Developer → Data.** Which profile this server is, where it keeps things, the two profiles side by side, and the ten guards, each with the file that enforces it. |
| ![Demo badge](docs/changelog/shots/n38/02-demo-badge.webp) | **The badge.** Every page says *Demo data* or *Real data* next to the sync line. The real one is clay, with a clay strip across the top of the window and *Real ·* in the tab title. |
| ![Strategy, all vehicles](docs/changelog/shots/n38/03-strategy-all-vehicles.webp) | **Found on the way.** With *All vehicles* selected, the rail's Strategy link was a 404 in both profiles. A strategy is a reading of one raise, so it now asks which. |

There is no screenshot of the real profile, and there won't be one. The screenshot script
asks the server which data it's showing and stops unless the answer is demo.

### Two profiles

`npm run dev` is the demo, as before: port 3000, reachable from the local network, and
its database moved from `local/capital` to `data/demo/database`. `npm run dev:real` is the
real profile: `127.0.0.1:3100`, so nothing else on the network can reach it, and all of it
lives in `data/real/`. Git ignores everything under `data/` except a README.
`DATA_PROFILE` decides which, read once in `config/deployment.ts`. A typo like `rael`
throws rather than quietly showing the demo to somebody who thinks they're looking at the
raise.

The plan said to keep real data outside the repo, in `~/Library`. You preferred the repo,
so other tools on the machine don't poke at it, which is where it is. The plan also said to
separate the two servers' cookies with a `real.localhost` hostname. That needs either a
hosts-file entry or a browser that special-cases `*.localhost`. Profile-specific cookie
names do the same job in any browser.

### What refuses

- `seed()` refuses the real profile. The check is in the seed itself, so no future caller
  can forget it.
- `db:reset`, `db:seed` and `npm run demo` refuse the real profile. The real database will
  hold reviews, adjudications and confirmed evidence, and those exist nowhere else.
- In the real profile, `DATABASE_URL` is refused and `PGLITE_DIR` is ignored.
- Feedback filed from the real profile goes to `data/real/issues/`, pictures included. It
  may quote real data, so it never reaches `issues/` or a commit. The feedback box and the
  issue pages say where they're writing.
- A **lock file** beside each database stops a second process opening it. When that
  happens PGlite doesn't fail; it corrupts the directory. `db:reset` while the dev server
  was running used to be a way to do that. Now the second opener refuses by name: *"open in
  pid 68178 — stop the dev server first."*

Three new properties hold those guards in place. Each one runs in a child process started
in the real profile: every path stays under `data/real` even when `PGLITE_DIR` points
elsewhere, a remote database is refused, and seeding refuses before it touches the
database. **46 of 46 properties hold.**

### The init file

The demo starts from fixtures. The real profile starts from `data/real/init.jsonc`, which
the tool copies from `config/init.real.template.jsonc` the first time it starts. It holds
who is on the team, which vehicles exist, and which Affinity lists track each one. It's
JSON with comments, because the comments are the questions. Every null in it is an unknown
that stays visibly unknown: the Data page lists each one as a question, instead of the tool
filling in a default. Besides people and vehicles, it asks eight things. Among them: where
"signed and countersigned" is recorded today, which Affinity field (if any) means an
amount, whether anyone must not be approached, and which SPV is 506(b). A vehicle's
exemption is required and never defaulted, because it decides what may be said in public.

Loading is all or nothing, and it adds and updates but never deletes. A person removed from
the file may still be the author of a review. The plan had this as its own version (N39).
It moved into this one because the real profile can't open without somebody on the team.
I've prefilled your copy with what you told me: the two Neurotech list names, notes for
Neurotech only, and that the SPV lists have "SPV" in their names.

Until a connector has delivered, every real page carries a notice that its figures come
from an empty database. Read a zero there as *not loaded*, not as a fact about the raise.

### Also

- CLAUDE.md has a new section, *Real data*, and the "no connectors before L13" rule has one
  exception: Affinity, read-only.
- The sync line in the real profile reads *"Nothing imported yet · init file loaded 2 min
  ago"*. Before, it would have said *"Seed data"*, which would have been false.

**Next, N39:** the GET-only Affinity client, the key through 1Password, and a connection
test that settles the plan tier with the API's own answers.

---

## N39 — A key that can write, and a client that won't

**Shipped.** The client that will read Affinity, and the page that shows what it may ask
and what it has asked. The real profile has no key yet: the 1Password CLI isn't installed on
this machine, so it starts without one and says so. Everything here was exercised against a
fake Affinity in the demo, and against scripted answers in the property harness.

| | |
|---|---|
| ![Connection tested](docs/changelog/shots/n39/01-connection-tested.webp) | **Developer → Affinity**, in the demo, after *Test the connection*: the account, whose key it is, what its grant allows, the plan tier the limits imply, the budget, the eight allowed paths and the request log. The account is invented; the page says so. |
| ![Guesses](docs/changelog/shots/n39/02-guesses.webp) | **Three new guesses**, labelled as such on Developer → Settings: this tool's pace, its share of the account's month, and the floor it leaves for everything else. The count in the sentence above the list is computed now; it had said "nine" for a while after there were ten. |

### Read-only, in code

Affinity keys aren't scoped, and yours can write. So read-only lives in one function,
`guardedFetch`. It refuses any method but GET, any body, any host but `api.affinity.co`, and
any redirect, before `fetch` is called. Nothing outside `lib/connectors/affinity/` may name
Affinity's host or the key's variable, and `npm run boundaries` fails if anything does.

The paths come from Affinity's own OpenAPI description (v2, 2026-07-15), not memory. Eight
are allowed so far: whoami, the rate-limit endpoint, lists and their fields, a field's
dropdown values, saved views, and users. List entries and notes join the list in the
versions that read them, so each addition shows up in a diff and on the page.

Eight new properties test the rules on the client itself, with a scripted transport where
the network would be:

- POST, PUT, PATCH and DELETE are refused, and none of them reaches `fetch`.
- A path that isn't on the list is refused and logged.
- A next-page link to another host is refused, so the key never goes there.
- The key appears in no error and no log line, even when the answer quotes it back.
- A 429 waits as long as Affinity says, tries again, and gives up after four tries.
- Under the monthly floor, the client stops before sending.
- The demo profile can't build a transport that reaches Affinity. It doesn't read the key,
  even when the shell has it set.
- The connection test reads the tier from the account's limits.

**54 of 54 properties hold.**

### The plan tier, measured

Affinity leaves out the monthly-quota headers when the account has no monthly cap, and only
Enterprise has none. Scale and Advanced both get 100,000 requests a month. So the test can
say *Enterprise*, or *Scale or Advanced*, and no more than that. The difference between those
two is Data Share, which the API can't see.

One finding from the spec: Affinity's OAuth has an `api.read` scope, a token that Affinity
itself refuses to write with. If we can register an OAuth client for this tool, read-only
holds on their side too. Worth asking Affinity.

### The key

`npm run dev:real` now runs through `scripts/with-affinity-key.sh`. It reads the 1Password
item *"Affinity API - App: plcos-claude"* and hands the key to the server's environment. The
key is never on disk, never echoed, and never on a command line where `ps` would show it.
Without the CLI it starts anyway and the page says what's missing.

### Found on the way

The first screenshot showed *"1 of 4 connectors synced"* after the test. A connection test
fetches no records, so marking the source synced was wrong. On real data, it would also have
removed the *nothing imported yet* notice. The test now changes only the source's
description. And migrations are append-only from here on, noted in CLAUDE.md: the real
database can't be reset, so an applied migration file must never change.

**To use it:** `brew install 1password-cli`, then in the 1Password app turn on Settings →
Developer → *Integrate with 1Password CLI*. Restart `npm run dev:real`, open Developer →
Affinity, and press *Test the connection*.

---

## N40 — Smaller pictures

**Shipped.** Issue 0021: the repository had grown past 100 MB, and 119 MB of the working
tree was changelog screenshots. They're 26 MB now, and the tools keep them that way.

| | |
|---|---|
| ![The changelog, in WebP](docs/changelog/shots/n40/01-changelog-webp.webp) | **Developer → Changelog**, every picture now a WebP. The route that serves them accepts WebP, and still accepts PNG so an older checkout renders. |
| ![Issue 0021](docs/changelog/shots/n40/02-issue-0021.webp) | **The issue, answered.** Its title shows *(>100MB)* again. It had arrived as `(&gt;100MB)`. |

### Smaller

Captures are taken at 2× and were committed as 2880 px PNGs, 620 KB on average, the
longest at 1.8 MB. They're 2000 px WebP at quality 80 now. That's plenty sharp on a wide
screen, the lightbox never shows more, and it can't be told from the PNG at reading size. I
compared crops before choosing: PNG reduced to 256 colours was 2.5× smaller, JPEG at 85
barely smaller at all, and WebP 4–5× smaller. Across all 194 files: **119 MB → 26 MB**. The
191 links in this file point at the new names.

### In the tools, not just a note

- `npm run shots` writes WebP straight from the capture and prints each file's size.
- `npm run shots:compress` converts anything that arrives as a PNG and fixes its links.
  It's how these 194 were converted.
- `npm run boundaries` fails on a PNG in the screenshot folder, or on any file over 512 KB.
- CLAUDE.md, *Working notes*, says all of it for the next agent. The encoding lives in one
  place, `scripts/shot-image.ts`, so capture and conversion can't drift apart.
- The build-log page copies the WebP files as they are, instead of resizing each PNG with
  `sips`, which only exists on a Mac.

### Not yet: the history

The old PNGs are **131 MB of the 138 MB** in `.git`. Until they're gone, converting makes the
repository about 26 MB *bigger*: the WebP copies are added and the PNGs stay in every earlier
commit. Dropping them from history would take `.git` from about 141 MB to about 33 MB.
N37 and everything before it are already on GitHub, so this means a force-push, and every
commit gets a new hash. That's for you to say yes to, and it hasn't been done.

### Also

The `>` in the issue's title had become `&gt;`. The editor wrote `<`, `>` and `&` in text as
HTML entities, and the body carried them into the title. The issue renderer builds React
elements rather than HTML, so the characters themselves are safe to store. They're stored
as typed now, and a literal `&gt;` that somebody types still survives.

**54 of 54 properties hold.**

---

## N41 — Which lists, by name

**Shipped.** List discovery. It's the first read that will tell us something about the real
account, and it's built so that nothing it reads is about a single LP. It reads every list the
key can see, each list's fields, and the account's users, and lands them all raw. It reads
no list entries. It's tested against the fake Affinity in the demo, and waits for the key
in the real profile.

| | |
|---|---|
| ![Lists discovered](docs/changelog/shots/n41/01-lists-discovered.webp) | **Developer → Affinity → Lists**, in the demo, on its second run. 9 lists, 30 fields and 4 users seen, and *0 new or changed*, because landing is idempotent. Below that: what the init file asked for and what matched, two SPV lists nobody claims yet, the team matched to Affinity users, and every list with its fields folded away. |
| ![From the Affinity page](docs/changelog/shots/n41/02-from-the-affinity-page.webp) | **Developer → Affinity** now has a *Lists* card between the connection and the budget, saying how many lists the key can see and when discovery last ran. |

### Matched means matched

The init file's list names are matched to Affinity's with case, spacing and the kind of dash
set aside. People type a hyphen where Affinity shows an em dash, and that isn't a different
list. Anything looser is shown as a suggestion ("Closest: …") and imports nothing until the
file gives the exact name. An import that quietly read the wrong list would be worse than one
that refuses to start. The coverage line says what an empty match can and can't mean: a list
the key's owner can't see reads as *no list by that name*, not as *no such list*.

Team members are matched to Affinity users by `affinityEmail`. When only their ordinary
`email` matches, it's marked **probably**, and the page says how to confirm it.

### Found on the way

- **Field ids aren't numbers.** Affinity's are slugs like `field-1234`, but the allowlist
  accepted only digits in every id position. The dropdown-values path, which the stage
  questions will need, could never have been asked. Field ids now accept slugs, and a
  property checks that nothing else, a dot or a capital letter, gets through.
- **Runs are records.** A new table, `sources.sync_run`, in a *new* migration file, per the
  append-only rule. A run that stops halfway still records what it got, because "we have 40
  of 60 lists" is different from "we have the lists".

Three new properties: discovery run twice stores nothing the second time; dash-insensitive
matching, where a near miss is only a suggestion; and slug field ids. **57 of 57 properties
hold.**

**Next, once the key works:** press *Discover lists* in the real profile. The init file's
Neurotech names will match or they won't, and the SPV candidates will show which lists to
add. Then the first slice: entries on the matched lists, their organizations and people,
and note text for Neurotech only.

---

## N42 — The first slice, and a run that waits to be told

**Shipped.** The first read of what's actually on the lists. It covers the two lists the init
file names for Neurotech, and the lists that say SPV. Everything lands raw, and nothing is
translated yet. Along the way, the Affinity key moved from 1Password to the macOS Keychain.

| | |
|---|---|
| ![Held](docs/changelog/shots/n42/01-held.webp) | **Developer → Affinity → First slice**, held. It read the entries (13 in the fake Affinity), counted what the rest would cost, and stopped: about 15 requests, over the demo's ceiling of 10. Two ways on: notes only, or notes and relationships. Each approves its number and a quarter more. |
| ![Read](docs/changelog/shots/n42/02-read.webp) | **After the go-ahead.** 5 notes for 9 entries, 6 relationship sets, and what landed, by kind. *11 versions* of 10 lists: one list changed since discovery, and the old version was kept beside the new one. |

### What the slice reads

- **Every entry** on each list, with all four kinds of field value, a hundred to a request.
- **Note text**, only where the vehicle's init entry says `importNotes`. That's Neurotech,
  as you decided, and never an SPV list.
- **Relationship strengths to the team**: the strongest hundred per person, only on a People
  list a vehicle claims.

Meeting and email metadata isn't read on its own. The lists' *Last email* and *Last meeting*
fields already say when someone was last in touch, and the account-wide email and meeting
endpoints can't be filtered by person. Five more paths are on the allowlist, and each one
says what it's for.

### Estimated before it is spent

Entries are cheap, and reading them is how the number of people becomes known. Notes and
relationships cost a request per entry, so that part is estimated first. A run whose estimate
is over `config.affinity.sliceCeiling` (3,000, a guess) holds. Approving it approves a number,
not whatever the run turns out to cost. And the approver is a person: CLAUDE.md says no tool
accepts its own proposed task, so I don't press the button myself.

**On the real account**, the slice read every entry on the four lists in 24 requests and held.
Its per-entry reads came to more than 3,000, so it's waiting for you. It's well inside this
tool's monthly share either way.

### The key, in the Keychain

1Password's CLI integration authorizes a whole account. While it's unlocked, any process that
runs `op`, me included, could read any secret in it. The key is now one macOS Keychain item,
stored with no app trusted to read it, so every read asks you about that one item.
`npm run key:store` creates it, prompting for the key without echoing it, and `key:status`
and `key:forget` do what they say. This is for local development only. A deployment gets its
own secret store.

### Found on the way

- **A repeated parameter.** Affinity takes several field types as
  `?fieldTypes=list&fieldTypes=global`, and the client could only set one value per name. It
  sends lists as repeated parameters now, and a property checks the URL.
- **One refused list no longer ends a discovery run.** A 403 on a list's fields is now a gap
  that's recorded, and every other list is still described. Running out of budget still
  stops the run.
- **Runs keep what they knew.** Migration `003` adds a *held* state and a `detail` record: the
  estimate, the lists read, the gaps. The go-ahead is bounded by the stored estimate, not by a
  number parsed out of a sentence.
- **Runs happen in the background.** A slice can take minutes, so it runs in the real
  server's process and the page refreshes itself while it does. A run cut off by a restart
  says *interrupted*, not *running*.

Four new properties: over the ceiling nothing per-entry is asked; note text only where the
init file allows, never on an SPV list; a second run stores nothing new; and repeated
parameters. **62 of 62 properties hold.**

---

## N43 — What's in the slice, and what only you can answer

**Shipped.** The inventory: what the slice landed, described field by field, with the
second round of questions generated from it. It names nobody outside the team.

| | |
|---|---|
| ![Inventory](docs/changelog/shots/n43/01-inventory.webp) | **Developer → Affinity → Inventory**, on the fake Affinity. Questions first, then notes (1 of 5 mentions health: flagged, not shown), relationships in Affinity's own bands, and every list field by field: how full it is, every dropdown value with its count, date ranges, amounts described but not summed, and how recently people were in touch. |
| ![Questions](docs/changelog/shots/n43/02-questions.webp) | **The questions** are written from the data: which dropdown is the stage, and which rung of the ladder each of its values actually evidences; which amount, if any, means signed; who owns the rows; team members the init file is missing; which vehicle each SPV list is. |

### Counts, not people

The page and its report (*Write it to data/…/reports/*) list a dropdown's values, because
those are the words a stage is written in. They list the team's names, because the team owns
the rows. They list nobody else: no LP, no text field's contents, no note's words. A property
checks it on the fake Affinity by looking for invented LPs' names and for words from the
invented notes.

**Amounts are described and never summed.** Nobody has said yet whether a field holds an
indication or a signature. Adding up an unknown is how a "committed" figure gets invented
(rule 1).

**Health detail is counted and flagged, never shown**, and it's never copied into anything
derived from the note (Report 4 §6.2). The pattern errs toward flagging. It leaves out
*treatment*, *condition* and *recovery*, which in fundraising notes usually mean tax
treatment, closing conditions and fee recovery.

### On the real account

It ran on the entries the slice has landed so far; notes and relationships wait for the
go-ahead. It produced **18 questions**. Besides the stage and amount questions for each list,
they include:

- team members who own most of the rows but aren't in the init file;
- entries already marked do-not-contact, which should become do-not-approach instructions
  before any route is suggested (rule 8);
- people on both a Neurotech list and an SPV list, where cross-vehicle conflicts will come
  from;
- a clue to where Rails might be tracked.

They're in the report at `data/real/reports/inventory-2026-09-23.md`, which never leaves this
machine.

**63 of 63 properties hold.**

**Next:** your answers. They decide how each list's words are read: which values count as
which rung, and whether any amount is hard. Translation into the model comes after them, so it
doesn't have to guess.

---

## N44 — An answer sheet for round two

**Shipped.** The inventory's questions as blanks to fill in. For each list, the sheet asks
which field is the stage, which rung each stage value actually evidences, which field is the
amount and whether it means soft or hard, who owns the rows, and which field says
do-not-contact. It's written to `data/<profile>/answers.jsonc`, beside the init file.

| | |
|---|---|
| ![Answer sheet](docs/changelog/shots/n44/01-answer-sheet.webp) | **The sheet, shown on the Inventory page.** Every value of the stage field is listed with how often it's used, next to an empty slot for its rung. The words' suggestion is a comment, never the answer: *"Soft circle": null // the words suggest indication_given*. |
| ![A wrong answer](docs/changelog/shots/n44/02-a-wrong-answer.webp) | **Two answers given, one of them wrong.** *2 of 38*, and the mistake named: "signed" isn't a rung. It counts as unanswered, and regenerating the sheet keeps it in place for whoever wrote it to fix. |

### Why every value starts as null

A default here would decide the thing the whole tool is careful about. If "Soft Commit"
defaulted to *commitment accepted*, soft would have blended into hard without anyone saying so
(rule 1). If "Contacted" defaulted to a rung, the gap between claimed and evidenced would
disappear (rule 2). So the answers are nulls, and a null is read as *unknown*, never as its
likeliest meaning. The suggestions are there to save typing, not to be believed. "Documents
Signed" suggests *commitment_accepted, if countersigned; otherwise indication_given*, because
the word *signed* doesn't say who else signed.

### Regenerating keeps your answers

The sheet is generated from what's actually in the lists, so it can be regenerated when the
lists change. Regenerating keeps every answer given, including one that doesn't validate: a
mistyped rung is reported and left in place for its author, not erased by the tool.

**On the real account**, the sheet has been generated for the four lists and is waiting at
`data/real/answers.jsonc`.

Three new properties: a fresh sheet answers nothing; regenerating keeps answers; and a rung
that isn't a rung is refused by name and survives regeneration. **66 of 66 properties hold.**

---

## N45 — The team, the old list, and SPVs kept for their history

**Shipped.** Your answers from the inventory, put to work: the team prefilled from Affinity,
the old Fundraising list checked against the LP Pipeline, the SPVs brought in as history, and
overlaps across vehicles described as something to coordinate.

| | |
|---|---|
| ![Lists compared](docs/changelog/shots/n45/01-lists-compared.webp) | **Older lists, against the one in use.** For each vehicle with more than one list: entries already covered by the same person, covered by the same organization, missing from the list in use, and linked to nobody. The page counts. The names go to a report in `data/<profile>/reports/`. |
| ![History](docs/changelog/shots/n45/02-history-tag.webp) | **A vehicle kept for its history**, tagged in the rail. The demo gained one, *SPV — Meridian (2025)*, so the tag can be seen here. |

### The old list

You said the Neurotech Fundraising list is old and unused. Before it's treated as history, the
comparison finds its entries whose people, and failing that organizations, aren't on the LP
Pipeline, so they can be moved across rather than lost. The first list the init file names
for a vehicle is the one in use; each other list is compared against it. **On the real
account**, most of the old list is already covered. The rest, mostly entries still at the
first stage, are listed by name in the report.

### SPVs kept for their history

Vehicles have a **phase** now, `active` or `historical`, in a new migration. The two SPVs in
Affinity didn't go through, but they show who was approached, how far each got, and the people
they touched. They're historical vehicles: in the rail, tagged, and kept out of every current
figure. Their exemption is **unknown**, which only a historical vehicle may be. It's not a
default: the accreditation gate used to check only vehicles marked 506(c), so an unknown
would have let money through unverified. It now reads unknown as 506(c).

### The team

You asked for the init file to be prefilled with the team members Affinity shows, leaving out
someone who has left. It now has eight more people: those who own entries, and the team's own
introducers. People across the PL network who appear only as the source of an introduction
weren't added; they're connectors, and they become people with relationships when the network
is translated.

### Coordinate, not compete

An LP on two vehicles' lists is usually good for them and for us; it needs sequencing, not a
winner. The inventory says *coordinate* now. CLAUDE.md, under rule 5, records the distinction:
"coordinate" for an overlap, "conflict" only for two asks that would actually collide.

### Found on the way

The inventory promised to name nobody outside the team, and it listed every dropdown value.
An SPV list has an "Organization (LP)" dropdown, and its values are LP names. Values that look
like names — many distinct values, or a field named for an entity with more than a handful —
are now counted and not listed. A property holds both sides: names withheld, a stage
vocabulary and a yes/no shown.

**68 of 68 properties hold.**

---

## N46 — Our stages, and what Affinity's words mean in them

**Shipped.** The pipeline statuses on our side, and a mapping from each Affinity list's status
words into them. The mapping is proposed, marked unreviewed, and kept in a file you can edit.

| | |
|---|---|
| ![Our stages](docs/changelog/shots/n46/01-our-stages.webp) | **Developer → Affinity → Mapping.** Our twelve stages in five groups, what each means, and the ladder rung each one *claims*. Outcome and reason are kept apart from the stage. |
| ![A list, mapped](docs/changelog/shots/n46/02-a-list-mapped.webp) | **One list, mapped.** Every status word with how often it's used, what it means here, and what that claims. Below: which field holds the commitment, the typical check, the AUM, the owner, the introducer and a do-not-contact mark. |

### Twelve stages, and three things one field was holding

You said the team used the LP Pipeline's status to slice a project board, so one field carried
several things. Here they're three: a **stage** (where the work is), an **outcome** (open, on
hold, passed, lost) and a **reason** (thesis, timing, valuation, and so on). "Passed – Timing"
is an outcome and a reason, and "On Hold – Soft Commit" is a stage with an outcome. The stages
adopt the granularity the team already found useful: prospecting, outreach, engaged, closing,
funded, twelve stages in all, and easy to group back into five for a board.

Each stage **claims** a ladder rung: *scheduling a first call* claims the target opted in,
*soft commit* claims an indication, *signed* claims a commitment. A claim is shown beside the
ladder and never written into it; the ladder still moves only on evidence. A property checks
that no later stage claims less than an earlier one.

### The mapping

`data/<profile>/mapping.jsonc`, one block per list. You asked for a proposal, so each status word
gets a meaning from the word itself, and each list says `reviewed: false` until someone sets it
true. A word the proposer can't place stays null. Regenerating after a new read proposes only
what's new and keeps every edit, a deliberate null included. A stage that isn't ours is refused
by name.

**On the real account**, the proposer placed all but one of the status words across the four
lists, and I proposed the last one by hand in your local file for you to confirm. The old
Fundraising list is marked *history*, so it isn't translated. The SPV lists read their richer
board-stage field first and fall back to the plainer ones.

Your answers on the amounts are in the mapping. The committed amount is the commitment: soft
until countersigned, with a *signed* stage marking it ready to harden. The typical check size
is kept, as their own figure or our guess. AUM is a claim to verify later, filed as **issue
0022**. The do-not-contact field is the one the inventory found.

### Written down

`docs/16-affinity-ingestion.md` records the whole path, as you asked: read, inventory,
mapping, translation. It says what each step costs, what it keeps, and what to re-run when
something is wrong. It also sets out the cheaper way to read notes when the time comes: one
request to count every note in the account, then a hundred notes to a request, filtered to
Neurotech before anything is stored.

**69 of 69 properties hold.**

---

## N47 — The landed copy, translated into the tool

**Shipped.** Translation: the local copy of Affinity, read through the mapping, into the
tool's own tables. It makes no request to Affinity and can be re-run safely. For the first
time, the real profile's pages show the raise instead of an empty database.

| | |
|---|---|
| ![Translated](docs/changelog/shots/n47/01-translated.webp) | **Translate into the tool**, on the Mapping page: pursuits by vehicle, new people and organizations, soft commitments, claims, do-not-approach instructions, what's ready to harden, and which lists were read through a mapping nobody has reviewed. |
| ![Claim beside evidence](docs/changelog/shots/n47/02-claim-beside-evidence.webp) | **Where the pursuits stand**, on Vehicle status: the 25 furthest along, not all of them. The ladder column shows what's evidenced ("Nothing on file"); beside it, what Affinity says ("Affinity: Signed"). The gap between them is the work. |
| ![A translated pursuit](docs/changelog/shots/n47/03-a-translated-pursuit.webp) | **One pursuit.** *Affinity says "Signed" → Signed · claims Commitment accepted — nothing on the ladder is evidenced yet.* The owner is kept by name because they aren't on the team. The check size and AUM are claims with their list, date and confidence. |

### What it writes, and the rule each follows

- **People and organizations**, joined to Affinity by source record. A person's current
  organization becomes an affiliation whose capacity isn't established: a CRM row doesn't say
  who decides.
- **Pursuits**, one per entry on a pipeline list, with our stage, outcome and reason, and what
  Affinity said and when. **The ladder isn't touched**, because no stage is evidence. An owner
  who isn't on the team keeps their name on the pursuit, under a placeholder nobody signs in
  as.
- **Commitments are soft, always.** A *signed* stage marks one ready to harden once
  countersigned. It doesn't harden it: that takes the close room's evidence and a MONEY ticket
  (rule 1). On a historical vehicle the money is closed, so no current figure counts it.
- **Check size and AUM** become research claims, with the list as their source document. AUM is
  low confidence and unverified (issue 0022).
- **Do not contact**: a yes becomes a blanket do-not-approach restriction on the person, which
  every route is checked against (rule 8).

Six properties hold it to that: nothing becomes hard and the ladder doesn't move; a signed
stage stays soft and is marked ready; do-not-contact becomes a restriction; a second run adds
nothing; a mapping edit takes effect on the next run; and a historical vehicle's money is
closed. **75 of 75 properties hold.**

### On the real account

The real translation produced about two thousand pursuits across Neurotech and the two
historical SPVs, a few dozen soft commitments, a few hundred claims, and two do-not-approach
instructions. Every page renders with the data in it. Two things the real data showed at once
were fixed:

- **"Pursuits open" counted every pursuit**, closed and historical ones included. It counts
  open ones now, and a historical vehicle says *history · N pursuits*.
- **A hard figure of $0 on its own reads as "nothing committed".** It stays $0: no
  countersignature is recorded in the tool yet, and the headline is hard-only. Today now says
  exactly that beside it, and how many commitments are signed per Affinity and waiting on
  Soft → Hard.

### Found on the way

The fake Affinity's people shared names with the demo's seed. Translated into the demo, they
would have become a second person of the same name. They've been renamed, so the demo shows
one of each.

---

## N48 — Pricing the notes before reading them

**Shipped.** You asked whether notes could be fetched in fewer requests. This version measures
the cheaper way without reading a single note.

| | |
|---|---|
| ![Notes counted](docs/changelog/shots/n48/01-notes-counted.webp) | **Notes, the cheaper way?** on the First slice page. One request asks Affinity how many notes the account holds (`limit=0`, so none come back), and the card sets reading them in bulk against reading them entry by entry. |
| ![Allowlist](docs/changelog/shots/n48/02-allowlist.webp) | **`GET /v2/notes`** joins the allowlist, saying what it's for. Only the count uses it so far. |

Per entry, notes cost a request for every entry on a list that imports them. In bulk, they
cost one request per hundred notes *in the whole account*, and every note would pass through
in transit, to be kept only if it belongs to a Neurotech entry. **On the real account**, the
count makes the bulk read cheaper by more than an order of magnitude. Whether it's acceptable
for notes on other lists to pass through and be dropped is your call, and nothing reads a note
until you make it.

Relationships have no bulk endpoint; each person is one request. The cheaper version of that
is to read them only for the pursuits that have got somewhere.

A property checks that the count costs one request and lands no note. **76 of 76 properties
hold.**

## N49 — Every note, once

**Shipped.** You asked for the notes to be replicated rather than filtered: every record
downloaded once, then only what changes, and notes on other lists kept for later. That's what
this version does, and on the real account it's done.

| | |
|---|---|
| ![Every note](docs/changelog/shots/n49/01-every-note.webp) | **Developer → Affinity → Notes.** The count comes first (one request, no note returned), the read is approved as that number, and the page then says what landed, in counts only: by kind — note, meeting note, email note, notetaker summary — by year, by author (the team by name, anyone else counted), what they're attached to, and how many concern someone on each list we read. |
| ![On the LP](docs/changelog/shots/n49/02-on-the-lp.webp) | **On an LP's page**, the team's notes about them, newest first, with who wrote each and when, and "via their firm" for a note on their organization. A note that mentions someone's health stays closed until it's opened. The same page now reads its claims as figures ("$2.4B, their claim, not verified") rather than `aum_usd 2400000000`. |
| ![Only what changed](docs/changelog/shots/n49/03-only-what-changed.webp) | **The second read** asks only for notes created or edited since the first began, less a day, and here finds none: two requests. Reading everything again is how a note deleted in Affinity leaves the copy. |

**How.** `GET /v2/notes` pages through every note in the account, a hundred to a request.
Affinity's spec has an `includes` parameter that I'd missed in N48: with it, each note arrives
with the people, organizations and opportunities it's attached to. So one pass gives the text,
the author, the date and the links, where I had assumed linking would cost a request per note.
The read stops if it would go past the number approved, and a page whose next URL drops
`includes` gets them back — both checked by properties.

**On the real account**, about five thousand notes in 54 requests: exactly the estimate. Two
things it showed:

- **Most notes about an LP are on their firm, not on them.** Counting only notes attached to
  the person on the list found less than half of what counting their organization too finds. A
  note on the organization the list gives as theirs now counts for them, and shows on their
  page.
- **Most notes are about neither.** Nearly nine in ten concern firms and people on none of the lists
  we read. They're kept as you asked, and they show nowhere until someone they're about
  appears in the tool.

**Retired:** the per-entry note endpoints (off the allowlist), the slice's note phase, and the
init file's `importNotes` (still accepted, now ignored). Relationships remain per person and
held. Replies aren't in the bulk list; they're counted, and there are very few.

Also fixed: the first real attempt failed on a stale connection ("fetch failed", in half a
second), so a network failure is now tried twice more before it counts, and the log says which
failure it was.

**82 of 82 properties hold.**

## N50 — Six statuses, and "target" retired as a word for an LP

**Shipped.** You said the twelve stages weren't landing, and proposed six statuses with
meetings, research, the money and interest each kept apart. This is the status part of that,
and `docs/17-pipeline-model.md` is the model as a whole. My view on whether it's overkill:
it's less than what it replaces. The twelve stages were trying to say in one field what the
log, the close room and the ladder each say better.

| | |
|---|---|
| ![Pipeline](docs/changelog/shots/n50/01-pipeline.webp) | **Pipeline**, which replaces Conversion strategy: six columns — New, Sourcing, Selected, Discussing, Committed, Passed — over one list. The ladder stays beside each LP, because a status is our plan and the ladder is the evidence, and the two are allowed to disagree. |
| ![Read from Affinity](docs/changelog/shots/n50/02-read-from-affinity.webp) | **An LP read from Affinity.** The status, where it came from, Affinity's own word, and what that word implies happened ("a meeting was held, in diligence") as a claim beside the ladder. An amount on the commitment field makes an entry Committed, whatever the word. |
| ![Set here](docs/changelog/shots/n50/03-set-here.webp) | **Set here, through the form.** Passed keeps who ended it (they declined, we stopped, it went quiet) and why. "Not now" is a dated next step rather than a status. The next translation keeps what a person set; if Affinity's word later reads differently, the page says so. |
| ![Mapping](docs/changelog/shots/n50/04-mapping.webp) | **The mapping**, in the new terms: each Affinity word gets a status, who and why where it ended, and what it implies. Unreviewed lists written in the old stages were proposed afresh; a reviewed one would have been converted, edit by edit. |

**Where I pushed back on the sketch, lightly.** Three changes. There's no "paused": on hold is
a dated next step on a status. A status change needs no ticket: it claims nothing, so it moves
neither the ladder nor the money, which keep theirs. And "LP opted in" replaces "target opted
in" on the ladder, so that "target" now means only a vehicle's size goal.

**On the real account**, 42 of the 44 words placed. About four in five of the Neurotech
list are Sourcing; the rest spread across Selected, Discussing, Committed and Passed roughly as
the old stages did. Committed is larger than the count of soft-commit and signed entries, because a handful of
others carry a committed amount; that rule is worth your look.
The two left are "On Hold" on its own, which says nothing about where the effort is; they're
flagged on the mapping page, and those entries fall through to the list's next status field.

The 12-stage columns stay in the database, unread: migrations are append-only. 85 of 85
properties hold, including that a status set here survives the next translation and that
setting one writes nothing to the ladder.

## N51 — The log: meetings, calls and emails, dated

**Shipped.** The second part of your sketch: meetings and touchpoints tracked apart from the
status, dated, so that "first meeting" and "second meeting" are counted rather than set.

| | |
|---|---|
| ![Pipeline with the log](docs/changelog/shots/n51/01-pipeline-with-the-log.webp) | **The pipeline, with the log added up**: meetings held, the last touch, "waiting on them" when our outreach is the last thing on record, and their latest read. Where the log has run ahead of the status — a meeting on record for someone still at Selected — it asks "Discussing?" rather than moving it. |
| ![The log](docs/changelog/shots/n51/02-the-log.webp) | **An LP's touchpoints**: the dated rows, and what they add up to — "3 meetings on record — first 21 Aug, second 10 Sep, third 20 Sep", the last touch, and their read with who recorded it and when. Rows read from Affinity say so and are tied to no vehicle, because Affinity's interactions aren't; logged ones name the vehicle. |
| ![The form](docs/changelog/shots/n51/03-form.webp) | **Logging one**: a meeting, a call, an email, an intro, an event, or a research pass, which has to say what it looked at and over what dates (rule 7). A read can only be recorded for something that has happened. |

**Where the rows come from.** Affinity already knows most of this. Each list entry carries its
last email and its last and next meeting, and the notes read in N49 include meeting, call and
email notes tied to an interaction. Translation turns both into touchpoints, keyed by the
interaction, so a meeting with a calendar entry and a note is one row, dated by the calendar.
No subject line, note text or outside attendee's name is copied. The meeting pages still show
only meetings and calls.

**On the real account**, about 1,800 touchpoints. About two in three Discussing LPs have a
meeting on record. So do some still marked "Contacted" in Affinity: their status is behind
their calendar, and the pipeline now says so. The last-email field gives most Selected LPs a
"waiting on them" date.

**Their read** is on the touchpoint, recorded by whoever was there. I recommended against a
standalone interest field and against computing one: the latest read, dated and attributed, is
the useful version, and a stale one looks stale.

A logged touchpoint is a record, not a claim. The ladder moves when someone asks for "meeting
held" with it as evidence, through the STAGE ticket as before. 87 of 87 properties hold.

## N52 — The close track: signed, hard, closed, and wires as amounts

**Shipped.** The money part of your sketch: soft → hard → closed, with when they signed
(including re-signing) and the wires, dated, to reconcile against.

| | |
|---|---|
| ![Committed](docs/changelog/shots/n52/01-committed.webp) | **Committed, with where the money is**: soft or signed (and whose claim the signature is), hard, closed, and how much has wired. The status says they said yes; this says how far it has got. |
| ![Signed per Affinity](docs/changelog/shots/n52/02-signed-per-affinity.webp) | **"Signed", per Affinity**: an undated signature, marked as Affinity's claim. The money stays soft. The team's note beside it says the documents came back countersigned, which is exactly the kind of thing the countersignature step exists to record properly rather than infer. |
| ![Signed again](docs/changelog/shots/n52/03-signed-again.webp) | **Signed, then signed again**: the second signature needs its reason ("their holding entity changed its name"), and the latest one counts. |

**The one change to your sketch.** You had hard commit "after signed". Here it's after
*countersigned*: their signature and our acceptance are two events, and CLAUDE.md rule 1
already puts the headline on countersignature, because a GP can cut back or decline until it
accepts. So the steps are soft → signed → hard → closed, with wires beside them rather than as
a step. A fund is called in parts, so wires are dated amounts, several to a commitment, never
more in total than it. Partial calls now count in part in the cash figure; before, a
commitment was all cash or none.

Most of this already existed — the soft and hard tracks, the close room's pack, the SPV room —
and the close track reads it. What's new is the event record for signatures, closings and
wires, and the forms on the LP page. Countersignature is still only the MONEY ticket on Soft →
Hard; it now writes its event in the same transaction. Also fixed: that ticket's label printed
dollars as millions ("Record $4000000.0M hard"); it's the text an approver reads, so it matters.

**On the real account**, the Committed LPs read as soft, or as signed per Affinity; nothing is
hard until countersigned here. 90 of 90 properties hold.

## N53 — Your review: a pipeline you can search, and what "passed" means

**Shipped.** Your notes on N50–N52, most of them in one place: the pipeline page.

| | |
|---|---|
| ![Search and filter](docs/changelog/shots/n53/01-search-and-filter.webp) | **Search and filters that change the numbers.** Every column's count reads **N** *of M* while anything is narrowing it. Search covers names, owners, Affinity's words and next steps (press <kbd>/</kbd>); filters cover owner, vehicle, meetings, last touch, their read, money, and two flags. It all runs in the page, so it's instant — about a tenth of a second across the two thousand real rows. |
| ![Sorted](docs/changelog/shots/n53/02-sorted.webp) | **Sort by any heading**, and click anywhere on a row to open the LP. The purple strip and badge now mark the demo, not the real data, since the real data is what you'll look at every day. The rail no longer says "history" beside the old SPVs. |
| ![Passed](docs/changelog/shots/n53/03-passed.webp) | **Passed means someone decided.** They declined, or we stopped. Silence isn't a decision, so an LP who never answered is back at Selected, with "waiting on them" and the date. "On Hold" on its own was your team's do-not-contact, so it's Passed: we stopped, do not contact, and so is every entry marked do-not-contact. |

**Do not contact, where it matters.** The mark shows where the person comes up: their row in
the pipeline, their page, and a route or an ask toward them. That last one is still enforced
(rule 8). It's no longer listed in Operations, Asks, or the visualizations.

**The upcoming meetings that weren't.** LP pages counted their firm's touchpoints as the LP's
own, so a colleague's next meeting read as theirs, and a firm's calls added to their meeting
count. Now only an LP's own touchpoints count. The firm's are shown in the log with its name,
plus one line: "3 more with their firm, not counted above." The Meetings page also stops
calling a meeting upcoming once its time has passed.

**On the real account**, all 44 of Affinity's words have a meaning. Neurotech reads Sourcing
1,604 · Selected 296 · Discussing 58 · Committed 14 · Passed 23: the no-reply entries moved
back to Selected, and the on-hold ones moved to Passed. 90 of 90 properties hold.

## N54 — The calendar: every meeting, dated

**Shipped.** You said to read Affinity's calendar if it could be done in bulk in under a hundred
requests. It can be read in bulk — a hundred meetings to a request, each with its attendees —
but not in under a hundred requests.

| | |
|---|---|
| ![The calendar](docs/changelog/shots/n54/01-the-calendar.webp) | **Developer → Affinity → Meetings.** There's no count for meetings, so a read has a hard cap (99 requests) and says when it stops there. The first read starts in 2024, so the cap isn't spent on the oldest years; after that, only what changed. |
| ![Dated meetings](docs/changelog/shots/n54/02-dated-meetings.webp) | **An LP's meetings, dated**: the first, the second, the next one, with who from the team was there. A meeting that a note and a "Next Event" field also name is one row, keyed by the meeting. The title and outside attendees stay in the landed copy; nothing else copies them. |

**On the real account**, the read stopped at the cap with 9,900 meetings, and there are more.
Affinity doesn't return them in date order, so those 9,900 cover every quarter since 2024 but
lean to the older ones. I stopped rather than go past your number. The ones read are true, so
they're translated: about 1,100 touchpoints, 900 of them meetings that include someone on our
lists. About two in three Discussing LPs now have a meeting on record, a third have had two or
more, and 22 LPs still at Selected have met. LP pages say the calendar read is incomplete until
it's finished.

To finish the window, either raise the cap for one read or read only the last year; both are
your call. 91 of 91 properties hold.

## N55 — The notes, read: a sentence each, and a suggested read

**Shipped.** You asked for more on each touchpoint from its note — a one-sentence summary, with
the whole text there if needed — and whether the notes could start filling in their reads:
"give it a shot to see what it looks like."

| | |
|---|---|
| ![A thread opened](docs/changelog/shots/n55/01-a-thread-opened.webp) | **A touchpoint with its note.** The meeting's title from the calendar, a one-sentence summary, and the note itself one click away, opening in place like a message in a thread. The summary is marked as Claude's; the note is Affinity's text, unchanged. A note with no summary shows its first sentence. |
| ![The notes, read](docs/changelog/shots/n55/02-notes-read.webp) | **The notes panel, read.** Each note leads with its summary; the full text is behind "the note". The status line says where the read came from: "suggested from a note". |
| ![Suggested reads](docs/changelog/shots/n55/03-suggested-reads.webp) | **Their read, suggested.** Dated by its note and marked *suggested*. It counts for nothing until a person confirms it, and a read someone took in the room outranks any suggestion older than it. |
| ![Confirmed](docs/changelog/shots/n55/04-confirmed.webp) | **Confirm or Not right.** Confirmed, it's the person's read, attributed to them and to the note. Not right dismisses it, and a dismissed suggestion stays dismissed when the notes are read again. |

**How the readings are made.** A reading is a summary, a read only where the note gives one
("asked for the data room", "not looking for new allocations"), and those words kept as its
basis. Nothing is scored. The readings sit in one file in `data/<profile>/`, written in a
working session, and the next translation loads them (docs/17 §4). To scratch and re-map, write
a new file: it replaces the summary and suggested read of every note it covers, and never
overrides a read a person has decided.

**Health.** A note that mentions someone's health is never read, whatever the file says. Before
reading, I widened the filter to catch tumour names, leave for a birth, and bereavement phrasing,
after one note got past the first version.

**On the real account**, I read every note attached to a pipeline LP or their firm: 406 now
have a summary. 38 give a read — 8 very interested, 17 interested, 13 not very interested. Most
of the rest are portfolio updates and DocSend views, which say nothing about an LP's interest.
120 emails are only a subject line, so they're shown as they are, and 2 notes were withheld for
health. 21 LPs now show a suggested read: 10 at Discussing, 6 Committed, 4 Passed, 1 Sourcing. A
suggestion can be stale: a note from before a commitment can still say "not very interested",
and that's what Not right is for.

Also fixed: comments from N53 and N54 dated your review 24 Sep; it was 23 Sep. 92 of 92
properties hold.

## N56 — One timeline, an icon for what happened, and health notes read with the detail redacted

**Shipped.** Your first note from the feedback box — "move notes in with touchpoints" — and your
answer about the two health notes: "fine to read them and process… (if so, make it clear in the
redacted text.)"

| | |
|---|---|
| ![One timeline](docs/changelog/shots/n56/01-one-timeline.webp) | **One thread.** An LP's touchpoints and the team's notes in Affinity are now one timeline, newest first: the meetings, calls and emails, and the notes between them. A note Affinity ties to a meeting, call or email opens inside that row rather than appearing twice. The notes panel is gone; its provenance line moved to the bottom of the timeline. |
| ![Questions and a redaction](docs/changelog/shots/n56/02-questions-and-a-redaction.webp) | **An icon for what happened**: a meeting, or one still ahead; a call; an email from them or from us; a deck view; questions asked; a number given; signed; declined; an intro; a portfolio update. The ones that change an LP's state have a colour too, and every icon also says in words what it is, with a key under the thread. The health note here reads "[health detail about her family redacted]". |

**Where the icons come from.** A touchpoint's icon comes from what it is. A note's comes from
its reading: one word from a fixed list, kept with the summary (migration 004, since the
timeline needs it). On the real account the 408 readings are tagged: 153 portfolio updates, 125
added to a list, 37 meeting notes, 21 background, 17 deck views, 11 declined, 8 a number given,
7 materials, 6 intros, 3 questions and 1 signed; 19 have no word, and show as a plain note.

**Health notes, read.** The two notes I'd withheld now have summaries, with the health detail
taken out and the brackets saying so. A reading of a note that mentions health loads only if it
carries that bracket and its own words pass the health check; anything else is still refused.
The note's text stays closed until someone opens it, as before.

**Two reads removed.** Two readings said "not very interested" because follow-ups had gone
unanswered. Silence isn't a read any more than it's a pass (N53), so those two now say nothing.

Also fixed: a readings file given by an absolute path was quietly replaced by the demo's; the
property now covers the refusals. Next is your second note, the ladder that didn't move after
meetings, and stale reads (N57). 92 of 92 properties hold.

## N57 — Reconciliation: the ladder caught up with the records, and reads that go stale

**Shipped.** Your second note from the feedback box: "meetings already happened, but the state
didnt move fwd… we may need to build in some reconciliation". And your note on staleness: "please
figure out how to resolve. you're organizing the data ingest and states." The design is
docs/18.

| | |
|---|---|
| ![On file, not accepted](docs/changelog/shots/n57/01-on-file-not-accepted.webp) | **Three layers on the ladder.** What it has accepted (solid), what the records here support that nobody has accepted yet (a dashed ring, with the record and a link to its proposal), and what Affinity's word claims (in amber, "a claim, with no record from them yet"). "Nothing on file" now appears only when nothing is. |
| ![Ladders behind their records](docs/changelog/shots/n57/02-ladders-behind-their-records.webp) | **Proposed, not recorded.** After each translation, reconciliation opens one STAGE ticket per LP whose records are ahead of the ladder. The ticket lists every rung and the record behind it: a meeting on the calendar, a reply from them, a signature recorded here. It's requested by a system actor nobody can act as. Affinity's words and the notes are claims and are never used. |
| ![Approved in one go](docs/changelog/shots/n57/03-approved-in-one-go.webp) | **Approved in one go, or one by one.** Proposals are one item on Approvals, opening a checklist. Each is still its own ticket with its own audit line. A rejection holds for those records; a meeting held since is a new record, and asks again. |
| ![Accepted](docs/changelog/shots/n57/04-accepted.webp) | **After approval**: connector not applicable (in direct contact), opted in and a meeting held, each dated by its record and attributed to whoever approved. Approving re-checks that the ladder hasn't moved, and never skips a rung. |
| ![Status behind the log](docs/changelog/shots/n57/05-status-behind-the-log.webp) | **The status, too.** With "Met, status behind" on, the pipeline offers to move those LPs to Discussing in one step. It's your call per LP, and each keeps its next step. |

**Stale reads.** A read is superseded when a later record points the other way: a commitment
after "not very interested", or a decline after "interested". It stays on the timeline, struck
through, with what superseded it, and stops counting as their read in the pipeline and its
filter. A read older than 180 days (a guess, in `config/deployment.ts`) is labelled old.
Nothing computes a read.

**On the real account**, the first run proposed 278 climbs from 2,143 pursuits: 154 to Meeting
held, and 124 to LP opted in on a reply from them. 1,694 were already in step; 171 were passed
or on a vehicle kept for its history. The page in your note, three meetings and nothing on the
ladder, now shows three rungs on file, waiting for approval. One Committed LP's "not very
interested", from a note written before they committed, is now superseded. The 278 are waiting
on Approvals; nothing is recorded until you approve.

Also: the user switcher no longer finds inactive users, so no one can become the system actor,
and the demo seed counts people, not the system actor. `npm run shots -- N57 04` retakes one
shot. 94 of 94 properties hold.

## N58 — Screenshots from the feedback box, drawn as the page is

**Shipped.** The feedback box's automatic screenshot, the one it takes as it opens, wrapped text
that the page doesn't: card titles on two lines, fact labels folded, the rail's vehicle names
stacked a word at a time. Your screenshots in the last two issues showed it.

| | |
|---|---|
| ![Captured as drawn](docs/changelog/shots/n58/01-captured-as-drawn.webp) | **The automatic capture, fixed.** It redraws the page through the browser's own engine, so it needs no permission and can leave the feedback panel out. That still holds: anything marked not-for-capture stays out. |
| ![Scrolled, full size](docs/changelog/shots/n58/02-scrolled-full-size.webp) | **Scrolled, too.** Taken 700 px down the page and opened in the annotation editor: the rail, the top bar and the demo strip are where they are on screen. |

**Why it wrapped.** Four things, found by comparing the capture with the browser's own
screenshot of the same page, pixel by pixel:

- **The fonts.** They came from Google Fonts, a stylesheet on another origin, whose rules a
  page can't read. The capture embeds only fonts it can read, so it drew in the fallbacks,
  which are wider. The fonts are now self-hosted from the `@fontsource` packages, Latin only,
  under the same names, so nothing else changed. A side effect: no page of the app asks a third
  party for a font any more, and they load offline.
- **An 8 px margin.** The redraw deliberately drops the root element's margins, so the page's
  `<body>` got a browser's default one back. Everything was drawn 8 px down and right, and
  16 px narrower. Zeroed.
- **Sticky and fixed elements.** The redraw is the page drawn once and moved up by the scroll,
  so the rail and the top bar went up with it. Each is now measured on the live page and put
  back where it is on screen.
- **Scrollbars** the page didn't show, one of them across the foot of the rail. Dropped.

Measured on Nadia Brandt's page at 1440 × 940, the capture differed from the browser's own
screenshot on 12.5% of pixels before; now 0.04% at the top of the page and 0.05% scrolled
700 px down. That's anti-aliasing. The design boards and the published build log still load
Google Fonts, since they are standalone pages. 94 of 94 properties hold.

## N59 — Only what's about the raise counts: raise windows, and contact history on the LP's own page

**Shipped.** Your corrections to the first reconciliation. An LP it showed as met had never met
anyone about the fund; the meetings on record were about other things. An LP it showed as opted
in rested on an email from 2021. Affinity's mail and calendar sync brings in everything the team
has ever exchanged with a person, and all of it was being counted for the raise.

| | |
|---|---|
| ![Only this raise](docs/changelog/shots/n59/01-only-this-raise.webp) | **An LP's page for a vehicle counts only what is about that raise.** Here, two of four touchpoints. The other two are still on record, and the page says so: "Also on record: 1 email and 1 meeting with them that aren't about this raise… They're counted on their own page, not here." |
| ![Contact history](docs/changelog/shots/n59/02-contact-history.webp) | **Contact history, on the LP's own page**: every email and meeting, about anything, by year; how much is about a raise; what each of their pipelines counts; who from our side. You wanted unrelated contact kept for intelligence, and this is where it lives. |

**Raise windows.** Each vehicle now has one, from the init file. Neurotech and Rails run from the
start of 2026 and are still open. The SPVs' windows are what you remembered, marked as guesses,
and the exact dates are a TODO. A new SPV that starts raising today is added, with no Affinity
list yet. A vehicle with no window counts only what names it.

**What a record is about** is read once, at translation, from what it says. That's an email's
subject and its sender and direct recipients, a meeting's title and who was invited, a note's
text. In order: an automatic reply is about nothing, and isn't a reply. A record naming a vehicle
is about that vehicle. A company's update to its investors is about something else. Fund or
investing talk, or the firm's name, is about any raise open on its date. So is a record from or
to the fundraising domain, but only as sender or direct recipient: the first pass counted an
email about something else because someone at the domain was copied. Each decision keeps its reason,
and a corrected rule re-reads every record on the next translation.

**Reconciliation, again.** It withdrew each of its own proposals whose records now read
differently, and proposed again where a climb still held. A reworded reason makes a new
proposal, so an approval is always of the words shown. The batch approval and the bulk status
move take a note, kept with every decision.

**On the real account**, the whole calendar since 2024 is read: 34,682 meetings in 347 requests,
under your go-ahead. Of 4,907 touchpoints, 983 read as about a raise, 670 of them this year; the
other 3,924 are contact history. The 278 proposals fell to 62, then 66 with the full calendar.
You asked me to take them rather than click through them, so I approved all 66. Each decision
says it was on your instruction and not reviewed one by one, and every rung carries its ticket
and the rule behind it: 66 LPs opted in, 57 of them with a meeting held. I also moved to
Discussing the 21 LPs who have met you about the raise this year but were still at Sourcing or
Selected, with the same note. 95 of 95 properties hold.

## N60 — The LP page leads with the status: seven of them, then the close track

**Shipped.** From your note on the page for an LP at Passed: "'Connector willing' — i think
these are not the states we discussed yesterday", and "maybe let's add 'connecting' (finding
connectors, reaching out) in between 'selected' and 'discussing'… once we reach committed, we
can start the closing sub-pipeline".

| | |
|---|---|
| ![Status with its evidence](docs/changelog/shots/n60/01-status-with-its-evidence.webp) | **The stepper is the status now**: New, Sourcing, Selected, Connecting, Discussing, Committed, then the close track (soft, signed, hard, closed, and wires as amounts). What you saw before was the consent ladder, the evidence view. Its rungs are now the evidence under the status they belong to. Confirmed ones are green with a check; ones on record but not yet confirmed are grey; nothing shows where nothing is known. No dashed lines. |
| ![Passed, and why](docs/changelog/shots/n60/02-passed-and-why.webp) | **Why it is what it is.** Every LP page says, in a line, why the status is what it is. Either a person set it here (who, when, what they said), or Affinity's status reads such-and-such and the mapping reads that as this status, with no record of who set it in Affinity or why. A passed LP ends the stepper in clay, with who ended it and why. |

**Connecting, on the real account.** Affinity's words for outreach under way now read as
Connecting, and 276 LPs moved there from Selected. The word for going quiet after outreach stays
at Selected: you said silence isn't a step forward (N53). The mapping's proposer does the same
for new words.

**Passed LPs are reconciled too.** An LP who passed still met us, so their evidence is proposed
like anyone's. "On file, not accepted, not proposed yet" was showing on those pages because
they'd been skipped. On your instruction, I approved the 10 new proposals the same way as the
last 66, with the same note. The pipeline's ladder column is now called Evidence. 95 of 95
properties hold.

## N61 — Updates on the LP page, and the timeline shows the state changing

**Shipped.** From your notes on two LP pages (issues 0004 and 0006): "add a row at start with a
text field to add an update… updates from here should get their own icon too", "events on the
timeline that change the status maybe should clearly indicate that the status changed", and
"ladder history should be in timeline".

| | |
|---|---|
| ![An update, read as you type](docs/changelog/shots/n61/01-an-update-read-as-you-type.webp) | **Every LP's timeline starts with an update box.** Write what happened. The words are read as you type and fill in the form: a status (forward only), the meeting, call or email they describe, with its date ("on Tuesday" becomes 22 Sep), their read after it, and a next step. Each suggestion shows the words it came from. Anything you change by hand stays as you set it, and "Saving will…" says in one line everything Save does. An amount is never recorded from an update; the form points you to the close track. |
| ![The state changing on the timeline](docs/changelog/shots/n61/02-the-state-changing-on-the-timeline.webp) | **The timeline shows the state changing.** An update gets its own icon, and what it changed shows inside it: *Status: Selected → Discussing*, the meeting it logged, the next step. Each rung on the ladder sits in the row that is its record, with who confirmed it and when. A record the ladder hasn't accepted says so and links to where you confirm it. A status change made without an update gets its own row. The Ladder history card is gone, and its misaligned references went with it. |

**Word rules for now; a model is your call.** You asked for an LLM to read the updates. The
Agent seam refuses until the agent runtime lands (L13: envelope checks, pinned run config, a set
of example cases), so for now word rules read them, and the form says so. Each update keeps
what the rules suggested, which version of the rules, and what you did with it. When a model
replaces the rules, those are real cases to test it on. Turning a model on would send update
text, which is real LP detail, to the model's provider. That's for you to decide, and it would
need its own key.

**An update never writes a rung.** A meeting it logs counts as a record, so reconciliation reads
that LP again straight away. If the ladder is behind, it proposes the climb for approval, the
same as after a translation. Save writes the update and whatever you ticked in one transaction,
once per form, with the update's id in each audit row. The related events you mentioned
(outreach through a connector, Linear tasks) are now issue 0023. 97 of 97 properties hold.

## N62 — The statuses everywhere: the vehicle overview, Today, and every LP's standing

**Shipped.** From your notes on the vehicle overview (issues 0007 and 0008): "Statuses in overview
should be the new statuses we aligned on. maybe look through whole system to make sure new
ladder is properly setup everywhere", and on "What happened": "some of these dont belong… i think
aggregate stats/metrics/dashboard things are good here, not a big list."

| | |
|---|---|
| ![Where the pursuits stand](docs/changelog/shots/n62/01-where-the-pursuits-stand.webp) | **The overview counts by status.** All seven statuses, each with its count, a bar for its share, and a link to that column of the pipeline. The three the ladder can back show how many it has confirmed: Connecting with a connector's yes or direct contact, Discussing with a meeting, Committed countersigned. The header says open and passed separately. It used to call every pursuit "open", passed ones included. |
| ![Lately](docs/changelog/shots/n62/02-lately.webp) | **"What happened" is now "Lately": figures, not a list.** Counted from this vehicle's pursuits only, and from touchpoints about its raise. For the last 30 days: meetings and calls held (and how many were a first), emails each way, LPs moved forward here, passed, updates written. Coming up: meetings in the next 30 days, next steps due this week and next steps overdue. Waiting: LPs we wrote to two weeks ago or more with nothing back, and LPs at Discussing with no touch in 90 days. Each figure with a view links to the pipeline filtered to it. |
| ![Waiting on a first reply](docs/changelog/shots/n62/03-waiting-on-a-first-reply.webp) | **Today: "Stuck at rung one" is now "Waiting on a first reply".** It lists LPs at Connecting with nothing from them yet, longest wait first, and says whether we wrote or a connector is asking. "What happened" reads as sentences: *Juan set the status to Connecting, from Selected — Anneliese Mork · PLC Crypto/Rails*, not `pursuit.status_set`. |

**The status first, everywhere else.** On an LP's own page, the group tables, All vehicles, the
decision room and the strategy page, the status comes first and "… on the ladder" sits under it.
The LP page's side panel now says "Needs evidence" when the status claims more than the ladder
has confirmed. The ladder still leads where a page is about evidence: meeting prep, content
attribution and the approvals. The visualizations still draw the ladder; they're next.

**The pipeline's filters are in the address.** A link like `/targets?status=connecting&touch=waiting`
opens that exact view, and so does sending it to someone. The rest of issue 0009, routes that
follow the sidebar, is its own version.

**On the real account**, PLC Neurotech I: 276 at Connecting, 6 of them with a connector's yes or
direct contact on the ladder; 79 at Discussing, 53 with a meeting on the ladder; 14 committed,
none countersigned yet. 210 LPs from Selected on are waiting two weeks or more on a reply. The
update reader now takes "emailed Anneliese" as outreach and "they emailed" as a reply. 98 of 98
properties hold.

## N63 — The annotation editor keeps the caret, the size and the colour you chose

**Shipped.** From your notes on the feedback box's screenshot editor (issue 0005): "while typing,
cursor sent to end… cant type well", "snaps back to a smaller size when typing again", "typing
past end should resize the box", "should be able to select actual font size by number", "a
color-picker for more colors… with a 'hue copy' selector", and "should be able to add a non-arrow
line".

| | |
|---|---|
| ![Type anywhere, any size, any colour](docs/changelog/shots/n63/01-type-anywhere-any-size-any-colour.webp) | **Typing stays where you put the caret.** The text field was being re-attached on every keystroke, which sent the caret to the end; "header" here was typed into the middle of the sentence. **The size is a number**: type it (37 here) or pick one from the list, in pixels of the saved image, from 8 to 400. A half-typed number isn't applied while you're typing it. **Any colour**: the five swatches stay, and beside them are the browser's colour picker and an eyedropper that copies a colour from the screenshot. |
| ![A plain line](docs/changelog/shots/n63/02-a-plain-line.webp) | **A line without a head**, next to the arrow, for underlining something or joining two things up. **A label keeps its size.** Until you drag its corner it widens as you type, out to the edge of the picture, then wraps and grows down. Once you've set its size, typing only makes it taller. |

**Found along the way.** Labels showed up to about 54 px higher on screen than where they were
saved, because they were placed against the picture plus the toolbar. They're placed against
the picture alone now, and the saved image wraps text the way the editor shows it, to within 1.4
image pixels. The app's textarea styles no longer leak into a label.

**Not checked:** the real eyedropper. Headless Chromium can't open it, so its button was tested
with a stand-in. Escape is ignored while it's open, and for 250 ms after, so closing the dropper
can't also close the editor. The 250 ms is a guess. Firefox and Safari don't have an eyedropper,
so there the button isn't shown. Undo still doesn't step back through a move or a resize, and
resizing is mouse-only; both predate this change.

A background agent built this in its own worktree, on demo data only. I checked the six fixes
again here: the two shots, a label growing to the edge (57 px wide to the picture's edge, then
two lines), and a resized label keeping 350 × 115 while I typed.

## N64 — Enrichment workflows: the LPs researched from public sources, mapped in with their sources

**Shipping in iterations, tonight.** You asked for workflows to seed the strategy: enrich the LPs from
public sources, find the connections, grade our own presence and materials, and turn it all into
strategies and actions. You wanted it read-only, stored before it's mapped, and run as a loop that
learns. This is the first installment. The research is still running as I write this.

| | |
|---|---|
| ![A suggested strategy](docs/changelog/shots/n64/01-a-suggested-strategy.webp) | **A suggested strategy on the LP's page.** Why they'd care, in their own record's terms. The next step, with who takes it, when, and what material goes with it. The best way in, with its tier; the ask; which list they belong on (this year's close or 2027). The four scores (capacity, affinity, propensity, time to decide), each with its basis, never collapsed into one number. It's ready for review until someone decides. Accepting makes it the LP's next step and moves nothing else; nothing is sent. |
| ![From public sources](docs/changelog/shots/n64/02-from-public-sources.webp) | **From public sources.** Whether the identity is confirmed, and on what. How they invest and what they care about, the capacity estimate, signals, cautions. Every fact links to its page, with how sure it is, and nobody on the team has verified any of it yet. The paths near us carry their tiers, and a C or D path says a person needs to check it. The footer says what was searched and what wasn't found: *not found* is not *not there*. |
| ![The research set and the import](docs/changelog/shots/n64/03-the-research-set-and-the-import.webp) | **Developer → Enrichment.** The research set: everyone at Selected, Connecting, Discussing or Committed. It's exported to files, and the research reads only the identity file, never where an LP stands with us. The import maps the findings in, and can run again as often as needed: a claim a person has verified is kept. All the suggestions sit together, this year's close first, with who each next step falls to. |

**The workflows** are in docs/19:

- **W0:** the research set.
- **W1:** profile an LP.
- **W2:** profile us: the team and Protocol Labs' documented backers.
- **W3:** find connections.
- **W4 and W5:** fit, angle, strategy and the next step.
- **W6 and W7:** our presence and our materials.
- **W8:** step back.

Each has an envelope: what it reads, what it may do, what it writes, and how it's judged. The W1
protocol is already at version 1.5. Each research batch reported what worked and what failed, and
that became the next amendment. Search summaries are leads, not facts. A tie to Protocol Labs is
read on its page and checked to be about the right firm. A firm's facts are marked as the firm's,
not the person's.

**On the real account so far:** 46 LPs researched, the first six by hand and forty by four agents
working in parallel. 44 identities resolved; the other two carry no facts. About 260 facts, each
with its page. Of the forty, 15 show a neuro or health signal, 14 a tie to Protocol Labs, and 26 a
crypto tie. W3 has found 187 connection candidates for 101 LPs. More research and the first strategy
batches are running now.

**Read only, and said so.** No sign-ins, no paid services, no contact-data brokers, and nothing
posted. A search carries a name, a firm, a title and topic words, never a status, an amount or a
note. The exception is written into CLAUDE.md in your words, and local sub-agents read batch files
without the prompt carrying real data. 99 of 99 properties hold.

## N65 — Routes that follow the sidebar; triage without the web; our materials graded

**Shipped.** Your issue 0009 ("the route should follow the hierarchy in the sidebar…
every action from the user that changes the viewable state of the page should properly
navigate the URL bar"), and the next round of the enrichment loop.

| | |
|---|---|
| ![Triage without the web](docs/changelog/shots/n65/01-triage-without-the-web.webp) | **W9, triage without the web.** The session's web-search budget (200 searches, shared with every sub-agent) ran out about fifty LPs in. From there, the LPs we've written to and not heard from are sorted from what we already hold, into four lanes. **Warm now:** a colleague at their firm has met us, they were inside the Protocol Labs network, the team marks them close, or they opened our deck. **Research first:** senior, at a firm that invests, nothing public read yet; this is where the budget should go next. **Long process:** a committee on a quarterly clock. **Cold:** find a connector first. Every lane shows its reasons. |
| ![The suggestions together](docs/changelog/shots/n65/02-the-suggestions-together.webp) | **The suggestions together (W8).** Every proposed strategy on one table: this year's close first, then by readiness and capacity, with the way in and who the next step falls to. The synthesis script writes the same portfolio view to a local file, with names. It covers firm clusters, connector leverage, what the LPs care about, and what only a person can check. |

**The address says where you are.** Every vehicle module lives under its vehicle:
`/neurotech/overview`, `/neurotech/pipeline/<LP>`, `/rails/pipeline`, and so on. Developer lives
under `/developer/…`. The old addresses redirect to their place, so every existing link still
works. A copied link opens the same view for whoever opens it, and switching vehicle in the rail
keeps you on the same module. A new proxy rewrites each address to the page that has always
served it, passing the vehicle in a header, so no page moved. The visualization's ten tabs and
the pipeline's columns now each get a history entry, so Back steps through them; a filter
replaces its entry instead of stacking them.

**Our materials, graded (W7).** Our public site, read as an LP would. The thesis and the team hold
up. How we won the portfolio doesn't show. The weakest point is that there's no way in for an LP:
nothing says the fund is raising (a 506(c) fund may say so), and every contact is for founders.
There are six suggestions, led by an LP page for the fund.

**What the strategy batches taught the export (W0).** The candidates now carry the close track:
its amount, and whether it's soft or signed. A source's "signed" is kept as a claim. Meetings on
dates that four or more LPs share are marked as likely events. W3 now links colleagues by work
domain as well as by firm name, which nearly doubled the same-firm paths. W5 rules added:

- One LP's decision is never disclosed to another.
- "Committed" with no evidence behind it means verifying first.
- A firm gets one owner and one ask.

100 of 100 properties hold.

## N66 — The research without search; what our records say before anyone writes; who could introduce whom

**Shipped.** The third round of the enrichment loop, and the two remainders of your issues 0008 and
0009.

| | |
|---|---|
| ![The connector plan](docs/changelog/shots/n66/01-the-connector-plan.webp) | **W11, the connector plan.** For everyone who could make an introduction — an LP who has committed, a warm LP who has met us — the prospects W3 found next to them, and the few to ask about this quarter: at most three per connector, the guard's number, still a guess. A prospect under a do-not-approach instruction is left out (rule 8). A C or D tie is a question for the connector before it's an introduction (rule 6). A plan names the prospect, never where they stand with us. And a connector whose own money is soft is asked after they sign. |
| ![The line, by status](docs/changelog/shots/n66/02-the-line-by-status.webp) | **The visualizations speak in statuses (0008).** The Line has seven columns, New to Passed, each saying how many need evidence. A ◇ on a block means its status claims more than the ladder shows. The ladder is in the tooltip, and a click opens both. The Grid, the Console and the List lead with the status and put the ladder under it. |
| ![The room, by status](docs/changelog/shots/n66/03-the-room-by-status.webp) | **The Room, by status.** Seven rows per vehicle. The part of a bar the ladder doesn't back is hatched and counted. "Needs evidence" is one rule now (`statusNeedsEvidence`), shared with the LP page and the overview, so they can't disagree. The Flow and the Plant count dated steps, so they stay on the ladder and say so. Passed LPs no longer count as load, stalled or in flight. |

**The research went on without search.** With the session's web-search budget spent, the research
agents read pages only: the firm's site from the work domain on file, then SEC EDGAR's full-text
search, Form D, proxy statements and 13D/13G signature blocks, the adviser database, ProPublica and
Wikipedia. It works better than the first try suggested. Across the first pages-only batches, the
work domain found the right bio for nine firm domains in ten. What it can't reach is staff at firms
whose sites list only their leaders. Each finding now says how it was made (`method: "pages"`), and a
pages-only "not found" means "not named in what could be read": that LP is still owed a pass with
search. The protocol went from amendment 1.6 to 1.10 in this round, one batch's learnings at a time.

**What our records say before anyone writes.** The strategy batches kept finding the same thing:
our records claim more than they show. So triage now gives a first step before any outreach, and
the LP's own page shows it, under **Before any outreach**:

- **Check sent mail.** A stage like "Contacted" or "Lost – No Response" with no touch on record.
- **Name an owner.** A way in exists and nobody on the team owns the pursuit.
- **A first personal note.** Our last word was a mailing, sent the same day to many others, so the
  next note is a first, not a follow-up.

**The close gap.** The synthesis now lists the committed LPs by what the close track shows, state by
state: soft and unsigned, signed per a source and unverified, countersigned, wired. It never adds the
states together (rule 1). In the real data, none of the committed LPs in the research set is past
soft yet. The quickest money toward the first close is signatures from people who have already
said yes.

**Connections from shared records (W3).** Two LPs in one company's record — both invested, both on
its board — are now a C tie, and two who only worked at the same company are D. Matching names in
sentences had invented ties: "Science" matched "computer science", and a sentence denying a Protocol
Labs tie was read as one. Now a one-word name counts only in a fact's structured part, and a denial
never counts. W1s, a pass with no web, fills in each fact's company from the fact's own words. A
firm's documented tie now also reaches colleagues at its domain whose own identity didn't resolve.

**The Protocol Labs network (W2n).** PL's own directory has a public API: 1,733 teams, 667 of them
funds, 36 in neurotech. One lookup per LP, carrying the name and nothing else, finds who is in it.
An entry that matches our record of them — their firm, their work domain — is PL's own record that
they're in the network: tier B. An entry under the name alone is C until a person confirms it. A
firm listed as a network team is the firm's tie, C. Speaking at a PL event is C and attending one is
D. Nothing for contacting anyone is kept: no email, handle or phone number. In the real data, 18
LPs have an entry under their own name, 15 of which match our record of them, and 57 work at a firm
that is a network team. This is the "near us" check the pages-only research couldn't run.

**Fixed along the way.** Every "Open the target" link on the floor went to a page that doesn't
exist; they now open the LP page. An exposure could lower a rung the ladder had already confirmed.

**For you to decide.** Committed rests on a countersignature (N62's rule), so every soft commitment
reads "Needs evidence", on the demo and on the real account alike. If Committed should mean "a yes
with an amount", Indication given would back it instead. That's one line in `STATUS_BACKED_BY`, and
it moves the LP page and the overview with it.

**Every sort and filter in the address (0009).** The enrichment catalogue's filters and sort order,
the pipeline's sort, the route picker's order and the fit view's order all live in the URL now.
Back steps through them, and a copied link opens the same view.

**The strategies pin what they read.** Each strategy records the finding it was written from. The
checker counts the strategies whose LP has a newer finding, and the batcher puts those back in the
queue. The batcher also keeps a firm's people in one batch, joined by work domain or organization,
so colleagues get one owner and one ask. The checker also counts firms whose money is asked for
twice. The export now says how the last touch happened, because a meeting counts as "from them" and
had been read as a reply. And the connector plan no longer proposes introducing someone who has
already met us.

101 of 101 properties hold.

## N67 — A critic for the strategies; the look-alike trap; across vehicles

**Shipped.** The fourth round of the enrichment loop: the strategies graded by a critic, the
research taught to avoid look-alike names, and a synthesis that reads across vehicles.

| | |
|---|---|
| ![A shared record](docs/changelog/shots/n67/01-a-shared-record.webp) | **A shared record, on the LP's page.** Two LPs who invested in the same company are a C tie, named with the company and marked "needs a person to check" (rule 6). W3 used to find these only by matching a name in a sentence, which invented ties out of words like "Science". Now the company comes from the fact's structured part, which W1s fills from the fact's own words. |

**A critic (W5c).** A pass with no web graded 25 strategies against the litmus test and the rules:
10 A, 12 B, 3 C. The grades rose with each version of the protocol. The recurring faults were
reading our records for more than they say, stale inputs, firms not coordinated, next steps too long
to survive the import, and estimates ahead of the evidence. The three Cs were rule slips: one LP's
amount in a note to a colleague, a soft commit nobody gave, and a D tie treated as C. They became
W5 1.5:

- Owning a pursuit is not having been in the meeting.
- A capacity band needs assets, a check on record or a filing.
- "This year" needs a word from them in the last 90 days, money on the close track, or a meeting
  that wasn't a group date.
- The lead strategy carries its firm: one owner, one money ask.
- The next step fits in 300 characters with who and when.
- A note to several people never carries one person's amount.
- A path keeps the tier the connection file gives it.

The checker now counts what a strategy claims beyond the files. The batcher's revise mode rewrites
every strategy written before 1.3, or flagged, a whole firm at a time, starting with the committed
LPs.

**The look-alike trap (amendments 1.12–1.15).** Without search, the research's main risk is a
look-alike name: an acronym whose filings are another company's, a "Ventures 23, LLC" that is a
real-estate issuer, a relative with the same first name. So a general partner's exact legal name is
searched in quotes. A filing joins an LP only through a named officer, and the SEC filer number
separates relatives. The company comes from the opened filing, never the reader's list summary,
and an amount comes from the raw field — the reader once read whole dollars as thousands.

**Nothing in a special category (1.16).** Health was already off limits. A bio that lists a religious
community's committee showed the rule had to be wider: no religious, political, ethnic or union
affiliation and no sexual orientation, ever. The checker now looks for an email address or a phone
number in every text a finding carries, not only its facts; the real findings have none.

**W3.** A denial after the name ("Protocol Labs and Filecoin are not among them") no longer counts
as a tie. A path's basis is cut at a sentence end, not in the middle of one. A three-letter firm
name counts when a record writes it in capitals.

**Triage reads our notes** for an invitation promised or a referral made, a warm signal only our
notes hold. The first step is to check it was followed through.

**The synthesis** gains:

- **Founders as references:** LPs who backed our portfolio companies.
- **Timing:** dated signals from the last twelve months.
- **Across vehicles:** Rails- and SPV-shaped LPs on the Neurotech list, to coordinate, not compete.
- **Our own network:** PL's directory.
- **An owner rule:** built from what the strategies proposed, for the team to decide.

The export now says how the last touch happened, since a meeting counts as "from them". docs/19
says how to run the search pass, one command, once the budget allows.

102 of 102 properties hold, including a new one for the connector plan: restricted prospects and
ones who have met us are left out, a soft connector is asked after signing, and asks stop at the
guard's limit.

## N68 — Every LP read; the strategies rewritten to the critic's rules; what the ties really rest on

**Shipped.** The research set is read in full, the earlier strategies are rewritten at W5 1.5, and a
round of fixes to what the connections rest on, each found by an agent reading its own inputs.

| | |
|---|---|
| ![Page reads only](docs/changelog/shots/n68/01-page-reads-only.webp) | **A finding made without search, said so on the LP's page.** "From page reads only, with no web search: a search pass is still owed, and 'not found' here means not named in the pages read" — rule 7's coverage disclosure, for the 328 LPs read after the session's search budget ran out. What the search pass should look for is listed under "not found". |

**Every LP in the research set is read** — 388 of 388, with no checker problems: 278 confirmed, 26
probable, 78 not found (staff at firms whose sites name only their leaders, most of them) and 6
ambiguous. Amendments 1.17–1.25 came from those batches. A firm's own words about what it excludes
are a gate. EDGAR hits are checked for look-alike names. A site's own sitemap and content API reach
what the page reader can't. And the checker now refuses a street address anywhere in a finding, and
lists religious or political terms for review under 1.16 — one finding was edited on that review;
the others were a person's name or an institution's own identity.

**The strategies, rewritten at W5 1.5.** Every strategy written before version 1.3, or that the
critic's gates flagged, was rewritten, a whole firm at a time and the committed LPs first. Most
committed LPs' first step is now an internal check: who took the soft commit, and where the signed
documents are. No firm is asked for money twice. A capacity band rests only on evidence of the LP's
own money (`hasCapacityEvidence`: not a denial, not a company's valuation or sale price, not a fund's
size or a manager's assets). "This year" needs a word from them in the last 90 days, money on the
close track, or a meeting that wasn't a group date, and the synthesis now lists what lapses in the
next three weeks. An LP outside the US needs counsel before any fund material.

**What the ties rest on (W3).** Each fix came from a strategy agent finding a route its own inputs
didn't support:

- An old address at our own domain joins nobody.
- A company that bought an LP's company isn't a co-investment.
- Someone who has moved on is grouped with their new firm.
- A fund of funds sits next to the GP of a fund it backs.
- A founder of one of our portfolio companies is B — we are their investors.
- Going through an accelerator is D, not having worked there.
- The team's "close contact" mark is a C path of its own.
- A word from them, with no meeting on record, is a B path, like a meeting.
- A join rests on a fact's structured company only, never a name found in a sentence.

The Protocol Labs directory is matched again using what the research found (each finding's own
organization and website): 60 LPs work at a network team.

**Triage and the export.** Triage reads a firm's stated exclusion, an invitation or a referral in our
notes, and treats an angel as a principal. The export now carries the dates of each LP's meetings,
each marked when four or more LPs share it.

**The real server** hit the open-file limit as the enrichment files grew, then served nothing. It now
starts with a higher limit and polls for changes.

104 of 104 properties hold.

## N69 — 330 strategies; the replies we owe; the critic's second round

**Shipped.** The round of the enrichment loop that finishes the strategies. Every LP in the
research set that the research resolved, or that is Discussing or Committed, now has a strategy,
and the replies we owe are on each LP's own page.

| | |
|---|---|
| ![A reply we owe](docs/changelog/shots/n69/01-a-reply-we-owe.webp) | **A reply we owe.** When an LP wrote last — a message, not a meeting — and nothing from us is on record since, the LP's page says so under "Before any outreach": check sent mail (a reply may have gone from an inbox Affinity doesn't see), then answer. It covers every status in the set, from Selected to Committed. The path the message opens shows under "Near us" as B: our own record of an interaction, though who received it isn't recorded. |

**330 strategies.** One for every LP the research identified (304), for every Discussing or
Committed LP it couldn't (written from our records alone, at low confidence), and for four
Connecting LPs it couldn't: three through their firm's strategy, one because a way in is open now.
The 58 without one are Connecting or Selected LPs the research couldn't identify.

The checker reports no problems, no strategy older than what it read, no next step the import would
cut, and no firm asked for money twice. Most are internal checks with a note behind them, and most
Connecting LPs go on the 2027 list: nothing on record from them in 90 days, no money, no
one-to-one meeting. That is the evidence gate, working as intended.

**The critic's second round.** The same six criteria as the first round, on 25 strategies written at
W5 1.5: 22 A and 3 B, against round one's 10 A, 12 B and 3 C. Every strategy in both samples held or
rose. What it still found became gates: an ask carrying a range while capacity is unknown, and the
capacity check itself, now tighter. It no longer accepts a denial, a hypothetical, a company's
valuation or sale price, a fund's size, a manager's client assets, or a figure more than six years
old. Our own notes count as evidence.

**Triage reads more before it proposes a note.**

- A reply we owe, at any status.
- A work domain on our record that no longer works: check whether our mailings bounced first.
- A later note after a mailing: read that one first.
- A firm whose own words rule out our field.
- A look-alike warning from the research.
- The organization the research found, over ours.

**W3 and the Protocol Labs directory.** One-word names join only like with like: two investments in
a company, never a former employer and a fund that share a word. Code hosts and other shared sites
never join an LP to a network team. A firm-level strategy pins its lead, and the checker counts a
lead that is older than a colleague's finding.

**The synthesis** opens with the replies we owe, one question for counsel that covers every LP placed
outside the US, and conflicts: a competing position in our own field, listed apart from affinity.

**Both dev servers poll for file changes.** The enrichment files grew past what file watching could
hold, and each server in turn stopped serving pages.

104 of 104 properties hold.

## N70 — The list we act on first, graded; the facts checked at their sources; coverage that says what ran

**Shipped.** A fourth round of the enrichment loop, aimed at what a person acts on first: every
strategy on the "this year" list and every one for an LP who wrote to us last, graded by the critic
and revised; a first check of the research itself, fact by fact, against the pages it cites; and
the LP page's coverage line made exact.

| | |
|---|---|
| ![A few searches](docs/changelog/shots/n70/01-a-few-searches.webp) | **Coverage that says what ran.** Fifteen findings ran one to five web searches before the session's search budget ran out: too few to follow the protocol, so they are owed the search pass like the page reads, but their LP pages said "with no web search", which was false (rule 7). They now say "from page reads and a few web searches, too few to follow the protocol", and the line lists what was searched plainly. N68 counted 328 findings read without search; the count is 334 owed the pass — 319 with no web search, 15 with a few — and 54 with search as the protocol asks. |
| ![A fact check](docs/changelog/shots/n70/02-a-fact-check.webp) | **A finding corrected after a fact check, and saying so.** When the fact check (W1c, below) cuts a fact down to what its page says, the finding keeps the date it was read and lists the correction; the LP page says when, what changed, and that an agent re-read the pages — a fact check, not the team's verification, which is still "nobody on the team has verified it yet". |
| ![The loop's measurements](docs/changelog/shots/n70/03-the-loops-measurements.webp) | **The loop's own measurements, in the app.** The critic's rounds and the fact check were files only. The enrichment page now reads them: each round's grades and its issues by criterion, and the fact check's counts, with the share of facts read that their pages support as written. A round graded in two halves counts as one. It says what it is — an agent grading against the written protocol, a measure of the loop, never the team's verification or a verdict on an LP. The demo's rounds are fictional. |

**The critic's third round.** It graded the 47 strategies a person acts on first — all 33 on the "this
year" list and 14 more for LPs who wrote to us last — by the same six criteria as rounds one and two,
and a seventh: when the last word is theirs, does the next step answer it? 27 A, 16 B, 4 C. The
"this year" list held (21 A, 11 B, 1 C); the seventh criterion found the gap: 15 of the 25 LPs who
wrote last had a strategy that didn't answer what they wrote, or answered it with a question of our
own. Of the 17 strategies graded in an earlier round, 13 held their grade, 2 rose and 2 fell, both on
the new checks.

Two rule slips became gates, because the checker could see them: an LP our records place outside the
US whose strategy never names counsel (amendment 1.5 writes the gate into the strategy before any
fund material or signature — the one C on the "this year" list proposed countersigning a non-US LP's
documents without it; 18 strategies across the set tripped the new gate), and a capacity check that read
"commits to venture funds" as money and assets under advice as the LP's own. What the checker can't
see became W5 amendment 1.6: when the last word is theirs, the next step answers it; one meeting,
one date (two partners at one firm on the same day were one meeting, not two one-to-ones); owning a
pursuit is not a channel to the LP; W3 is cited as it stands; a firm's lead re-reads its colleagues.

Then the revisions, by rule and recorded on each strategy. Four batches rewrote 52 strategies at
W5 1.6 — the critic's fixes, the stale ties and the new gates; no list changed. Every reply we owe
now starts by finding the LP's message and checking sent mail, then answers it, owning the delay,
before any question of ours. Where two colleagues share a meeting date, it is one reply to both, and
neither one's words go to the other. A final pass pinned every firm-level ask to its lead (22 pins,
14 texts brought into line with their lead) and restored one capacity band the gate had hidden.
Then every firm's lead was brought to 1.6 (15 leads, 9 revised), and its colleagues re-pinned after
it (22), the lead first; three leads had fallen behind colleagues revised earlier in the night.

**The critic's fourth round, on the bulk.** A fresh random sample no round had graded: 20 strategies
on the 2027 list and 5 marked "not now". All 25 A — an easy sample, the critic said (none owes a reply,
has money on the close track, or a meeting on file). One thing recurred: 12 of the 25 parked an LP
"until the search pass", with no date to look again — a park for good if the pass never runs. Across
the set, 54 of the 57 strategies that park had none. A park now carries `next.lookAgain`, shown on the
LP page; a gate counts any without one; and a rule set it for those 54 — the 2027 list on 4 Jan 2027,
"not now" on 5 Apr 2027, or the search pass if that comes first. The dates are guesses, for a person
to change, and each is recorded on its strategy.

The checker ends the night at 388 findings and 330 strategies with no problems: none stale, no gate,
no firm asked twice, no lead moved or unpinned, no W3 tie cited that the files don't carry.

**The fact check (W1c), new.** Two agents re-read 171 facts in 20 findings, half of them behind a
"this year" strategy, at the pages the facts cite and nothing else: no search, no other pages, no
sign-ins. Of the 153 whose page loaded, 133 are supported as written, 19 partly and 1 not; none is
about someone else. Of the 20 identities, 18 hold and 2 are in doubt; none is wrong. Every partial
had one of three causes: a detail brought in from a second page, a description the page doesn't
give, or a stronger word than the page's ("joined" for "offered", "acquired" for "joined forces").
One fund name in a `detail` field had been made up by analogy with a sister fund's filing, and W3
joins LPs on those names. They became W1 amendment 1.26, and the 20 findings were corrected to their
pages: 16 changed and 4 untouched — 19 facts cut to their pages' words, 2 split, 1 removed, 13 moved
to the cautions as unconfirmed (they rested on a search summary, or on a page that was never read),
and 8 `detail` fields removed; no identity changed. A fact from an LP-contact database was removed,
and the checker's broker list gained the site.

**The checker names what it means.** "A strategy naming an LP outside its paths" counted 34, mostly
colleagues at one firm, paths recorded in the other direction, and lines that guard one LP's
privacy from another. It now leaves those out: 22 name an LP the files don't join to them, and 11
of those cite a W3 row or a connector-plan pairing that W3's later fixes removed (a shared employer,
an acquirer, a one-word name). All were revised, and the check now reads the route's reason too.

**The revisers found the checker's blind spots.** Each reviser reports what it learned, and each
report became a fix tonight:

- The US test read Puerto Rico, Guam and "U.S." followed by a space as abroad, and a finding's short
  "Palo Alto" as abroad next to our record's "Palo Alto, California, United States". Now an LP is
  outside the US only when some source places them there and none places them in it. The count
  that one question to counsel covers is 40 LPs, not 46.
- The capacity gate read only the profile's summary, so a net worth recorded as a fact was invisible
  and a reviser set a supported band to unknown. The gate now reads the finding's capacity and
  check-size facts, and the band is restored.
- Three of four stale citations sat in the route's reason, which the check didn't read, and a W3 row
  filed under "X (adviser to Y)" looked stale when it wasn't. Both are fixed.
- 18 of 37 firm-level asks pinned no lead, so a lead's rewrite couldn't mark them stale. The checker
  counts them now, and each is pinned.
- Parallel batches unpin each other's firms. Batches are now cut by firm, a lead is written before
  its colleagues, and one re-pin step runs after they all finish (docs/19).

**Two first steps, measured.** Each LP page shows triage's check ("Before any outreach") and the
strategy's next step. They agree on 174 of the 224 LPs that have both. Of the 50 that differ, most
are the strategy being more specific, or departing on purpose with its reason given, such as
correcting the contact first, or waiting on counsel. That is left as it is, not made a gate.

**The synthesis counts people.** "Who the next steps fall to" read the first word of each owner
line, so a firm's name counted as a person. It now counts the first member of the team named. One
person holds 190 of the 330 next steps, which is the owner rule's question for the team.

107 of 107 properties hold.

## N71 — The facts behind the whole "this year" list, checked at their sources

**Shipped.** The fact check's second round, on every finding behind a "this year" strategy that the
first round didn't read; the findings corrected to their pages; and the checker comparing a tier a
strategy cites with the tier W3's file gives.

| | |
|---|---|
| ![Fact-check rounds](docs/changelog/shots/n71/01-fact-check-rounds.webp) | **The fact check, by round.** The measurements card now shows each round of the fact check on its own line, with its identities, as it does the critic's rounds — so a second round reads as a second measurement, not as more of the first. A round's halves count as one. The demo's rounds are fictional. |

**The fact check, round two (W1c).** Three agents re-read 128 facts in 19 findings — every finding behind a
"this year" strategy that round one hadn't read — at their cited pages and nothing else. Of the 116
whose page loaded, 90 are supported as written (78%, against round one's 87%), 24 partly and 2 not;
none is about someone else. Of the 19 identities, 15 hold and 4 are in doubt; none is wrong. The
lower rate has a plain cause: most of these findings were written at version 1, before any
amendment, and each checker found that 1.26 as written would have prevented nearly every error. Two
new kinds became rules in 1.26: a quote taken from a colleague's section of a page about several
people, and words that are on the page but said there of something else ("early-stage fintech"
written of a person's fund, recorded as their angel deals' focus). Across both rounds: 299 facts in
39 findings; of the 269 read, 223 supported (83%), 43 partly, 3 not; no identity wrong.

**The findings, corrected to their pages.** 17 of the 19 changed: 24 facts cut to their pages' words, 2 rewritten to what
the page says, 5 split into facts of their own on pages the finding already cites, 9 moved to the
cautions as unconfirmed, and 3 `detail` fields removed; no identity changed, and the 4 in doubt say
why in their cautions. The corrections had touched only the facts, so some findings still repeated
a cut claim in a summary, an interest or a connection's basis — which the LP page shows — and a last
pass aligned every corrected finding to its facts: 30 of the 33 findings the two rounds corrected, with 99 claims removed or
cut down — 38 in summaries, 19 in identities' bases, 14 in interests, 12 in how they invest, 8 in
signals, 7 in capacity's basis and 1 in a connection's basis. It left for a person 18 identity
fields that still rest on a page that wasn't read (12 places, 4 roles, 2 organizations: W3 and the
counsel gate read them, so they wait for a decision), and 3 capacity bands whose basis lost its only
figure. The checker still ends at no problems, none stale, no gate. Each correction is listed on the finding without
moving the date it was read, and the LP page says an agent re-read the pages — a fact check, not the
team's verification.

**Tiers cited as W3 gives them.** A reviser found that a stale citation inside a firm passed the
checker: "(C, both invested …)" beside a colleague the files do join, when W3's file had since
given the pair D. The checker now compares every tier cited beside a joined name with the tiers W3's
file gives that pair. It finds 22 such citations, all agreeing after the night's revisions; it
guards the next revision, not this one.

107 of 107 properties hold.

## N72 — Green by default; the rail agrees with itself; the real server on the local network

**Shipped.** Two items from the feedback box, and one request.

| | |
|---|---|
| ![Green by default](docs/changelog/shots/n72/01-green-by-default.webp) | **Green is the default theme** (issue 0010). The page is served in it, a fresh browser sees it, and the build log's own page wears it too, so screenshots from here on are green. The earlier ones stay as they were taken. The meaning colours don't move: clay still means refused, green still means passed. |
| ![The page you are on](docs/changelog/shots/n72/02-the-page-you-are-on.webp) | **The rail marks the page you're on, on both sides** (issue 0011). On `/neurotech/pipeline?status=discussing` the browser showed a console error: the server had marked the rail from the path the proxy rewrote to (`/targets`), the browser from the address asked for (`/neurotech/pipeline`), so "Pipeline" was highlighted on one side only and React refused to hydrate. The proxy now passes the asked-for address along, and the server marks the rail from it. |
| ![The theme picker](docs/changelog/shots/n72/03-the-theme-picker.webp) | **Clay stays one click away.** A choice of clay is kept per browser and applied before the first paint, as before; the picker, the boot script and "Reset all three to defaults" all read green as the default now. |

**The real server listens on the local network.** Juan, 24 Sep: "I'm in a small private network
so no problem w/ exposing the port." `npm run dev:real` binds all interfaces on port 3100, and
the dev server accepts the private address ranges, as the demo's always has. There is no sign-in,
so anyone on that network can read and change the real data; CLAUDE.md, docs/15 and the data page
say so.

108 of 108 properties hold.

## N73 — The pipeline table stays inside its card

**Shipped.** One item from the feedback box (issue 0012).

| | |
|---|---|
| ![The table in its card](docs/changelog/shots/n73/01-the-table-in-its-card.webp) | **The evidence column stays in view.** The pipeline table's seven columns needed more room than its card had at a laptop's width, so the ladder spilled past the card's edge. The LP and "Where" columns now give way first and the cells are a little tighter, so the whole table fits a 1280-wide window, the evidence column included: it is the column that shows the gap between claimed and evidenced, so it is never the one pushed out of view. Narrower than that, the table scrolls sideways inside its card instead of painting outside it. Measured on the demo and on the real data: whole at 1280, 1440 and 1920 wide, scrolling within the card at 1180. |

108 of 108 properties hold.

## N74 — The organisation leads when it is the LP; the slash reaches the feedback box

**Shipped.** Two items from the feedback box (issues 0013 and 0014).

| | |
|---|---|
| ![The org leads](docs/changelog/shots/n74/01-the-org-leads.webp) | **The organisation's name leads when it is the LP we're targeting** (issue 0013), with the person beneath in grey; otherwise the person leads, with their organisation beneath, so it is always in view. Search matches both names, and sorting by LP sorts by the one that leads. What decides it is on file: the strategy's named unit first — who would commit, a unit at the firm or "personal" — else the investor type the research found (a fund-of-funds programme, family-office staff, an institution, a corporate or a foundation makes the organisation the LP). With neither, the person leads. On the real set, 93 LPs lead with their organisation and 272 with the person; 23 have no organisation on record. |
| ![The org on its page](docs/changelog/shots/n74/02-the-org-on-its-page.webp) | **The organisation's page, and its timeline.** The LP page's title and breadcrumb lead with the organisation too. Its log now includes meetings with the organisation's other people — the colleagues who act for it — each marked "with ‹name›, ‹organisation›", and summed apart from the person's own record, which is what the ladder reads (on one real LP's page, 8 such rows; the demo's colleague has none inside this raise's window). Whether a colleague's meeting should count toward the organisation's rung is Juan's to decide; it doesn't yet. |

**The slash reaches the feedback box** (issue 0014). The pipeline's "/" shortcut took the slash
from any field that wasn't an input — the feedback box's text is an editable box — and moved focus
to the search behind it, so the words after the slash went there too. It now leaves a key alone
when it is typed into any field or inside an open dialog, and ignores it with a modifier key.
Checked in a browser: "a/b te" typed into the feedback box stays there; "/" on the page still
searches.

109 of 109 properties hold.

## N75 — An update or a touchpoint from one place; context from the team; the calendar's meetings

**Shipped.** Three items from the feedback box (issues 0015, 0016 and 0017).

| | |
|---|---|
| ![Update or touchpoint](docs/changelog/shots/n75/01-update-or-touchpoint.webp) | **An update or a touchpoint, from the same place** (issue 0015). The timeline's first row has two icons, and the chosen one is darker: the pencil writes an update, as before; the calendar logs a touchpoint. Choosing the touchpoint turns the row into a larger box for what happened, with the structure below — meeting, call, email and the rest, when, who reached out, which vehicle, their read. The drawer at the bottom of the timeline is gone. |
| ![Add context](docs/changelog/shots/n75/02-add-context.webp) | **Add context** (issue 0016): more information about an LP, or a correction, from the top of its page's right column. It is kept as research on the LP with the writer's name and the date, and moves no status, no rung and no money. The suggested strategy then says it was written before the newest context, quoting it, and that it is due a re-think. The strategy workflow's export carries the context, its protocol reads it above the research and the notes' readings, and a strategy written before it counts as stale, so the next revision batch re-thinks it. |
| ![The calendar](docs/changelog/shots/n75/03-the-calendar.webp) | **The vehicle's calendar shows its meetings** (issue 0017). It kept only meetings tied to the vehicle, and Affinity records most meetings with none, so the Neurotech calendar was empty. It now places each LP's meetings and calls by the rule the pipeline and every LP page use (N59: inside the raise's window, and read as about it), counting a meeting shared by colleagues once. On the real data: from 0 dated things to 164. The demo's meetings were always tied to their vehicles, so its calendar looks as it did. |

110 of 110 properties hold.
