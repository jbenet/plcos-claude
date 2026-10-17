## Perf and red-team loop, 17 Oct 2026

A loop on the server and the Mac app, run until Juan says stop. Page design and copy are unchanged.
Server measurements are on the invented perf4 fixture (`npm run perf4:seed`) copied into local Postgres 16,
from a production build, in a fresh browser context per page; the Mac app's are on a scratch copy of the real
data on Juan's Mac.

### Faster

- **Strategy loads half the script.** Its "commit to this" box drew the rich editor on every view, so every
  Strategy page fetched tiptap and the Markdown parser: 1,123 KB of script against 540–580 KB elsewhere. The box
  is now a plain text box until someone clicks into it; pointing at it starts the fetch, the editor swaps in with
  the cursor at the end, and what was typed before it arrived is kept. Strategy: 1,123 → 581 KB.

### Red team

- **Score detail and the desktop app's sign-in check for people limited to some vehicles.** `/selection/detail` and
  `/api/desktop/info` asked for all-vehicle read access, so a team member limited to some vehicles was refused on
  their own vehicles: their score detail never opened and the Mac app paired but could not say who they were. A
  route can now name the vehicle it reads (`withRoute`'s third argument); score detail names the vehicle it was
  asked about, the desktop check the person's own vehicles. It still fails closed, and the handlers keep their own
  checks.
- **The Mac app's launch link only goes to its own pages.** `/__desktop/enter` checked that `to` started with one
  slash, which let `/\host` through (browsers read it as `//host`). It now parses the address and keeps it only on
  the app's own origin. Not reachable before either: the link needs the launch key.

- **A Viewer's mail-desk token writes nothing.** `outreach_add_research` had no permission check, and `comms_ingest`
  (which runs Reconciliation) checked one only when a message named its LP. Both now ask what the desk's other
  writes ask: that the token's owner may change records on their vehicles.
- **An amount is a person's to record, on `/update` too.** `outreach_add_lp` refuses an indicated amount from a
  call no person clicked and says "a person adds it with outreach_update"; `outreach_update` took one from the same
  autonomous call. It now refuses it the same way. Status, touchpoints and next steps from the desk are unchanged.
- **Affinity writes: what was approved is what is written.** Proposing an address again replaced the mail and
  plan of an item already in the batch under the same id, so an Admin with Approvals open could approve mail they
  never saw, and the note named the first proposer for another person's mail. A changed item now gets a new id
  (it waits in the next batch, as an item proposed after the page was drawn does) and names its latest proposer.
- **Affinity writes: no second note after a lost answer.** A write that failed without an answer from Affinity
  (a timeout, or a failure after Affinity said yes) was proposed again like any failure, which could write the same
  note twice. Its mail now counts as possibly written: the item is skipped, saying to check Affinity. A write
  Affinity refused is proposed again as before.

- **A pasted calendar cannot stall the server.** Each repeating event's expansion was capped, but not the file: a
  calendar of thousands of daily repeats from year 1 walked billions of steps on every Calendar view, in the one
  server process. A daily or weekly repeat now starts at the window, and the whole file has one budget; past it a
  repeat keeps its first date, as a rule we can't expand does. 3,000 such repeats: 306 ms.
- **Pictures from other sites don't load in issues or commitments.** An image in feedback or a commitment loaded from
  any address, which told that host who opened the page and when. Only the issue's own attachments and this site's
  own pictures show; anything else shows as not attached.

- **The Mac's real-data server answers only its own names.** With no sign-in (the local switcher), a page on another
  site could point its own name at the Mac (DNS rebinding), set a user cookie and act as anyone, since its Origin
  and Host matched. A server on the real data, or a copy of it, now answers only an IP, a name with no dot or a
  `.local` name; anything else gets 421. The demo is unchanged; Railway signs people in and is unaffected.

### Left as is

- `/api/health?affinity=1` stays public: threads read the Affinity budget with it and it holds counts only.
- The Mac app's local copy stays on disk when its owner stops being an Admin (it stops serving at once). Deleting
  it automatically is Juan's call.
- A message ingested through a token limited to some vehicles still lets Reconciliation look at that LP on every
  vehicle: the mail is a fact about the LP, and Reconciliation is the system, not the token.
- A LabOS member not on the roster joins as a Viewer on first visit (`resolveLabosUser`), where the rev 2 design said
  403. The property suite asserts the current behaviour, so it reads as a later decision; LabOS sign-in is off today.
- Off Railway, the setup code's per-address limit trusts one proxy hop. The code is 48 bits, so guessing stays
  impractical.
