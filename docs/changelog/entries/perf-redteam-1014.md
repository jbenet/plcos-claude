# Smaller calendar, faster pipeline after an edit, safer Affinity writes · 14 Oct 2026

Juan, 14 Oct 2026: "Run an auto-research style loop to improve performance, and find bugs/errors." Figures are from a
production build on an invented fixture: 6,500 pursuits (5,000 on one vehicle) and 140,000 touchpoints, on local
Postgres 16.

## Performance

| What | Before | After |
|---|---|---|
| /all/calendar | 11.6 MB | 6.9 MB |
| /neurotech/calendar | — | 5.6 MB |
| /neurotech/pipeline | 2.75 MB | 2.36 MB |
| Every vehicle's list, rebuilt after a status move | ~1.9 s | ~1.4 s |

- **Packed lists send less** (`lib/packed-rows.ts`):
  - A column equal to an earlier one is sent as that column's name, for example an organisation's `entityId` and
    `orgId`, or its `org` and `name`.
  - Unique text with a few shapes is split at its last `=`, `:` or `/`. The heads are shared and the tails are sent as
    they are. A tail that is the same as an earlier text column's tail is sent as `0`. For example, a calendar row's
    link `/meetings?e=<LP>&m=<meeting>` ends in its own id's meeting, and the links went from 5.1 MB to 0.8 MB.
- **The list rebuild after a status move:**
  - Each LP's touchpoint summary is made in one pass instead of a dozen filters.
  - "On file" finds the first meeting, reply and event without sorting every touchpoint.
  - Status conversion is worked out once per status, not once per LP across every move.
  - Formatted dates reuse the parts of an instant they have already seen.
  - The status-move history walks a merge chain only for a merged pursuit: 133 ms → 51 ms at 4,000 moves.

## Red-team fixes: Affinity writes by batch (PR #138)

A review of the newest merges found these, and each one now has a property:

- **A second person for one address.** Our copy of Affinity syncs daily, so a person PLC OS created the day before
  looked missing, and the next batch created them again. Proposing and writing now both use a person we already
  created for the address.
- **Mail sent later on the day of a write was skipped.** "Already written" compared days. Each message is now checked
  against the mail already noted, and only new mail goes into the note.
- **A stale Affinity record could match.** The address lookup read every saved version of a person. It now reads only
  each person's newest version, as the parties check does.
- **Items proposed while the page was open were rejected unseen.** The form now sends the items it showed. Any others
  move to the next batch, undecided.
- **A proposal racing a decision could land in a decided batch,** where nothing would show or write it. Items are now
  inserted with the batch held open. If the batch was decided meanwhile, the proposal is planned again against the
  new batch.
- A malformed batch id is refused with a message, instead of a server error.

Left as they are:

- When two people propose the same address, the note names the first. Only JuanMail proposes today, for one sender.
- An item a restart interrupts mid-write stays "approved". The person it created is still recorded, so a retry adds
  the note and does not create the person again.

Checks: tsc; packed-rows and affinity-writes properties on Postgres. The three new Affinity properties fail on the
old code. Summaries matched the old code on 20,000 random LPs.
