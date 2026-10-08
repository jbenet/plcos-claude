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
approves; claims and notes are never used as records. Since 8 Oct 2026 (issue 0137, rule 3) it records the
conversation rungs itself and proposes only what lies above them. Since N81, a record counts for a vehicle
only when it is tagged with that vehicle — it names it, or Claude (W12, `event-tags.jsonc`) or a
person on the LP's timeline tagged it — and falls inside its raise window; a person's tag counts
whatever the date. A record about a raise that names no vehicle is "vehicle unclear" and counts for
none (before N81 it counted for every vehicle raising on its date). The fundraising-domain rule reads
an email's addresses only, never a meeting's invitees or a note's author. The LP's timeline shows
every record, labelled with its vehicle or "General", and filters by fund.

**3. Five approval-ticket kinds gate mutations, before the fact — SEND and INTRO_ASK for agents only.**

`SEND` · `INTRO_ASK` · `MONEY` · `STAGE` · `ALLOCATION_EXCEPTION`

Every mutating command in those families takes a `ticketId` and **fails closed** without an
approved, unexpired one. One open ticket per subject per kind. An approval authorizes a
*specific bounded action*, stated in the ticket's `scope` — never an opaque bundle.

*Juan, 5 Oct 2026 — no SEND or INTRO_ASK tickets for people.* "this seems like complexity overkill. i think we
want to be super clear on what outreach has happened and equip senders with clear visual info so they can make
the best decision there, but not create super complex approval flows that will just grind things to confusion or
halts. if this was for automated agents only, ok, but not for humans (we're slow)". So, precisely
(`modules/governance/autonomy.ts`, `ticketNeeded`):

- **A person never needs a SEND or INTRO_ASK ticket**: anyone using the app, or a token acting for its owner
  interactively — a person clicked. Recording an ask on the routes page opens none; a material that passes the wrap
  check is cleared, sent by the person and marked sent (the wrap is checked again then, rule 11); an intro-ask
  draft no longer says to wait for an approval; juanmail's links need none.
- **Instead the sender sees the context** where they draft or send — the LP page's Email card, the routes page's
  intro-ask box, juanmail's queue rows (`trace`, `checks`): the last touches with dates, direction and source; who
  owes a reply; the other vehicles in play and their status; who on the team is in the thread and who holds it;
  restrictions as a red flag, always shown, never silently skipped; the material's compliance (the wrap rule,
  506(c) accreditation, which materials may go).
- **"Autonomous" is a flag, never a guess**: a token whose list carries `mode:autonomous`, or a call marked
  `_meta.autonomous: true` (MCP) or `X-Autonomous: 1` (REST) — juanmail running a batch with no human click. A call
  can add the flag, never remove it. An autonomous SEND or INTRO_ASK fails closed without an approved, unexpired
  ticket; a person approves an agent's tickets, singly or as a batch (Approvals → the agent's sends).
- **Unchanged:** MONEY, STAGE and ALLOCATION_EXCEPTION need a ticket from everyone. None of them blocks a person's
  ordinary outreach (checked 5 Oct 2026): STAGE is the ladder, which no send moves (the status needs no ticket),
  and MONEY and ALLOCATION_EXCEPTION are the close track. Restrictions (rule 8), the grants gate (rule 12) and the
  wrap check (rule 11) are not tickets and hold for everyone.

*Juan, 8 Oct 2026 — Reconciliation's conversation rungs need no approval.* On 17 open STAGE proposals, each
"obvious from email context (dont need an explicit approval), or ... clearly incorrect": "i dont think we need this
"decisions / approval" thing for these things"; "system should be able to figure it out". Confirmed on a decision
card the same morning. So, precisely (`lib/reconcile.ts`, `recordClimbOnRecord` in `modules/strategy/service.ts`):

- **Reconciliation records the conversation rungs without a ticket**: the connector's (not applicable, in direct
  contact), LP opted in and Meeting held, each on the record behind it — a meeting or call with them, a reply from
  them, our event they came to — under the same rules of what counts for a raise (N59, N81). Only its inactive
  system actor may, only those rungs, only on those kinds of record; the ladder must not have moved.
- **It says so and can be undone**: each rung's note ends "recorded by Reconciliation from the records on file,
  no approval asked", the LP's timeline shows it as recorded rather than confirmed, and **take back** removes it
  and what it recorded above it; that record is not used again for the LP.
- **Never for a non-LP**: a portfolio company of ours (`network.portfolio`) or our own team gets nothing recorded
  or proposed, and its open proposal is withdrawn.
- **Unchanged**: above Meeting held — a number, a countersignature, a wire — Reconciliation still proposes a STAGE
  ticket and a person approves. A person's own ladder advance, MONEY and ALLOCATION_EXCEPTION still need tickets
  from everyone. Its earlier open proposals are applied or withdrawn on its next run.

*Juan, 5 Oct 2026 — the email trail is the record.* "as much as possible we should record all this stuff from
events directly in email and let email be the state. we may need to record info happened outside of email but that
should be a note ... let the actual comms trace reveal what happened ... im not against logging this stuff, but
you'll have to reconcile with actual comms anyway". Recording a send became linking a message
(`outreach_link_message`), which creates no outreach state; the LP's timeline, last touch, who owes a reply and who
holds the thread are read from the merged comms trace (Affinity's records and the Gmail messages juanmail reports
through `comms_ingest`, one row per message); the app's logs stay an audit of actions, and where one disagrees with
the trace the trace is shown and the disagreement flagged. Something that happened outside email is a note
(docs/27-outreach-api.md §5–§6).

*Juan, 4 Oct 2026 — a tool may send.* Juan decided that the mail desk (an external tool, not
Capital OS) drafts first, then gets rate-limited send rights through a MailGuard key, replies
first, then invites (the desk's feedback, 4 Oct). *Superseded in part on 5 Oct 2026, above:* a desk send a person
clicks needs no ticket; the ticket below is for the desk acting autonomously, and `outreach_record_send` became
`outreach_link_message`. As it stood on 4 Oct (docs/27-outreach-api.md):

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
0040). Human sign-off stays on actions (rule 3: an agent's sends and intro asks, money, the ladder), not on information.
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
