# 23 · LP units: who the LP is

Issues 0111 and 0112 (Juan, 27 Sep 2026): "think carefully about who the LP is (the firm or an
individual?)". Decided by Claude, the integrator, the same day.

## The model

1. **The LP is the committing unit.** It is either an organisation (a fund, family office,
   foundation, company, or a vehicle such as two GPs' joint fund) or a person in their own
   capacity. A pursuit is one LP unit × one vehicle.
2. **A person at a firm is not an LP.** They are a contact or decision-maker on the firm's pursuit,
   named inside the firm's row with their role (`strategy.pursuit_contact`), not a row of their own.
3. **A person who also invests personally** (a GP pair who invest through their fund and as angels,
   a single-family-office principal with no separate vehicle) has an individual LP row, linked to the
   same person, beside the firm's row. It is a pursuit whose LP unit is the person, with
   `lp_capacity = 'personal'`, made only on evidence of personal investing.
4. **"Personal" is not a firm.** An organisation record named for a capacity ("Personal",
   "Personal investing", "Individual", "Self") is read as evidence of personal investing, never as a
   firm or a group (`isPseudoOrg`, modules/strategy/lp-unit-rules.ts).

Every row of an LP list is one LP unit: an organisation, listed once with its people named in the
row, or an individual, with their firms as context. Someone who invests both ways is in both places,
and each row links to the other. Since issue 0113, Selection and Pipeline rank organisations and
individuals together in one list, mark each row with a type icon, and have Firms and Individuals
toggles (`rankRows`, `units` in components/strategy/pipeline-model.ts); the fit list still lists
organisations first (`lib/lp-groups.ts`). Strategies, fit readings and the LP page are per LP unit ×
vehicle.

A contact's touchpoints count as the LP's own: a meeting with the person who speaks for a firm is a
meeting with the firm, as it counted before the pursuit moved (modules/meetings, `via_contact`).

## Evidence of investing personally

Any one of these, for the person: a signed commitment in their own name (a hard exposure); public
research claims of angel or personal investments, or personal fund commitments; a research profile
that reads them as an angel; a prospect row that names them without a firm; a listing under a
pseudo-organisation; a strategy whose `ask.unit` names their own account; a family-office principal
with no family-office entity on record.

An organisation counts as investing when it is a family office or a foundation, an allocator in
Dakota, found by research to invest, has money on record, is pursued as an LP, is named by a
strategy as the unit that commits, or its name says it manages money (Capital, Ventures, Partners,
Fund, Holdings, Trust, Endowment…). The last is the weakest reading and is labelled as such.

## Re-point pursuits to their LP

A job (Developer → Enrich, and a step of Import the findings; `modules/strategy/lp-units.ts`). For
each active person's pursuit on a vehicle being raised (not the grants rail, not a vehicle kept for
its history):

| What is on file | What happens |
| --- | --- |
| Evidence of investing personally | Kept, marked `lp_capacity = 'personal'` |
| An amount in their name here, or a number or signature on the ladder, and no such evidence | Kept, flagged for review: whose money is it? |
| One investing organisation (or the one the strategy names, or the primary one) | Moved to the organisation's pursuit, created from the person's when missing; the person stays as a contact |
| A firm nothing says invests, or several investing firms | Kept, flagged for review (`lp_review`) |
| No organisation at all | Left as it is |

A move carries the status (see below), owner, ladder events, strategies, updates, meetings,
notes, plans and approval tickets (retargeted and expired, as a merge does), and writes an update
on the firm's pursuit in the person pursuit's own words. Money is never moved between names, and
fit readings stay on the entity they were made for.

**Statuses.** The furthest live status wins, so no status is lowered, a person-set one least of
all; a person's status carries its source. A person's Passed against a live row is left for a
person to decide.

**Journal and reversal.** Each decision is one `strategy.lp_repoint` row with the exact row changes
it wrote. A reversal restores them by compare-and-restore and refuses if anything changed since;
undo a later re-point into the same LP first. The rule never re-applies a reversed decision and
never overrides a person's own decision, made on a person's LP page ("Who is the LP?"). A second
pass over unchanged records writes nothing.

**Research decisions.** Export the research set also writes `enrich/lp-unit-review.jsonl`, one
row per unresolved pursuit with firm candidates, rule evidence and amount presence only. W14
(`docs/workflows/w14-lp-unit-review.md`) researches public pages and existing findings without
database access. Both re-point and Import the findings accept `enrich/lp-unit-decisions.jsonl`.
Valid answers use the same journal and reversal as the LP page, attributed to a file, with pinned
evidence and a retry key. Invalid lines are listed with reasons. A person's answer always wins;
reversals block replay. Every move path refuses money in the person's name or a high ladder rung.
