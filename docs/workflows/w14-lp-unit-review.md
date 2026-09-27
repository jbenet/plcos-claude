# W14 — Review who the LP is

Version 1. Determine whether a person's pursuit belongs to them personally or to a named
affiliated firm, using public evidence and our existing findings. A job title alone does not
establish whose money they invest. Missing personal evidence does not establish firm investing.

## Read set and authorization

Read this protocol, AGENTS.md, `docs/agent-rules/real-data.md`, `docs/23-lp-units.md`, W1's
**Firm rules** in `docs/workflows/w1-profile.md`, and the workflow-run recording section of
`docs/COLLAB.md`. The launcher supplies an authorized profile root, bounded batch, work envelope,
run ID, input/protocol hashes, budget and deadline. Freeze the inputs and rules during the pass.

Read only assigned rows of `enrich/lp-unit-review.jsonl`, their matching existing findings under
`enrich/raw/`, and public pages. Never open the database, connector replicas, contact exports,
other batches or candidate strategy exports. Build and evaluate protocol changes with invented
demo fixtures. Real inputs, local notes and outputs stay under the authorized shared real root;
never put them in git, screenshots, issues, remote prompts or a public handoff.

No sign-ins, paid services, contact brokers, external writes, outreach, forms or posts. The
researcher writes proposals only. A person runs **Re-point pursuits to their LP** or **Import
the findings** to apply them. No research agent runs either action or accepts its own work.

## Input

**Export the research set** writes one row per unresolved pursuit, across all active raise
statuses, without the UI report's row cap. Historical vehicles and the grants rail are excluded.
An export is read-only. Inspect its receipt: do not use a failed/stale LP-unit review file.

```text
{
  pursuitId,
  vehicle: {id, name},
  person: {entityId, name},
  firms: [{entityId, name, role, knownToInvest, investingEvidence, primary}],
  evidence: {
    personal: [{kind, label, ref?}], familyOfficePrincipal,
    strategyNamesPersonalAccount, numberOrSignatureOnLadder
  },
  amountsOnFile: "present" | "absent",
  reason
}
```

`knownToInvest` means the rule has a reason on file, not that a person verified it. Read the
reason: a name containing “Capital” is weaker than an explicit account of investing. The
evidence describes what the rule saw; it does not prove the proposed answer. Amount presence
covers this vehicle's exposures and any capital pool in the person's name, including aliases.
A high ladder event is reported separately. No numeric amounts or contact details are exported;
embedded contacts and numeric figures in identity text are omitted. Do not reconstruct them.
Person decisions, previously applied file decisions and reversed re-points are excluded.

## Research and query rules

1. Read why the pursuit was flagged and compare every firm candidate. Check identity and role
   chronology against existing findings. A firm and its founder remain distinct LP units. A person
   may invest through a firm and personally; do not eliminate their personal capacity just because
   they have a firm affiliation. Never create an additional pursuit through this workflow.
2. Prefer explicit public evidence: a personal biography naming angel investments, a personal
   fund commitment, or a firm/team/portfolio page identifying the firm as the investor and the
   person's role representing it. A founder title, wealth estimate or employer affiliation alone
   is insufficient. An operating company need not invest. “Personal” is a capacity, not a firm.
3. Apply W1 query rules: queries carry only name, organization, role/title, location and public
   topic words. Never include pursuit/entity IDs, our vehicle, pipeline membership/status, private
   notes, amount presence, amounts, contact information or our identity. Do not send a batch or
   Dakota's private/aggregated fields to any outside service. The export is local context.
4. Requests carry no identity of ours in headers, including User-Agent. Where a service requires
   a contact address, follow W1's privacy-preserving address rule. Read government pages sparingly;
   SEC at most one request per second, no bursts or loops over names, and stop on 403/429/503.
   No sign-in workarounds or rapid retries. Do not collect health details.
5. Record the inspected corpus, search/read dates and each source's actual support in the private
   batch report. Exact public excerpts must be real quotations. A local finding comparison is
   explicitly the reviewer's assertion, with its file/reference, never a fabricated public quote.
   State evidence strength and uncertainty. Unsupported is not nonexistent. Where evidence remains
   ambiguous, write no decision; record the gap and next research step in the private report.
6. Propose `personal` only with affirmative evidence of personal investing; propose `firm` only
   when the evidence identifies that candidate firm as the committing unit. Choose a supplied
   canonical firm ID; do not invent an organization or substitute a namesake. If the right firm
   is missing or an affiliation is outdated, leave unresolved and request corrected inputs.
7. If amounts are present, never propose `firm`: record that the money attribution requires
   resolution on the LP page. A number/signature on the ladder also prevents a firm move. Do not
   transfer money, alter ladder evidence, change status or remove records to make a decision pass.

## Output

Write one proposal per pursuit to the assigned `enrich/lp-unit-decisions.jsonl`:

```json
{"pursuitId":"11111111-1111-4111-8111-111111111111","decision":"firm","firmEntityId":"22222222-2222-4222-8222-222222222222","evidence":[{"source":"https://example.org/invented-firm/team","as_of":"2026-09-27","quote":"Invented example only: Avery invests on behalf of Example Robotics."}],"decided_by":"reviewer identifier"}
```

For `personal`, omit `firmEntityId`. Every line needs a nonempty reviewer identifier and at
least one nonempty source/quote with a real calendar date (`YYYY-MM-DD`). Use a public URL or
matching local finding reference. Do not put amounts, contact details or private notes in evidence.
`decided_by` identifies the researcher; the journal separately records the person applying the file.
Code validates structure and current records, not the truth of a researcher's quotation or inference.

## Application, reversal and acceptance checks

Both human-triggered actions read the same file and apply its valid decisions before the rule
pass. Each line has its own savepoint. Malformed JSON, invalid fields, conflicting proposals,
unknown/stale pursuits, noncanonical/ended/pseudo firm affiliations, money guards and status
conflicts are refused with physical line numbers and reasons in Developer → Enrichment.
Valid neighbours can still apply. The normalized decision and evidence are pinned in the journal.
Repeated identical proposals are harmless; different proposals cannot silently replace an answer.

A person's LP-page decision always wins, before or after a file import. File answers have their
own attribution and the automatic rule preserves them. A move carries the existing pursuit's
history and leaves the person as a firm contact; it never transfers money or implies consent.
Use the existing **Reverse** action to undo a file decision. Compare-and-restore refuses changed
rows; reverse later re-points first. A reversal is not permission for a file retry to reapply it.
Resolve any replacement on the LP page. Do not erase journal records to force a retry.

Before finishing, verify IDs against the frozen export, personal versus firm distinction, evidence
dates/citations, amount/ladder guards, uncertainty and contact exclusion. The protected invented
cases run with `npm run props`; never change pass criteria or permissions to win. Finish the run
ledger with reviewed/proposed/unresolved counts and actual checks. The public handoff gives counts
only. This protocol does not authorize autonomous imports, sending, or database access.
