# Confidence from evidence — claims, identity, capacity and feedback

Issue 0042, phase 1 · 26 Sep 2026 · **Design for Claude's review and Juan's approval.**
No product change or workflow authorization is made by this document. Phase 2 is separately
reviewed. All examples below are invented; private issue records remain in place.

## 1. Decision and current constraints

Keep a claim and the evidence for and against it, even when its identity match is doubtful.
Compute a reproducible support score, expose the reasons, and distinguish permission to use
the claim from confidence in it. Capacity always supplies a numerical best estimate, including
an explicit prior when evidence is absent. Feedback changes evidence first; a general rule
change and a larger correction pass are separate proposals.

This follows [the current plan](13-synthesis-r3.md), the identity and data-plane design in
[the architecture](09-system-architecture.md), [COLLAB](COLLAB.md) and [the run ledger](20-workflows.md).
Keep the modular monolith, PGlite/Postgres and files-first workflows. No new service, graph
database, vector store, model training, orchestration engine or connector is needed.

The implementation inspected at base `8d009ce` has these relevant limits:

| Existing code | Consequence for this design |
|---|---|
| `lib/enrich/schema.ts` has high/medium/low fact confidence, four identity labels and capacity bands including unknown | These remain legacy input labels, not evidence-derived scores. Add a versioned adapter; never fabricate a numeric score from a label. |
| `lib/enrich/import.ts` counts unresolved identity but still maps its facts to `research.claim` under the LP; it deletes and recreates unverified public claims | Merely lowering confidence is insufficient. Candidate-profile facts need a separate projection and stable IDs; imports must preserve supersession and review history. |
| `lib/enrich/connect.ts` excludes much doubtful/low-confidence public material; it also makes some organizational links without a named person | Retain discovery candidates, but require resolved endpoints and evidence for every personal hop before routing. |
| `modules/network/build.ts` rebuilds generated edges; `service.ts` applies gates before influence | Preserve review decisions across stable logical edges, invalidate them when the reviewed proposition changes, and keep gates ahead of ranking. |
| `lib/enrich/capacity.ts` and `config/deployment.ts` provide size bands and an angel floor, explicitly guesses | Reuse these assumptions visibly; add numerical representatives and fallbacks rather than relabel guesses as measured checks. |
| `lib/enrich/strategy.ts` rejects some unevidenced bands; W1c's correction rules defer a capacity band whose sole basis fails | The always-valued contract needs coordinated schema, validator and workflow amendments. Until then incompatible estimates stay in separate drafts. |
| `research.note.data` is JSONB; claims already have provenance and supersession; identity has `match_assertion` | Use existing storage first. A score never merges canonical entities or reverses a human identity assertion. |

## 2. What confidence means and how it changes

### Separate the questions

Each claim has an atomic proposition, subject (candidate profile, person or organization),
scope, applicable dates and evidence references. Split “is a partner and invests personally”
into two claims. A firm's investment is not its employee's investment.

Keep these independent values:

- **Claim support:** how well the inspected evidence supports this exact proposition.
- **Identity match:** how well a particular public profile matches a particular LP.
- **Freshness:** whether the proposition is still supported for the requested date.
- **Use status:** usable, labelled discovery only, set aside, contradicted or superseded.
- **Relationship tier, human review, warmth and willingness:** different attributes of an edge.

A numerical support score is a rule index from 0 to 100, **not a calibrated probability**.
Do not display it as “82% true,” multiply it into capital, or call it P(commit). The inspector
can show points and arithmetic; ordinary pages use “Supported”, “Tentative”, “Needs evidence”,
“Identity uncertain”, “Conflicting evidence” and “Estimate — guess”. Human verification is a
separate named, dated action, never the result of crossing a score threshold.

Every external claim retains `source, as_of, confidence, last_verified_by`. The verifier is
null until a human verifies; researcher/checker identity lives in separate fields. Preserve
publication/event date, observation date, retrieval date and date precision separately.
Reopening a page does not refresh its underlying event. Missing provenance permits storage
as an unsubstantiated candidate, but a brief must refuse to state it as an established fact.

### Deterministic claim rule, proposed v1

All point values, time windows, caps and thresholds in this document are **GUESS defaults**,
to live together under versioned confidence/capacity settings in `config/deployment.ts` if
approved. Pin resolved settings, evaluator version, evaluation date and input hashes in each
assessment. A repeated assessment with those same inputs produces the same result.

An observation records its source, original-source group, exact claim revision, stance,
extraction/check outcome, dates and reviewer. Multiple pages copying one release are one
group; repeated agent readings of a page are checks on that observation, not independent
votes. CRM data copied from that page belongs to the same group. When independence is
unknown, group conservatively and explain it.

| Supporting observation | Base points, when it supports the exact claim |
|---|---:|
| Direct dated record of the event, or specific first-person human attestation | 70 |
| Primary publication or filing by an accountable party | 60 |
| Independent reporting with explicit attribution | 45 |
| CRM field, self-description or affiliation clue without the underlying record | 25 |
| Unread page, search snippet, uncited assertion or prior assumption | 0 |

Source class is relative to the claim. A meeting invitation supports “invited”, not “attended”;
a CRM stage supports “recorded as stage X”, not a consent rung. A filing about a firm does not
establish a person's wealth. A remark “looks wrong” opens a dispute; it is not direct evidence
of a replacement fact. Record any agent-assigned source class and allow review of it.

For each source group take its strongest eligible supporting observation, after freshness
adjustment. Sort by adjusted points, then stable observation ID. Let `b` be the strongest,
or zero. Each of the next two independent groups worth at least 25 adds 10. Thus:

```text
support = min(90, b + 10 × min(2, eligible additional independent groups))
opposition = strongest applicable opposing group (same point table), or 0
score = max(0, support - opposition)
```

Do not sum repeated contradictions. Show both support and opposition and their references.
Any unresolved direct contradiction sets “Conflicting evidence”, even if the score is high.
If there is no actual supporting observation, the state is “Needs evidence”; a model's prior
cannot become support for an external fact.

Check outcomes apply to the referenced observation, not every fact in the profile:

- **Supported:** retain its eligible points; no bonus just for passing another check.
- **Partly:** halve its points (round down) for the old wording and cap that revision at 49;
  propose a narrower claim with its own ID/revision and evidence. It can then score normally.
- **Not supported:** that source contributes zero. Absence of the words is not proof of the
  opposite. Other independent sources can still support the proposition.
- **Someone else:** remove support for the LP association and assess the identity mismatch;
  retain the observation and claim under the candidate it actually describes.
- **Unavailable:** mark availability separately. Prior permitted evidence and its old date
  remain; no negative truth evidence is invented. With no previous readable support, zero.

Only an explicit refutation creates an opposing observation. Conflicting checks of the same
revision remain visible and disputed until reconciled; “latest agent wins” is not the rule.
An accepted superseding correction removes the old assertion from active use but keeps it
inspectable. A human's verification does not immunize a claim against later contradictory
evidence: show the conflict and request review without silently rewriting their decision.

### Age and display rules

Historical propositions (“held role R during year Y”, “made investment Z”) do not decay merely
because time passes. Current roles, current allocation policies and current relationship
availability do. For these, use the last date the evidence actually establishes the current
condition: through 12 months, subtract 0; over 12 through 36, subtract 10; over 36, subtract
25; unknown effective date, subtract 15 and label date unknown. Clamp observation points at
zero. An expired stated validity period stops supporting the *current* proposition; preserve
the historical one. Human identity assertions persist until a human revises them; role
evidence used to infer identity can age. A past meeting remains a past meeting, while its
value as evidence of current warmth ages separately.

Claim score >=70 maps to supported/high, 40–69 to tentative/medium, below 40 to needs
evidence/low. Dispute, partial wording, unavailable source and identity labels remain visible
regardless of band. A newly fetched source cannot erase those qualifications. An unreadable
sole source with no adequate retained extract is unusable for a new factual brief.

Invented calculation: a current official biography gives 60 and independent reporting gives
10 additional points: 70, supported. A syndicated copy adds nothing. If that biography no
longer supports the wording, the independent report alone gives 45, tentative. A first-person
refutation worth 70 sets the score to zero and the state to conflicting evidence; it does not
erase the original sources.

## 3. Identity: retain each pairing and its facts

An identity assessment belongs to `(LP entity ID, candidate profile ID)`, not a name string.
Multiple candidates can coexist. Profile IDs remain stable across URL aliases. Record
positive, absent, contradictory and unchecked signals separately; absence is not mismatch.
Never infer identity from a fact that was itself imported through the proposed match.

Proposed v1 signal points, each counted once per category:

| Signal | Points / limitation |
|---|---|
| Exact personal identifier already legitimately on file matches the profile, or a direct authoritative link ties that profile to the known person | +55 identity anchor; generic inboxes and organization domains do not qualify |
| Exact normalized full name or documented alias | +15; fuzzy/name-only search generates candidates, no extra points |
| Independently known employer and role match with compatible dates | +20; both required, not two separate bonuses |
| Organization email domain already on file matches that employer | +10; organization evidence only |
| Specific career/education event with compatible dates corroborated independently | +15 |
| Compatible location for the same period | +5; missing location is neutral |
| Direct internal correspondence/interaction explicitly links this person to this profile | +25; aggregate meeting counts and a pursuit owner's name do not qualify |
| Incompatible contemporaneous role or specific career timeline | −30 per category, maximum −60; a plausible job change is not a contradiction |

Sum and clamp to 0–100. Employer/role and domain together are capped at 25. Evidence reused
across categories must disclose that dependency; the same profile repeating itself cannot
supply independent corroboration. A demonstrably different personal identifier is a hard
conflict: set aside pending review, regardless of total. Distinct publication dates alone
do not establish a contradiction. Never search for new private contact details to earn points.
Historical career matches do not decay. For employer/role, domain and location signals used
as *current* evidence, subtract 5 positive points after 12 months and 10 after 36 months,
or 5 when the effective date is unknown; clamp each signal at zero before summing. These
identity-specific age penalties are guesses too. An expired current-role signal contributes
zero, while the same record can still corroborate a dated historical role. Negative evidence
must refer to the same period; an obsolete mismatch is not a permanent penalty.

| Decision | Threshold and permitted use |
|---|---|
| Use | >=80, no material unresolved conflict, and an identity anchor plus corroboration, or at least three independent non-name signal categories supported by at least two independent source groups |
| Use with a label | 50–79, or >=80 without the required corroboration: display conditional facts in the candidate panel and use for discovery/research questions only |
| Set aside, keep for later | <50, hard mismatch, or unresolved material conflict: retain candidate and facts; no active LP-derived summary, capacity input or route edge |

If the top two candidates are within 15 points, neither is automatically “Use”; show the
alternatives with labels. All thresholds, including that margin, are guesses. A human
`same_as` or `not_same_as` assertion takes precedence over scoring; conflicting human
assertions block use pending human resolution. A high score permits the specified research
use, **not an entity merge or canonical identity edit**. Such edits retain existing human
controls and stable entity IDs. Threshold changes require an impact diff and explicit review
before remapping identities, following docs/09's identity-migration discipline.

For an LP-associated claim, expose both scores and conservatively use
`min(claim support, identity score)` for its derived confidence band; this is a bottleneck
index, not a joint probability. Human-confirmed matching clears the identity gate without
pretending that the computed score is 100. “Use” does not remove claim-level qualifications.
Never blend facts from two candidate people into a richer imaginary person.
For a relationship claim, use the minimum of the relationship proposition's support and
both endpoint match scores (excluding human-adjudicated endpoints from the numerical cap).
High confidence that two people shared an employer establishes only that affiliation: the
separate interaction claim still needs evidence, and tier/review gates still apply.

Workflow next steps are chosen by the missing signal: official staff biography or personal
site for an anchor; dated career history for a namesake; already-held correspondence/domain
for corroboration; original source for a recycled biography. W1 may research within its
approved scope; W1c only checks cited URLs and queues missing evidence for W1. Escalate only
high-impact unresolved cases to a human; ordinary doubts stay available for later evidence.

Retention includes exact original wording, source, review, claim confidence and candidate
identity confidence. If a match fails, detach its *projection* from the LP and stale dependent
strategy/material proposals; do not discard the candidate's facts. A later match can reuse
them after freshness checks. Retention never overrides existing prohibitions on broker,
contact-detail or sensitive data: retain a rejection reason rather than prohibited content.

## 4. Capacity: a total estimate with an explicit basis

Define capacity as **a plausible check into one specified vehicle/instrument within a stated
planning horizon**, not total wealth, assets managed, willingness, a commitment or cash.
Keep the committing unit explicit: individual, family office, fund LP programme, client
allocation programme, etc. An adviser does not own client AUM; a GP's fund size does not
measure that GP's personal wallet. Fund and SPV estimates are separately scoped; neither
implies a grants budget. Unknown investor kind is allowed; unknown numerical capacity is not.

Proposed consumer contract:

```ts
type CapacityEstimate = {
  subjectId: string; vehicleId: string; instrument: string; horizon: string;
  currency: 'USD'; estimate: number; low: number; high: number;
  isGuess: true; // planning estimates remain estimates, even with strong inputs
  method: 'direct' | 'size' | 'peers' | 'kind-prior' | 'fallback';
  confidence: 'high' | 'medium' | 'low'; supportScore: number;
  basisClaimIds: string[]; assumptionIds: string[];
  excludedBasisIds: string[]; reasons: string[];
  asOf: string; policyVersion: string; inputHash: string;
};
```

All amounts are finite, nonnegative, with `low <= estimate <= high`. The interval is a
planning range, not a statistical confidence interval. Zero requires evidence of zero
capacity in this scope; a refusal to invest changes propensity/restrictions, not wealth.
A separate field can show an evidenced stated check or commitment without changing the
estimate's meaning. Missing data or a failed basis must never return null/unknown/zero as
an accidental sentinel. A consumer presented with corrupt input recomputes the fallback
and reports degraded evidence; it does not silently reuse the corrupt amount.

### Calculation, in order

1. Build candidate amounts from current, same-scope evidence. Eligible LP facts require an
   identity “Use” decision and claim score >=40 without unresolved contradiction. Candidate
   identities below that gate remain visible but contribute no money. Use deduplicated
   personal/fund checks or a stated ticket policy for the actual committing unit. Never
   divide a financing total by its investor count to invent an individual's check.
2. With comparable direct amounts, use their weighted median: each unique transaction or
   policy observation gets weight `max(1, claim score)`; repeated sources for a transaction
   only improve that observation's confidence. Sort by amount then stable ID and select
   the first amount where cumulative weight reaches half the total. A stated range uses
   its midpoint. For the output range take the union of input ranges, widened if necessary
   to `[0.5 × estimate, 2 × estimate]`; these widening factors are guesses. Flag substantial
   disagreement for review, without withholding the estimate.
3. Otherwise, if a known committing-unit size fits `config.capacity.bySize`, use its band
   and the numerical representative below. Preserve the input size, unit, rule and sources.
   Size-based inference remains low-confidence even when the source size is well supported.
4. Otherwise use the median of an eligible peer cohort, if at least five distinct committing
   units have evidenced comparable checks. Freeze cohort membership, investor kind, vehicle
   type, currency conversion date, size bucket where known and observation window (proposed
   36 months). Exclude this subject, estimates, doubtful identities and duplicate units.
   Take each unit's median first, then the cohort median; one prolific investor cannot
   dominate. Range covers the central half of unit medians and at least half-to-double the
   estimate. Store count and exclusions. No eligible cohort means the next rule, not a web
   claim that suitable peers do not exist.
5. Otherwise use an investor-kind prior, or the universal fallback if the kind is missing
   or not securely known. For a verified history meeting the existing angel-count rule,
   use the angel prior as a modelling floor only; no claim of a guaranteed minimum.

Only compare like units and instruments. A company angel check alone is not a directly
observed fund LP check. Currency conversion requires a sourced, dated rate; without one
exclude that amount and use the next rule. Do not apply an undated FX guess as fact.

| Existing band / fallback | Proposed representative and planning range, USD — all GUESS |
|---|---|
| `<$250K` | 100,000; 25,000–250,000 |
| `$100K+ (floor)` | 150,000; 100,000–500,000; the finite upper value is a planning assumption, not evidence of a ceiling |
| `$250K–1M` | 500,000; 250,000–1,000,000 |
| `$1–5M` | 2,000,000; 1,000,000–5,000,000 |
| `$5–25M` | 10,000,000; 5,000,000–25,000,000 |
| `>$25M` | 30,000,000; 25,000,000–50,000,000; upper value is an assumption |
| Kind prior: individual/operator/angel; also universal fallback | 100,000; 25,000–250,000 |
| Kind prior: family-office committing unit | 500,000; 100,000–1,000,000 |
| Kind prior: institutional/foundation/corporate/LP allocation programme | 1,000,000; 250,000–5,000,000 |

Staff, advisers and GPs with no evidenced committing mandate use the universal fallback for
the individual; no institutional prior merely because of their job title. Initially use the
same explicit fallback for an uncalibrated SPV scope, label the scope mismatch, and do not
silently transfer fund evidence as comparable SPV checks. Calibration by instrument is an
open decision; downstream consumers still receive a value meanwhile.

Confidence in this estimate is the minimum score of the selected basis claims, capped at
75 for direct evidence, 35 for size, 35 for peers, 15 for kind priors and 5 for fallback.
Prior-only estimates use the cap directly, with their assumption IDs. Uncertain peer
transfer and size inference therefore remain guesses despite well-sourced inputs. If an
active basis fails, exclude it, rerun the hierarchy and record the replaced estimate. Cap
the revision's score at `max(0, previous score - 10)` until newly checked replacement evidence
or an explicit human review resolves that failure. Do not reapply the penalty on every run;
it belongs to the unresolved failure event. Confidence can bottom at zero while the estimate
still has a numerical value. If an unchanged independent basis remains valid, disclose why
the amount did not change despite reduced confidence.

Invented example: a $2M size-derived estimate loses its only valid size claim. A secure
family-office kind supplies a new $500K estimate, range $100K–$1M, labelled “Guess — kind
prior; previous size basis failed.” If that kind also depended on the rejected identity,
use the $100K universal fallback. Neither case generates a blank downstream capacity.

Scoring, triage and strategy must consume the amount **with** its label, range and basis.
Once the evaluator and its input scope are approved, routine fallback calculation requires
no per-person approval or manual list-clearing. Send exceptions for high-impact conflicting
evidence to review; leave ordinary low-confidence estimates usable as labelled guesses.
Show sensitivity to low/high estimates; a precise ranking built on priors is not precise
knowledge. The estimate does not authorize an ask or establish willingness. No capacity
estimate enters hard capital, convertible-soft probability, a signed amount or cash. Preserve
the hard/soft split, separate vehicles, and deterministic conserved-pool allocation checks;
never add per-vehicle capacity estimates as if they were distinct budgets.

## 5. Feedback, learning and bounded correction

Add a person-level “Data or connection feedback” box, optionally targeting a claim, candidate
match, capacity estimate or edge. Store the user's words, actor, time, subject and the exact
revision shown in private evidence files. Optional structured choices distinguish “I know
this first hand”, “source correction”, “possible mismatch”, “estimate too high/low” and
“route presentation”. Saving feedback is a receipt for evidence, not acceptance of an
agent's interpretation, identity merge, route review or intro consent. Do not require a long
form. The existing global issue box remains for product bugs.

The local loop has three distinct outputs:

1. **This person:** propose atomic support/contradiction observations. A specific first-person
   account can substantiate a personal tie; a vague objection opens a dispute. A directional
   capacity nudge with no amount uses one adjacent numerical band down/up (clamped at the
   table ends), explicitly a provisional assumption with support capped at 15. A user-supplied
   estimate replaces that assumption without becoming a verified fact. Show the proposed
   amount and reason; require human acceptance of any agent-extracted adjustment. Repeated
   submission of the same feedback ID cannot repeatedly ratchet the number.
   Use the ordered representatives 100K, 150K, 500K, 2M, 10M, 30M for a directional nudge;
   select the next strictly lower/higher representative, retaining the end value if none
   exists. This is an assumption revision, not newly observed money. Contradictory nudges
   on the same displayed revision require resolution rather than averaging them.
2. **Rule proposal:** identify the failed extraction/join/use rule, show before/after behaviour
   on protected invented cases, expected affected count and risk. No automatic global weight
   training or prompt rewrite. Claude reviews and Juan approves rule changes; agents cannot
   alter evaluation criteria or permissions to make the proposal pass. Generalize only the
   mechanism; a person's acquaintance does not prove acquaintances for their colleagues.
3. **Similar-record proposal:** a private manifest selected by explicit predicates such as
   same failed source group, adapter version, claim kind or join failure. No free-form
   unbounded “find everyone similar” expansion. Show selected count, exclusions and hashes.

After approval, freeze a work envelope with task, exact read/write scope, allowed evidence
and commands, token/item budget, deadline, output schema, acceptance criteria and escalation
owner. Suggested first limits are a five-record pilot, then at most 25 selected records,
one correction/recheck cycle; these are GUESS ceilings, not permission to start. Whole-firm
context may be read within scope but does not authorize writes to colleagues. New evidence
or a new rule version creates a subsequent batch, never changes the active manifest.

The launcher records each bounded operation with docs/20's shared `runs.jsonl` begin/finish
interface, actual workflow (`W1c` cited-source check, `W3` route repair, or null for feedback
triage), operation, manifest/rules hashes, counts, checks, actual model and known/unknown
usage. Keep correction details in evidence files, not oversized ledger lines. Start failure
means do not launch; absent finish means unknown. The ledger records execution, never
authorization, acceptance or import. No additional run registry or scheduler is required.

An independent check compares the proposed revisions to the frozen evidence and protected
criteria. Human acceptance uses a stable proposal ID/idempotency key. Recheck the currently
displayed revision before acceptance; concurrent edits require a new diff. Only approved
changes reach app projection; unrelated records remain untouched. Stop at budget/deadline,
revoked authorization or unavailable reviewer, retaining completed proposals for review.
Measure correction time against the existing circuit breaker; excess freezes new autonomy.

### Route feedback acceptance cases

The private cases 0037–0041 were read in place. The following are **invented regression
analogues**, not copies of those records. They state the change each request needs.

| Case | Invented analogue and expected change |
|---|---|
| 0037 | A candidate appears near a prospect but no route appears. Trace candidate identity → named endpoints → evidence/tier → human review → restrictions → path enumeration → presentation. Return the exact stopping reason and needed evidence; promote only when that gate is satisfied. Count alternative supported routes; never increase points merely to make one appear. |
| 0038 | Mira formerly worked with several team members, while a pipeline label suggests prior investment. Join existing dated records before new research, distinguish missed joins from missing evidence, and recover each actual personal interaction. Shared employment alone stays C; the pipeline label cannot prove signed capital or a consent rung. |
| 0039 | Rowan explicitly says “I know Casey” and identifies a past investment. Store the named first-person relationship evidence separately from the investment claim. Offer a direct edge with its source and date for review; do not infer that every team member knows Casey or that Casey welcomes an introduction. |
| 0040 | A remark targets the edge Rowan–Casey. Save it on that subject, propose its correction, propose a general rule separately, and queue a bounded similar-record manifest. A successful run cannot accept its own changes. |
| 0041 | Rowan → Taylor → Quinn and Rowan → Avery → Taylor → Quinn share a final hop. Collapse the longer alternative only if the direct prefix is usable and at least as warm/current as the detour's weakest hop, with no distinct useful ownership or willingness evidence. Unknown/weak direct warmth leaves the alternative visible. Preserve all paths in a keyboard-accessible expansion and the intermediate person's inspector; hover is optional. |

Warmth is an ordinal relationship assessment; it is neither identity confidence nor consent.
Use the existing tie evidence and a separately reviewed warmth policy. `influence.ts` currently
favours moderate ties over strong ones for discovery; do not silently reinterpret that as
investment-introduction readiness. A confirmed first-person acquaintance supports that
specific tie, not automatic tier A. C/D still require a human, and current reviewed C/D routes
remain held. Membership may seed a one-hop discovery candidate, including permitted
warehouse membership; it does not identify a team member who can contact the person.

Restrictions, consent, connector load and the five approval-ticket families remain in force.
A feedback score cannot remove do-not-approach restrictions, switch connectors to evade them,
advance a consent rung or send anything. Each search discloses corpus/date coverage and
uses “No supported route in the material inspected” when that is all the evidence shows.

## 6. Files as source, small app projection

Use the shared private root `plcos-data/real/`; dev `data/real/` is only a preview copy.
Keep existing raw findings and reviews. Proposed additional files, created only in phase 2:

| Under `real/enrich/confidence/` | Contents |
|---|---|
| `subjects/<stable-key>.json` | Versioned candidate profiles, atomic claim revisions, observations, checks, identity pairings and capacity assessments for one subject; references to existing raw files and hashes |
| `feedback.jsonl` | Append-only human remarks and subsequent interpretation/decision references, deduplicated by feedback ID |
| `proposals/<proposal-id>.json` | Bounded correction/rule proposal, affected IDs/hashes, before/after diff, review/acceptance and invalidation references |

No per-run evidence folders, extra execution ledger or general event-sourcing system.
Keep original revisions within each subject document; edit through validated, atomic
temp-file replacement with expected revision/hash. Coordinate one writer per subject; stale
input causes refusal, not last-writer-wins. Readers reject malformed/truncated files and
surface the affected scope. Retain allowed extracts only, with source references and dates;
do not build a full web-page archive. File existence/mtime is never proof of review or a run.

Use minted stable claim/observation IDs plus content hashes for revisions; never identify a
fact only by array position or wording. Legacy reviews without hashes must match subject,
source and exact proposition before reuse; ambiguous matches need rechecking. Retain source
groups and dependencies so an identity correction invalidates only its dependent summaries,
edges, capacity bases and unaccepted proposals. Recompute from accepted current revisions;
historical assessments retain their pinned inputs and evaluator versions.

Files have sensitivity metadata and restricted readers. Public-source observations can
project to research; internal correspondence, feedback and confidential amounts remain in
the confidential plane with scoped references. Never copy confidential excerpts into public
research merely to explain a score. An authorized app view may join them through module
interfaces; grants/schema separation remains the boundary. Fixed profile-aware roots, safe
IDs and traversal/symlink validation apply. Demo fixtures are invented; real data never enters
git, screenshots, public docs, external searches or another agent's prompt. Affinity and
warehouse access remain read-only under AGENTS.md.

### Mapping and migrations

Start with a validated reader and `research.note` projections keyed logically by subject and
projection kind: `confidence_summary`, `identity_candidates`, `capacity_estimate`. JSONB
holds the small current assessment, stable file IDs, input hash, policy version, reason
codes and mapping time. Full revision history remains in files. Candidate-profile facts
stay in their labelled candidate panel; they do **not** become ordinary LP claims merely
because a note is attached to that LP. Acceptable active claims may map to `research.claim`
with a source document and the conservative legacy confidence band.

The first read-only reader/inspector and validated note mapping need **no schema migration**.
Use one typed module interface for capacity and one for confidence; every consumer of the
new estimate must use those interfaces. New JSONB does not itself make existing validators,
route generation, strategy or scoring safe. Cut over those consumers explicitly, with a dry
run that lists held claims, revised estimates and affected paths before any live import.

Before replacing legacy claim import, add a small **new append-only research migration** for
a nullable stable external claim ID and revision hash, with uniqueness for imported revisions.
This makes idempotent imports and supersession precise instead of relying on text matching.
Keep old rows, backfill only unambiguous mappings and flag conflicts; never delete verified
claims. Deprecate the delete/reinsert path for these imports. If accepted evidence conflicts
with a human-verified claim, surface a conflict pending a new human decision.

Before rebuilding feedback-confirmed edges, prove review survives using a stable logical
edge ID plus reviewed evidence/proposition hash. If existing fields cannot preserve that
contract, add a separate network migration for that mapping, rather than copying a review
onto a new edge by names. Changed endpoints or relationship meaning invalidate old review.
Use existing human `identity.match_assertion`; no canonical identity remapping in the first
slices. Add numeric capacity/filter columns or indexes only when repeated filtering, precise
tool input or demonstrated performance earns them. Migration numbers are assigned by the
integrator; never alter an applied migration or reset the real database.

Only the live server maps approved files into the real DB. File acceptance and DB projection
are separate operations: store the accepted hash, import transactionally, show mapping lag or
failure, and retry the same hash idempotently without repeating the workflow. Do not report
“saved in app” before a server receipt. Display both evidence date and last mapping time.

Empty/loading views state coverage; failed reads retain a dated last-good projection labelled
stale. No last-good capacity means a visible configured fallback. Conflicting edits or
rejected claims show owner and next review step. Expired/revoked authority, paused or exhausted
work and an unavailable owner stay waiting, with no automatic retry or expanded permissions.
Unknown execution requires operator reconciliation before retry. Source unavailability says
what could not be checked; it never asserts that no evidence or relationship exists.

## 7. Phase 2 slices and decisions

Each slice is separately reviewable. Claude reviews, Juan approves implementation; integration
and any workflow/live import follow COLLAB. No slice authorizes outreach or accepts a proposal.

| Slice | Deliverable and acceptance |
|---|---|
| A — Files and evaluator | Versioned contract, pure deterministic claim/identity/capacity evaluators and invented fixtures. Prove replay stability, independent-source deduplication, explicit disagreement, retained doubtful facts and a finite capacity for every subject. No DB or workflow execution. |
| B — Workflow adapters | Stable IDs, hash-aware W1/W1c reviews and W5/W5c capacity contract; retain originals and align derivatives. Protected cases cover failed sole basis, namesakes, adviser AUM, firm/person scope and no new false support from unavailable pages. Run a private dry-run impact report; no import. |
| C1 — Read-only app view | Confidence/candidate inspector and note projection, with provenance, stale/error labels and invented demo visual QA. No legacy claim-import cutover. |
| C2 — Claim-import cutover | Reviewed stable-ID migration, idempotent supersession and exclusion of doubtful candidates from LP claims. Private dry-run diff before separately authorized live-server import. |
| C3 — Capacity consumers | Total capacity interface and explicit scoring/triage/strategy cutover. Verify missing and failed bases still return labelled values, without adding money to any commitment or forecast. |
| D — Feedback on a person | Save evidence with stable IDs/server receipt, propose scoped corrections, review and idempotent acceptance. Show the exact revision and conflicts. No automatic generalized corrections or launch. |
| E — Similar-record loop | Predicate/manifest proposal, bounded pilot, existing ledger wiring, independent check and accepted diffs. Prove out-of-scope writes refused, no self-acceptance, and budget/revocation stop behaviour. |
| F — Route and presentation integration | Resolve the invented cases above; preserve logical-edge reviews, distinguish warmth from influence, and expand/collapse paths accessibly. Prove C/D and restrictions still hold, including when all scores are high. |

Use appropriate checks per slice: typecheck, boundaries and targeted properties; protected
workflow evaluations for prompt changes; demo browser checks for UI. Fixtures must also
cover age versus retrieval date, repeated feedback, competing identity matches, human
assertion precedence, projection failure, current/historical facts, and hard/soft separation.
Evaluate calibration on adjudicated examples, stratified by signal/method, and report count
and error rates; do not claim probabilities from a small sample. Review guesses after two
weeks of actual use. Rule updates require frozen cases, a before/after impact diff, a new
version and human approval; never change a running batch's policy.

### What an approved run can use tonight

The private plan remains authoritative for its scope, budget and window; this design neither
changes it nor launches anything. Existing file workflows can already retain doubtful-profile
facts with separate identity/claim labels, original wording and check reasons; trace route
gates; collect disambiguating evidence within workflow scope; and propose numerical capacity
guesses with explicit assumptions in **separate private draft outputs**. They can turn the
feedback cases into bounded expected-result checks and use the merged, verified docs/20
ledger for approved executions.

The formulas and priors here are proposals. Using them in a run requires freezing an approved
version with its inputs; narrative labels alone must not pretend the evaluator exists.
Current W1c rules still limit it to cited URLs. Do not rewrite those rules during a pass,
hand-edit generated routes, import unresolved facts through the legacy importer, or weaken
validators to accept a fallback. Where existing W5 schemas/gates cannot represent the new
capacity or candidate-path contract, keep a labelled proposal/addendum and the canonical
output unchanged. No app UI, DB mapping, general graph adapter, automatic feedback queue or
new scorer is claimed to be available tonight. Numerical draft estimates remain available
to the approved drafting work while product consumers await their reviewed cutover.

### Decisions before the corresponding build

1. Approve or revise the proposed score weights, identity thresholds/candidate margin and
   freshness windows. A calibration sample must precede automatic research-use projection;
   no automatic canonical identity merge is proposed.
2. Approve the provisional capacity representatives, kind priors and universal $100K fallback;
   designate the planning horizon and which fund/SPV peer cohorts are comparable. These are
   policy assumptions, not observed market statistics. Evidence gathering need not wait.
3. Name the human who accepts parsed feedback, identity decisions and C/D relationship
   reviews, and the reviewer for general rule changes. Unassigned proposals remain pending.
4. Approve the smallest initial slice and its acceptance cases, then decide the private
   pilot/import scope from its dry-run diff. This phase-1 document supplies no such approval.

Phase-1 validation: documentation only; run `npm run boundaries`. No product code, real-data
writes, issue edits, workflow runs or migrations are part of this commit.
