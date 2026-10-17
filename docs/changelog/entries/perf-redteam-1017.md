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
- **Visualizations send a quarter of the data.** The network, coverage and radar lenses went to the browser as
  lists of objects, every row repeating its field names. They are packed into columns now (`lib/lenses-client.ts`),
  as the pipeline already was. On the real data: coverage 6.1 → 1.5 MB, radar 2.8 → 1.4 MB, network 2.5 → 1.6 MB.
- **The all-vehicles pipeline rebuilds sooner after a write.** It is now built from each vehicle's own list, and
  each vehicle's plans and touches start as soon as that list arrives, rather than after every list. On the real
  data: 495 → 430 ms. The strategic filter reads each profile's kept text once, not the whole profile.
- **LP profiles are read once per version.** Every rebuild after a write read each public profile whole (about
  8 MB) for the plans and the strategic marks. A 12 ms read of note keys and row versions now says which changed, and
  only those are read (`modules/strategy/profile-parts.ts`). On the real data, the same 3,255 profiles with no
  differences; all/pipeline after a write 430 → 390 ms.

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
- ~~**An amount is a person's to record, on `/update` too.**~~ Reversed the same day: see "Juan's calls" below.
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

- **A Mac push changes only the vehicles its owner may change.** A strategy file naming a vehicle by its display
  name or in another case skipped the check, which looked for the exact slug, and then imported onto that vehicle;
  and replacing or retiring a strategy file never asked about the vehicle of the file already there. Both now
  name the vehicle the way the import does, and both vehicles are checked.
- **Only an Admin's push merges two named records.** An identity merge that names its records instead of a review
  group can join any two people on every vehicle, and an Admin applies the file whole. A Team member's push of one
  is refused, saying an Admin pushes it; their merges of a review group, separations and retypes are unchanged.
- **A push is read whole before it waits for another, and never past the limit.** The size was checked only against
  the declared length, so a body sent without one was read entire; and a slow upload held the one-at-a-time flag,
  so every other push was told to wait until it ended. The body is now read up to the limit and refused past it,
  and only then does the push take its turn.
- **A status the mail desk sets on its own is the system's.** `outreach_update` recorded it as the person's own
  choice; it is now marked as `outreach_add_lp` marks one (rule), so a person's later choice wins.
- **An intro ask's ticket covers mail to its connector.** A message linked under an INTRO_ASK ticket was accepted
  whoever it went to, the LP included. At least one recipient must now be the connector, by an address on record.
  And no ticket is spent on a sent message that names no recipients: it said nothing of who got the mail.
- ~~**The mail desk can't confirm an address on its own.**~~ Reversed the same day: see "Juan's calls" below.

### Juan's calls, 17 Oct 2026

- **JuanMail does more on its own.** Juan: "we should remove the rules that only people can change settings. It's
  just getting in the way, I want a lot of automated actions, specially from JuanMail". A call no person clicked may
  now record an indicated amount (`outreach_add_lp`, `outreach_update`), confirm an address as the token's owner and
  make it where an LP's mail goes (`outreach_propose_contact`). Each is marked as the mail desk's: an update's words
  start "By the mail desk on its own" (or "From mail, by the mail desk on its own"), and a status it sets is the
  system's (rule), so a person's later choice still wins. Send tickets for autonomous sends are unchanged.
- **Mailguard keys are tied to their address** ("Tie keys"). A key pasted in Preferences is kept with the mailguard
  address it was checked against. If an Admin changes the address, the keys are not sent to the new one: each person
  sees "The mailguard address changed since this token was checked" and pastes theirs again. Keys kept before today
  are tied to the current address on their next good check. The Keychain key and `MAILGUARD_URL` both come from the
  Mac's own environment and stay as they are.
- **The Mac's real-data server and the preview listen on the Mac only** ("Mac only"). `npm run dev:real`,
  `start:real`, `preview` and `cloud-pull.sh` bind 127.0.0.1; the demo still binds 0.0.0.0 for the iPad. They have no
  sign-in, so anyone on the network was anyone there.
- **The Mac app's security review** ("Fix all four"):
  - Its local database listens on no TCP port, only on its socket in the app's own folder. With trust sign-in, the
    port let any program or account on the Mac in as superuser, able to run commands through `COPY TO PROGRAM`. An
    existing copy is closed once, with a restart of its database, at the app's next start; a folder whose socket
    path would be too long for macOS puts the socket in the user's own temporary folder. The address is
    `localhost` with `?host=<folder>`, which the build's own checks now accept (that parameter and nothing else).
  - Pairing sends its grant only to the app's own port (47100), and only to a browser at the address that started
    the pairing; one allowed from elsewhere is refused and forgotten, and says so. The page already said the device
    name is what the app says it is.
  - A downloaded build's folder is named only by a commit (7–40 hex digits); before, the server's header went into
    the path, and that folder is deleted first. `npm ci` runs without the app's keys and secrets in its environment.
  - The copy's launch secret is compared in constant time.
  - Not done, with reasons: the session stays in a Keychain item made by `/usr/bin/security`, which any program
    running as Juan can read; moving it into the signed app needs a Mac build to test, so the Mac does it next.
    "Sign Out of This Mac" still does not end the session on the server: sessions have no table, and the only
    revoke (raising the person's epoch) would sign them out of every browser too. Install scripts still run in
    `npm ci`, since Next's native packages need them; a hash of the build download would come from the same server
    the app already trusts with everything, so it is not checked either.

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
- A research finding pushed by a Team member can lead the findings import to add the finding's firm as a new LP (by
  rule, status New) on every vehicle where the person is pursued, including vehicles the Team member can't change.
  Findings are shared research rather than any one vehicle's, and the import is the system's.
- A meeting or call the mail desk logs on its own still lets Reconciliation record the conversation rungs (Juan,
  8 Oct 2026: the system figures these out, marked and undoable). Refusing touchpoints from the desk would stop its
  logging.
- Under an intro ask's ticket, recipients other than the connector are not checked against restrictions.
- A push identical to an earlier one answers that push's run and job ids, whoever pushed it; the job itself answers
  only its own pusher.
