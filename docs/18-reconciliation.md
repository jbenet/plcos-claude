# 18 — Reconciliation: the current state of affairs, from the records on file

**Status:** built in N57, 24 Sep 2026, from Juan's issue 0002 and his note on staleness (23 Sep). Corrected in N59, the same night: only records about the raise count.

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

| Layer | What it is | Drawn as (since N60 and N61) |
|---|---|---|
| **Accepted** | Rungs recorded on the ladder, each with its evidence, through a STAGE ticket | Green, with a check, under its status on the stepper; on the timeline, folded into the row that is its record, with who confirmed it and when |
| **On file** | Rungs that records in this system support, not accepted yet | Grey under its status; on the timeline, "the record for … — not confirmed yet", with the link to its proposal |
| **Claimed** | What Affinity's word would be evidence for, if it were evidence | Named in amber: "Affinity says …: a claim" |

N57 drew the on-file layer as dashed rings; Juan found them hard to read (issue 0004), and N60
replaced them.

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

## What counts: only what is about this raise (N59)

The first run proposed 278 climbs, and Juan corrected it the same night: an LP shown as met had
never met anyone about the fund, since the meetings on record were about other things; an LP
shown as opted in had an email from 2021. Affinity's mail and calendar sync brings in everything
the team has exchanged with a person, and all of it was being counted.

So a record now counts for a vehicle only when it is about that vehicle's raise:

- **Each vehicle has a raise window**, open-ended while it raises. The dates come from the init
  file, with a GUESS note where they are guessed. A vehicle with no window counts only records
  that name it.
- **Each record is read once, at translation, for what it is about**, from what it says: an
  email's subject and addresses, a meeting's title and who was invited, a note's text
  (`lib/connectors/affinity/about.ts`). In order:
  1. An automatic reply is about nothing, and it is not a reply.
  2. A record that names a vehicle, by name or alias, is about that vehicle.
  3. A company's update to its investors is about something else.
  4. A record that speaks of a fund, investing, the data room, the deck and so on, or names the
     firm, is about any raise open on its date (until N81, below: now about a raise, vehicle
     unclear, counted for none until tagged).
  5. A record from or to the team's fundraising domain is the same. That means the sender or a
     direct recipient; someone on copy doesn't count. (The first pass counted an email about
     something else because someone at the domain was copied.) Since N81, an email's only.
  6. Anything else is about something else.
- **Nothing is dropped.** Contact about something else stays, counted on the LP's own page as
  contact history (`components/entity/ContactHistory.tsx`), and the LP-for-vehicle page points
  to it. Juan: "email unrelated to the fundraise may still be useful for intelligence
  gathering".
- **Every decision keeps its reason** (`meetings.meeting.about_basis`), and every proposal
  quotes it. A wrong rule can be traced to every record it touched, and a corrected rule
  re-reads all of them on the next translation.

After the correction, the same run proposed 62. Reconciliation withdrew each of its own open
proposals whose records now read differently, and proposed again where a climb still held. An
approval is of exactly the words shown, so a reworded rule makes a new proposal rather than
approving old words.

## Which vehicle: tagged, not assumed (N81)

Juan, 24 Sep, on the real account: "some meetings or notes from affinity are getting attributed to
PLC Neurotech when they may be for PLC Rails, or they may just be general catchups." Two rules
above did it. Rule 5 read a meeting's invitees as well as an email's addresses, and everyone on the
team is at the fundraising domain, so a catch-up with a colleague on the invite read as about the
raise: 124 meetings and calls of the 670 raise records in 2026. And rule 4's "any raise open on its
date" put every record that named no vehicle on every vehicle raising then — Neurotech and Rails
both, since both windows open on 1 January.

So, since N81:

- **Rule 5 reads an email's addresses only.** A meeting is read by its title and the note on it; a
  note by its words, never its author.
- **A record counts for a vehicle only when it is tagged with it**, inside the window: it names it
  (the rules), or Claude tagged it after reading it (W12 in docs/19, loaded from
  `event-tags.jsonc` at translation), or a person tagged it on the LP's timeline. A person's tag
  counts whatever the date, and stands over the others. A record about a raise that names no vehicle
  is "vehicle unclear" and counts for none until someone says which.
- **Tags live in `meetings.event_tag`**, one per Affinity interaction or note, so every LP on a
  meeting shares it, and a note on a meeting takes the meeting's. `meeting.about_by` says where each
  touchpoint's reading came from.
- **The LP's timeline shows everything** — every record with them, about anything — each labelled
  with its vehicles, "Vehicle unclear" or "General", with a filter by fund. The facts above it are
  this pursuit's: only what counts for its vehicle.

Accepted rungs stand: a person approved them on the records shown then. Open proposals whose records
no longer count for their vehicle are withdrawn by the next reconciliation, as in N59.

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

## On the real account

First run (N57): 278 proposals from 2,143 pursuits, 154 to Meeting held and 124 to LP opted in.
Most of them rested on contact that wasn't about the raise. After N59's windows and reading:
62, of which 53 climb to Meeting held and 9 to LP opted in.
