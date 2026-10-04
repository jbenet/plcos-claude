# Domain rules

Rules moved from AGENTS.md. Read this file when its scope applies; all rules still hold.

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
sourcing, selected, connecting (N60), discussing, committed, passed — is our plan: set by a
person, any direction, no ticket, and it never writes a rung. Since N60 the LP page's stepper
is the status, with the close track after Committed, and each rung of the ladder shows as the
evidence under the status it belongs to — confirmed in green, on record but unconfirmed in grey
— so the gap between claimed and evidenced stays visible (Juan, 24 Sep). The second rung displays as "LP opted in";
"target" means only a vehicle's size goal.

Reconciliation (N57, `docs/18-reconciliation.md`) keeps the ladder in step with the records:
after each translation it proposes the climb that records on file support (a meeting on the
calendar, a reply from them, a signature recorded here), as one STAGE ticket per LP listing each
rung and its record, requested by the system's inactive "Reconciliation" actor. A person
approves; claims and notes are never used as records. Since N81, a record counts for a vehicle
only when it is tagged with that vehicle — it names it, or Claude (W12, `event-tags.jsonc`) or a
person on the LP's timeline tagged it — and falls inside its raise window; a person's tag counts
whatever the date. A record about a raise that names no vehicle is "vehicle unclear" and counts for
none (before N81 it counted for every vehicle raising on its date). The fundraising-domain rule reads
an email's addresses only, never a meeting's invitees or a note's author. The LP's timeline shows
every record, labelled with its vehicle or "General", and filters by fund.

**3. Five approval-ticket kinds gate mutations, before the fact.**

`SEND` · `INTRO_ASK` · `MONEY` · `STAGE` · `ALLOCATION_EXCEPTION`

Every mutating command in those families takes a `ticketId` and **fails closed** without an
approved, unexpired one. One open ticket per subject per kind. An approval authorizes a
*specific bounded action*, stated in the ticket's `scope` — never an opaque bundle.

*Juan, 4 Oct 2026 — a tool may send.* Juan decided that the mail desk (an external tool, not
Capital OS) drafts first, then gets rate-limited send rights through a MailGuard key, replies
first, then invites (the desk's feedback, 4 Oct). This changes who presses send, not the gate: each email still needs its own
approved SEND ticket, and the rule above holds unchanged. Precisely (docs/27-outreach-api.md):

- Capital OS has no code that sends. The desk sends from its owner's own mailbox, through
  MailGuard.
- The desk opens the ticket (MCP `outreach_request_ticket`, or `POST /api/outreach/tickets`), naming the LP and every recipient;
  the scope authorizes one email to those recipients about that vehicle, once. It is requested
  by the inactive "Mail desk" actor, so the person who approves is never the requester, and no
  API operation approves anything.
- A person approves it in Approvals. Approving runs nothing.
- After sending, the desk records it (`outreach_record_send`, or `POST /api/outreach/sent`) with the Gmail message id and the
  time. Capital OS refuses the record unless the ticket is approved, unexpired, for that pursuit,
  the recipients are within the approval, and the ticket has not been used; the same message
  again is the same record (idempotent), a second one is refused. A material in the email
  re-runs the wrap check at record time (rule 11).
- A pipeline status may change through the desk (`outreach_update`) only as a box Juan ticked, through
  the LP page's own service and guards; never a ladder rung, money or a ticket decision (Juan, 4 Oct).

*Juan, 4 Oct 2026 — two guards became advisory.* "We have to pitch SPVs as we go": an open fund
discussion no longer holds an SPV pitch. It is flagged (`blocking: false`), the desk chooses —
mention both in one note, send the SPV separately, or wait — and the overlap is recorded with
the choice and a dated follow-up (rule 5, `coordination.overlap`). The ask cap
(`asksPerRelationshipPerQuarter`) "may be too small; raise it or don't enforce it until it's
needed": it is reported, not enforced, while `config.guard.askLimit` is `'advisory'`. Rule 8
(restrictions) and rule 12 (grants) still block.

**4. Agent-run success, task acceptance, investor approval, legal close and cash receipt
never share one check mark.** Five different states, five different affordances.

**5. Cross-vehicle collisions become a record, not a block.** When an actor has another
open opportunity in a different vehicle inside `conflictWindowDays`, open a `ConflictCase`.
Adjudication writes winner, loser, reason code, **and a dated follow-up for the loser**.
Blocking without the dated follow-up loses the opportunity silently — that is the bug.
*Juan, 23 Sep 2026:* an LP on two vehicles' lists is usually good for them and for us; it
needs coordinating, not winning. Say "coordinate" in copy where the case is only an overlap,
and keep "conflict" for two asks that would actually collide.

**6. Evidence tiers A–D on relationship edges, modelled as uncertainty, never gated on a person.**
Co-attendance, shared affiliation and a public social connection are weak evidence, not proof of a
relationship: a C or D tie routes, ranked below better-evidenced ties and labelled with what it rests on,
and gains or loses confidence as evidence arrives (docs/21). *Juan, 26 Sep 2026:* "don't have humans
confirm info. That makes a brittle system. Instead model the uncertainty, and gather more evidence over
time. If humans see something wrong while using the app, they can flag it there" (the feedback box, issue
0040). Human sign-off stays on actions (rule 3: sends, intro asks, money), not on information.
*Juan, 26 Sep 2026:* Protocol Labs is our own network, so affiliation there is strong evidence. Two people who are
or were at PL are warmly tied, with no email or meeting needed. Every PL team member can be the source of a
route. Everyone in the PL network is tied to the PL team, and where no particular team member is known, a
"PL" organization node is the source (`PL → <PL founder> → <target>`). Every person and organization the
research touches goes into the network as a node, LP or not, so it can serve as a connector.

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
