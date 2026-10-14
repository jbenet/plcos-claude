# Smaller calendar, faster pipeline after an edit, safer Affinity writes · 14 Oct 2026

Juan, 14 Oct 2026: "Run an auto-research style loop to improve performance, and find bugs/errors." Figures are from a
production build on an invented fixture: 6,500 pursuits (5,000 on one vehicle) and 140,000 touchpoints, on local
Postgres 16.

## Performance

| What | Before | After |
|---|---|---|
| /all/calendar | 11.6 MB | 5.5 MB |
| /neurotech/calendar | 5.6 MB (after the first change below) | 4.5 MB |
| /neurotech/pipeline | 2.75 MB | 2.19 MB |
| /performance (content performance) | 5.7 MB | 0.2 MB |
| /neurotech/visualizations | 1.82 MB | 1.25 MB |
| Every vehicle's list, rebuilt after a status move | ~1.9 s | ~1.4 s |
| JuanMail's queue read (a page of 50, cached list) | ~1.2 s | ~0.46 s, same answer |

- **Packed lists send less** (`lib/packed-rows.ts`):
  - A column equal to an earlier one is sent as that column's name, for example an organisation's `entityId` and
    `orgId`, or its `org` and `name`.
  - Unique text with a few shapes is split at its last `=`, `:` or `/`. The heads are shared and the tails are sent as
    they are. A tail that is the same as an earlier text column's tail is sent as `0`. For example, a calendar row's
    link `/meetings?e=<LP>&m=<meeting>` ends in its own id's meeting, and the links went from 5.1 MB to 0.8 MB.
  - A shared column with 36 distinct values or fewer (a lane, a standing, a vehicle) sends one character per row.
  - A column of dates is sent as numbers. A column that is an earlier one with the same text around it on every row
    (an LP's key, `<entityId>:neurotech`) is sent as that column's name and the text around it. The visualizations'
    rows read back equal to the rows sent, on every vehicle.
- **Packing a list** keys text without JSON: the calendar's 56,000 rows pack in about 310 ms instead of 490 ms, to the
  same bytes.
- **The calendar's week grid** was sent as plain rows (1.1 MB); it is packed like the list. It reads each row's dates
  once instead of once per lane and week on every click, and the numbers above the list are counted in one pass. Both
  render the same markup as before on 300 random calendars.
- **The list rebuild after a status move:**
  - Each LP's touchpoint summary is made in one pass instead of a dozen filters, comparing instants as numbers: 6,000
    LPs take about 25 ms instead of 100–130 ms. The overview reads the same summaries.
  - "On file" finds the first meeting, reply and event without sorting every touchpoint.
  - Status conversion is worked out once per status, not once per LP across every move.
  - Formatted dates reuse the parts of an instant they have already seen.
  - The status-move history walks a merge chain only for a merged pursuit: 133 ms → 51 ms at 4,000 moves.
- **The outreach queue** reads each vehicle's touchpoints from the list's own cache (`touchesOn`). It used to read every
  LP's touchpoints again on each poll. On the fixture, the old and new answers were byte-for-byte the same across four
  pages of every vehicle.
- **Content performance** lists the LPs with a rung on file, the latest 200, and counts the rest. It listed every
  pursuit, most with nothing on file.
- **The strategy page's "This week"** lists the latest 100 status changes, and says how many there were. A reconcile
  pass can move thousands of LPs in a week; 2,800 moves were 1.1 MB of the page.

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

## Red-team fixes: calendar feeds, status moves from mail, undo

- **One calendar entry could stop the server.** A repeat with a huge interval (`RRULE:FREQ=YEARLY;INTERVAL=300000`)
  ran past the last date JavaScript can hold. After that every comparison was false and the loop never ended. It now
  stops there, and after 200,000 steps in any case.
- **A calendar that stopped mid-download failed the whole Calendar page.** Reading the body is now that calendar's
  error, so the page falls back to the last good copy. The body is also read only up to 5 MB.
- **Reconciliation could overwrite a person's status.** It read every status at the start of a pass and set the new
  ones much later. A person who marked an LP Passed or Committed, or undid a move, in between lost that change. Each
  move now re-reads the status under a lock and gives way if it changed.
- **Undoing a research request removed an address a later add relied on.** For example: a research request, then a
  pitch to the same person the same day, then the research undone. The new LP lost its address. Both undos now keep a
  claim that a later add or confirmed contact relies on.

- **The emailed-parties check suggested a portfolio founder as an LP** for their own company's SPV, when the mail named
  the company. A person whose every current firm is a portfolio company, or an unknown address at such a firm's domain,
  is now never suggested, as on the calendar's candidates. Adding them by hand is still allowed.
- **The emailed-parties check ordered sends by their text.** A Date header carries the sender's offset, so the last
  send could be the wrong day, and a later mail looked covered by Affinity. Sends are now ordered by instant.
- **The same check read Affinity's last email from the wrong person** when the address matched a duplicate. It now reads
  both the matched person and the one Affinity's record links to, and takes the later email.


## Red-team fixes: send tickets

- **A do-not-contact recorded after an approval did not stop the agent.** When the daily Affinity translation records
  one, that LP's open SEND and INTRO_ASK tickets now end at once.
- **A person's link could spend an agent's ticket.** Linking their own sent mail picked any approved ticket for those
  recipients. It then refused the person's earlier mail as "sent before the approval", or used up the agent's
  approval. A person's link now uses a ticket only when they name one.
- **An agent could skip the ticket by linking our own mail as received.** An autonomous link of a message from a team
  address as received is refused.
- **A material withdrawn after its ticket was approved could still be recorded as sent.** Recording a send checks that
  the material is still approved.

Left as they are:

- An INTRO_ASK ticket's email is not checked against the connector's addresses: the ask stores none yet. That needs a
  migration.
- An idempotency key is not tied to its payload or its token, so reusing a key with a different body returns the first
  answer. Only JuanMail calls, with one token per person. That also needs a migration.
- If one daily step fails, the rest of that day's chain is skipped, and nothing retries until the next day. The
  property suite asserts this on purpose, and a retry would spend the Affinity call budget again.
- A token for one vehicle can ask the emailed-parties check about any address, and learn whether PLC OS or Affinity
  holds it and Affinity's last email date. Only JuanMail calls it today, with Juan's own token.
- When two people propose the same address, the note names the first. Only JuanMail proposes today, for one sender.
- When `comms_ingest` matches a message, it reconciles that person's LPs on every vehicle, not only the token's.
  Reconciliation reads only records on file and would make the same moves on its next full pass.
- If the server restarts mid-call, that call's idempotency key answers "still being handled" from then on.
- An item a restart interrupts mid-write stays "approved". The person it created is still recorded, so a retry adds
  the note and does not create the person again.

Checks: tsc; packed-rows and affinity-writes properties on Postgres. The three new Affinity properties fail on the
old code. Summaries matched the old code on 20,000 random LPs.
