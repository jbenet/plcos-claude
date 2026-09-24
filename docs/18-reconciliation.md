# 18 — Reconciliation: the current state of affairs, from the records on file

**Status:** built in N57, 24 Sep 2026, from Juan's issue 0002 and his note on staleness (23 Sep).

> meetings already happened, but the state didnt move fwd. this will be messy and things wont
> move cleanly, we'll need to tolerate getting "the current state of affairs" from the available
> data we have. we may need to build in some reconciliation
>
> on staleness — please figure out how to resolve. you're organizing the data ingest and states.

## The problem

An LP's records don't move in step. The calendar shows three meetings, Affinity says "Due
Diligence" and $5M soft, and the ladder says "Nothing on file". Every rung waited for someone to
open a STAGE ticket, one rung at a time, three tickets to get to Meeting held, so almost nothing
climbed. Reads went stale the same way: "not very interested" in an email from a year ago still
showed beside an LP who has since committed.

Nothing was wrong with the rules (rule 2: each step needs a specific evidence record; rule 3:
tickets gate the ladder). What was missing was a pass that puts the records side by side and
proposes what they add up to.

## Three layers, always shown together

For every pursuit, on the LP's page and in the pipeline's ladder column:

| Layer | What it is | Drawn as |
|---|---|---|
| **Accepted** | Rungs recorded on the ladder, each with its evidence, through a STAGE ticket | Solid |
| **On file** | Rungs that records in this system support, not accepted yet | A dashed ring, with the record and its proposal |
| **Claimed** | What Affinity's word would be evidence for, if it were evidence | Named in amber: "Affinity says …: a claim" |

## What counts as a record

Only records, never claims. An Affinity field, Affinity's own "signed" or "wired", a status and
the team's notes are all claims. They are shown, and never used.

| Rung | The record that supports it |
|---|---|
| Connector willing | Not applicable once they are in direct contact with us (a reply, or a meeting) |
| LP opted in | Their first reply (an email whose sender is not on the team), or the first meeting they came to |
| Meeting held | The first meeting or call that happened, from the calendar or logged here |
| Indication given | A soft amount, or documents they signed, recorded here by a person |
| Commitment accepted | A countersignature, recorded through a MONEY ticket |
| Cash received | A wire recorded here |

A rung is on file only above an unbroken run: a signature with no meeting on record waits for
the meeting rung, and the stepper says so.

## What reconciliation does

After each translation (`translateAction`), `lib/reconcile.ts`:

1. Computes the on-file layer for every pursuit that isn't passed and isn't on a vehicle kept
   for its history.
2. Where records are ahead of the ladder, **opens one STAGE ticket per pursuit**, requested by
   the system's own actor, "Reconciliation" (platform migration 003, inactive, so nobody can act
   as it). Its scope lists every rung it would record and the record behind each. That is a
   specific bounded action, not a bundle.
3. Skips a pursuit that already has a STAGE ticket open. Skips a climb a person rejected, on
   the same records: a meeting held since the rejection is a new record, and it asks again.
   Withdraws its own proposal if that expired undecided, and asks again; withdrawing approves
   nothing.
4. Records its own run, with counts, beside the translation's.

Approving one, or many at once on Approvals, runs `strategy.recordClimb`. That re-checks,
inside the transaction, that the ladder hasn't moved since the proposal and that the rungs are
the next ones in order. Then it records each rung on its record, attributed to the approver. It
never skips, never writes a status, never touches money.

**Why one ticket per LP, not per rung.** Rule 3 allows one open ticket per subject per kind, so
per-rung tickets had to be approved one after another: three for a meeting, and hundreds of LPs.
A climb listing each rung and its record is the same approval, stated completely, in one
decision.

## Stale reads

A read is a dated observation. Two rules settle what it means now:

- **Superseded.** A later record points the other way: a commitment or signature after "not
  very interested", or a decline or withdrawal after "interested". The status counts when it
  says Committed or that they declined. It is dated by when a person set it, or by when
  Affinity was last read. A superseded read stays on the timeline, struck through, with what
  superseded it. It stops counting as their read in the pipeline and its filter. Meetings and
  Discussing don't supersede anything: an LP can meet us and still be lukewarm.
- **Old.** Past `config.reads.staleAfterDays` (a GUESS, 180 days), a read is labelled old. It
  still counts, with its date.

Nothing computes a new read. The read stays as recorded; only what happened since is laid
beside it.

## Status behind the log

When an LP has met us and is still at New, Sourcing or Selected, the pipeline's "Met, status
behind" filter now offers to move them to Discussing in one step. It is still a person's
decision per LP, each in the audit log, and each keeps its next step. No ticket is needed,
because a status claims nothing.

## What it never does

Write a rung without an approval, set a status by itself, change a read, count an Affinity
field or a note as evidence, or approve its own proposal. Proposals are data for a person.

## On the real account, first run

278 proposals from 2,143 pursuits: 154 climb to Meeting held and 124 to LP opted in, on a reply
from them. 1,694 were already in step, and 171 were passed or on a vehicle kept for its history.
