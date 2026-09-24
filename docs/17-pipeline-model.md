# 17 — One LP, four records: status, touchpoints, the close track, and their read

**Status:** proposed 23 Sep 2026 (N50–N52), from Juan's sketch the same night. It replaces the
twelve stages of N46, which put what happened (a first meeting, a second) into the status,
and so never fit a process that doesn't run in a line.

Juan's question was whether this is overkill. It isn't: it's less than what it replaces. The
twelve stages tried to say in one field what the log, the close room and the ladder each say
better. Separating them is what lets a messy process be recorded as it happened.

---

## The four records

For each LP and each vehicle — a *pursuit* in the code, a row on the pipeline in the product:

| Record | The question it answers | Who sets it | Moves |
|---|---|---|---|
| **Status** | Where is our effort with them? | A person (or Affinity's word, until a person sets it) | Any direction, any time |
| **Touchpoints** | What has happened with them? | Logged here, or read from Affinity's notes and calendar | Append-only, dated |
| **Close track** | How far has the money got? | The close room and Soft → Hard | Events, each with its evidence |
| **Their read** | How keen are they? | Whoever was in the room, on that touchpoint | Dated, one per touchpoint |

The **consent ladder** stays. It's the evidence view: each rung is a specific record — a
reply, a meeting, a number from them, a countersignature, a wire. Nobody maintains it by hand
any more than before, and a status never moves it (rule 2).

## 1. Status: seven values (six until N60)

| Status | Means |
|---|---|
| **New** | On the list. Nobody has researched them or reached out. |
| **Sourcing** | Picked to research, enrich, or find a way in. Research can happen at any status; this one says it's the work right now. |
| **Selected** | We've decided to approach. Outreach is next. |
| **Connecting** | Reaching them (N60): finding a connector, asking for an intro, writing to them, waiting on a first reply. |
| **Discussing** | They've engaged: a reply, a call being set, any number of meetings. |
| **Committed** | They said yes, with an amount. How far the money has got is the close track's job, not this one's. |
| **Passed** | Off, for now: someone decided. **Who** (they declined · we stopped) and **why** are kept, and it can reopen. |

- **No "paused".** "Come back after the new year" is Discussing with a dated **next step**. A
  status that means "not now" hides the date that makes it true or false.
- **Silence is not a pass** (N53, Juan, 23 Sep). An LP who never replied is still Selected; the
  log says "waiting on them" and since when, and the pipeline filters on it. Passed is for a
  decision, theirs or ours. The team's "On Hold" was its do-not-contact, so it reads as Passed:
  we stopped, do not contact — as does every entry marked do-not-contact.
- **No enforced order.** Committed can go back to Discussing when they cut back; Passed can
  reopen. Each change is in the audit log, so the history is there.
- **Do not contact** is not a status. It's a restriction on the person, across every vehicle,
  and every route checks it (rule 8).
- **Not ticket-gated.** A status is our plan and claims nothing about the LP. The ladder is
  where claims are made, and it keeps its STAGE tickets.
- **"Target" is retired as a word for an LP.** The whole set is the *pipeline*, each row an
  *LP*, and "target" means only the fund's size goal. The ladder's second rung reads
  "LP opted in".
- **The status leads everywhere an LP's standing is shown** (N62, issue 0008: "look through
  whole system to make sure new ladder is properly setup everywhere"): the vehicle overview
  counts by status, with how many the ladder backs beside the three it can (Connecting,
  Discussing, Committed); Today's "Waiting on a first reply" is Connecting with nothing from
  them yet; the LP's own page, the group tables, All vehicles, the decision room and the
  strategy page show the status first and "… on the ladder" under it. The ladder still leads
  where the page is about evidence: the meeting prep ("the rung a reply justifies"), content
  attribution, and the approvals. The visualizations lay out by status too: the line's
  stations, the room's bars, the grid's rows, the filter and the list, with the ladder under
  the status in the console and "◇ Needs evidence" where the status claims more than the
  ladder shows (`statusNeedsEvidence`, one rule for the LP page, the overview and the
  visualizations). The flow and the plant stay on the ladder, labelled as the ladder, because
  they count dated steps that only go one way. An exposure with no pursuit reads as
  Committed, and a passed LP is no one's load and no move's target.

## 2. Touchpoints: the dated log

Meetings, calls, emails, intros, events — each with a date, which vehicle it was about (or
none), who from our side, who reached out, a line of what happened, and where the record came
from. From these, derived rather than set: how many meetings, the first and the second, the
last touch, and "waiting on their reply since…".

- **From Affinity, without asking anyone to re-type it:** meeting, call and email notes carry
  the interaction and a date (N49), and every list entry carries Affinity's first and last
  email and meeting dates. A meeting that covered two vehicles counts for both; one tied to no
  vehicle counts for every open pursuit of that LP, labelled as such.
- **Their firm's touchpoints are shown, not counted** (N53). A meeting with a colleague at the
  same firm is not a meeting with this LP; counting it as one invented next meetings that were
  someone else's. The firm's rows appear in the log with its name, summed on one line.
- **Research is a touchpoint too**, of its own kind: what was looked at, and the date range
  (rule 7). "Last researched" is derived, at any status.
- What Affinity's status word implies but can't date ("Two meetings held") is kept as a claim
  beside the log: "2 meetings on record · Affinity says 2 or more".

**Only what is about this raise (N59, docs/18).** A touchpoint from Affinity counts for a
vehicle only when it falls inside the vehicle's raise window and was read as about a raise:
naming the vehicle, speaking of a fund or investing, or from or to the fundraising domain. The
rest is kept as contact history on the LP's own page, and the LP-for-vehicle page says how much
there is.

**One timeline (N56).** On an LP's page, the touchpoints and the team's notes in Affinity are one
thread, newest first, each row with an icon for what happened and the same thing in words: a
meeting (or one still ahead), a call, an email from them or from us, a deck view, questions
asked, a number given, and so on. A note Affinity ties to a meeting, call or email opens inside
that row instead of standing on its own. Notes are still a record of what was said, not evidence
for the ladder; the counts above the thread come only from touchpoints.

## 3. The close track: events, not a state

Most of this already exists: soft and hard exposures (L6), the close room's pack with its
returned and countersigned dates (L8), and the SPV room's wires. What was missing is added:

- **Signatures as events.** They signed on a date; they re-signed on another, with the reason
  (the entity changed, the documents were amended). The latest one counts.
- **Countersignature** stays the only thing that makes money hard, through the MONEY ticket
  (rule 1). It now also writes the event, in the same transaction.
- **Closing.** Admitted at a closing — the first close, or the SPV's.
- **Wires as amounts, many per LP.** A fund's commitment is called in parts. Each wire is a
  dated amount, reconciled against what was called: "wired $1.2M of $1.5M called".

The state is derived from the events: **soft → signed → hard → closed**, with wires beside it.
From Affinity, a word like "Signed" becomes a *signed* event with no date, marked as Affinity's
claim; it's still soft until countersigned here.

## 4. Their read: recorded, never computed

**Very interested · interested · not very interested**, recorded on a touchpoint by whoever
was there, dated and attributed. The pipeline shows the latest read with its date, so a
stale one looks stale. It's not a separate field somebody maintains, and it's never computed:
the tool shows the facts beside it (reply time, meetings, documents asked for), and an agent
may *suggest* a read from notes, labelled as a suggestion until a person confirms it.
A numeric interest score would be a confidence rendered as fact, which this tool doesn't do.

**What happened since (N57, docs/18).** A read is superseded when a later record points the other
way — a commitment after "not very interested", a decline after "interested" — and old past
`config.reads.staleAfterDays` (a GUESS). A superseded read stays, dated and struck through, with
what superseded it; it no longer counts as their read.

**Suggestions from the notes (N55).** Each note can have a reading: a one-sentence summary,
the read if the note gives one, and the few words the read rests on. Readings are written to
`data/<profile>/readings.jsonc` by whoever read the notes (the first set by Claude, in a working
session) and the next translation loads them into `meetings.note_reading`. On the pages:

- A suggestion shows only when it is newer than every read a person recorded; it is marked
  "suggested", dated by its note, and counts for nothing a person hasn't confirmed.
- **Confirm** makes it the person's read, attributed to them and to the note. **Not right**
  dismisses it, and the next newest suggestion, if any, shows instead. A later file never
  re-suggests a read a person has decided; it can still replace a summary.
- A note that mentions a person's or a family's health is read only with that detail redacted,
  and the summary says so in brackets — "[health detail redacted]" (N56; Juan, 23 Sep: "feel free
  to redact any info going into the system for privacy. (if so, make it clear in the redacted
  text.)"). The importer refuses any other line for such a note, and one whose own words still
  carry the detail (Report 4 §6.2). The note's text stays closed until someone opens it.
- A touchpoint that Affinity ties to a note shows the summary, with the note itself one click
  away; a note with no reading shows its first sentence instead, unless it mentions health.
- Each reading may say what happened, in one word from a fixed list — questions asked,
  materials, a deck view, a number given, signed, declined, an intro, a portfolio update,
  background, added to a list, meeting notes — which is the icon on the LP's timeline (N56).

## 5. Updates, and the state on the timeline (N61)

Juan, 24 Sep 2026 (issue 0004): "add a row at start with a text field to add an update. we should
LLM process the output to decide on what to do with the update (ie change status, etc). updates
from here should get their own icon too." And (issue 0006): "ladder history should be in timeline
(the events should imply the status changed)".

**An update** is a person's words about an LP, written in the first row of the timeline, with
its own icon. It is ours, not contact with them, so it is not a touchpoint and never counts as a
touch (`strategy.pursuit_update`, strategy 005). As it is typed, the words are read
(`modules/strategy/reader.ts`) and what they suggest fills the form:

| Suggestion | From words like | Goes through |
|---|---|---|
| A status, forward only (Passed from anywhere; anything from Passed) | "met", "they replied", "reached out", "they're in", "they passed — timing" | `setStatus`, the update's first line as the reason |
| The touchpoint it describes, dated | "met them Tuesday", "emailed them this morning", "call set for Monday" | `logTouchpoint`, on this vehicle |
| Their read, only beside a touchpoint that happened | "very keen", "lukewarm" | the touchpoint's read |
| A next step | "they want the deck", "next: …", "follow up in two weeks" | the pursuit's next step |
| An amount — shown, never recorded | "$2M", "5 million" | nothing: it points to the close track (rule 1) |

Each suggestion shows the words it rests on, a field set by hand stops following the words,
and "Saving will…" says in one line everything Save will do. Save writes the update and each
ticked change in one transaction, once per form (an idempotency key), with the update's id in
each audit row. What the reader suggested is read again on the server and kept with the update,
pinned to the reader's version, beside what was applied and what was left unticked — so a wrong
rule can be traced to the updates it touched.

**Word rules, not a model, for now.** The Agent seam refuses until the agent runtime lands (L13):
a run needs its envelope checked, its config pinned and its prompt tried against example cases,
and none of that is built. A model's reading would replace the rules behind the same form; it
would also send the update's words to the model's provider, which is a decision for Juan, not a
default.

**It never writes a rung.** A meeting the update logs is a record, so reconciliation reads the LP
again at once (`reconcilePursuit`) and, if the ladder is behind, proposes the climb as a STAGE
ticket for a person to approve (docs/18).

**The timeline shows the state changing.** Newest first, beside the touchpoints and notes:

- an update, with what it changed folded in: *Status: Selected → Discussing*, the meeting it
  logged, the next step. The meeting's own row says it was logged from the update;
- a status set without an update, from the audit log: old, new, who, and the reason;
- each rung on the ladder, folded into the row that is its record — *On the ladder: LP opted in,
  Meeting held — confirmed 24 Sep by Juan* — or, when its record is not on the timeline (a
  signature, a wire, a connector's yes), a row of its own;
- a record the ladder hasn't accepted: *The record for Meeting held — not confirmed yet*, with
  the link to confirm it.

The LP page's separate "Ladder history" card is gone; the stepper and the timeline carry it.

---

## What Affinity's words become

The mapping (`data/<profile>/mapping.jsonc`, docs/16 §3) now gives each status word a
**status**, a reason and who passed where it ended, and what the word **implies** happened:
reached out, replied, meeting agreed, met, met twice, diligence, documents sent, soft, signed,
wired. The implied facts are claims: shown beside the log and the ladder, never written into
either. Translation also applies one rule: an entry with a committed amount is Committed,
unless it passed.

A status set here is never overwritten by the next translation. When Affinity's word changes
after that, the LP page says so: "Affinity now says *Soft circle*; set to Discussing here on
23 Sep".

## What was deliberately not built

- An interest score, a stage-transition graph, or a ticket for changing a status.
- Undated touchpoints invented from a status word.
- A write back to Affinity. If the team adopts these six values, Affinity's status field could
  be changed to match — a later decision, through approval tickets (docs/15).
