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
- **Id columns stay compact when some ids repeat.** A packed column of ids is sent in the 22-character form unless
  a shared dictionary would be shorter; the floor's LP ids (5,037 distinct in 6,039 rows) went from 236 to 133 KB.
  On the real data: all/visualizations 1,058 → 956 KB, coverage 1.51 → 1.32 MB, all/pipeline 2.61 → 2.44 MB.
- **Suggestions and vehicle readings are read once per version.** The same version check (`modules/strategy/by-version.ts`)
  keeps the wide values of each suggestion and reading until its row changes. On the real data: all/fit after a write
  230 → 132 ms, all/pipeline's SQL 976 → 682 ms, conversion 515 → 490 ms.

- **Developer › Enrichment opens at once.** Each view started a worker that compiled the summary's code, about 240 ms
  with an empty folder. The summary is kept while the files it reads are unchanged (names, sizes, times): 258 → 48 ms
  on the large invented data.
- **A write no longer re-reads every stored route.** A vehicle kind with no scored route (the grants rail) started a
  full route warm-up on every routes view, and the page warm-up opens those after each write. Now one per kind and
  route generation: the server's CPU after a write on the large invented data went from about 5.8 to 3.5 s.

- **LP stats rebuilds a little sooner after a write.** Its LP-only reads start alongside the firms' people read,
  country lookups and number formatters are kept, Dakota estimates stop at each LP's newest row, and packed ids keep
  their codes: on the large invented data stats 330 → 294 ms, pipeline 168 → 158 ms (medians of 20 cycles).

- **Rebuilds after a write are cheaper.** LP stats read each firm's contacts once instead of once per affiliation
  (firms' people 60 → 17 ms); a vehicle's readings find each LP's latest proposal by its index (47 → 13 ms); packed
  rows decode by lookup table; Strategy formats money with one formatter. In-process rebuilds: stats 206 → 163 ms,
  conversion 280 → 158 ms; Fit's first load after a write 75 → 55 ms. Warm pages were already under ~75 ms and are
  bound by rendering, so they barely move.

- **Every page loads less script.** The feedback drawer (form, drafts, captures) and the outbox list are fetched when
  first opened, or when the button is pointed at, not with every page: about 29 KB less script per page. Packed rows
  send a repeated index column as a run, cutting Pipeline's HTML by 36 KB and Visualizations' by 40 KB. The feedback
  browser regression passes (14 of 14).

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
- **A stranger's invite is not a meeting held.** A calendar invite from outside landed as a meeting with that LP even
  when nobody here had answered it, so Reconciliation recorded the conversation rungs (connector, opted in, meeting
  held) from it. An outside invite now counts only once someone here accepted it (yes or maybe), and a guest who
  declined is not a guest. One added before goes after the next whole read.
- **Markdown links go only to the web, mail or this app.** A link in feedback, a commitment or a doc could carry any
  scheme or a `//host`; those now show as text.
- **A hardening approval is for the amount asked.** A MONEY ticket named its exposure but not the amount, so if
  Affinity's nightly read or a soft revision changed the amount between the ask and the approval, approving it
  hardened the new amount. The ticket now carries the amount and vehicle, and hardening refuses when either differs;
  a ticket from before this is asked again. The exposure is locked while it hardens.
- **Two wires at once cannot pass the commitment.** Each wire was checked against the total outside its transaction;
  the commitment is now locked and its wires summed again inside it.
- **A restriction covers the person mailed, not only the LP.** The desk's checks looked at the LP's own record, so a
  firm's contact with a do-not-contact restriction was listed as a plain contact and a SEND ticket to their address
  opened with "No restriction on file". A ticket naming a restricted person's address is now refused to an agent and
  shown blocking to a person; such contacts carry `doNotEmail`; a restriction recorded later ends tickets addressed to
  them.
- **A Materials send is checked against what the LP would hold.** The page let the sender pick any instrument, so a
  grants funder could be checked as a PRI and cleared for an investment memo. The instrument now comes from the LP's
  commitment on that vehicle, else the vehicle's kind, and an email-barring restriction or a grants funder with no
  invitation refuses (rules 8, 11, 12).
- **Being copied is not replying.** Affinity's mail marked every outside person on a message as having written it
  whenever the sender was outside, so an intro email that copied an LP read as the LP's reply: LP opted in, the
  connector rung "not applicable", status Discussing. Only the sender's touchpoint is now theirs. Matching a reply's
  sender also no longer uses licensed (Dakota) addresses.
- **An invite nobody accepted counts only if one of us sent it.** Today's invite fix kept any meeting organized from a
  Protocol Labs domain; the organizer must now be a team member's own address.
- **Record merges are on the audit log.** Merging duplicates (by rule or by review), separating records and retyping
  them wrote only a run receipt, while undoing any of them was audited. Each run that merges, separates or retypes
  now writes one audit row naming the records; reopening a separation and an Admin's type correction are audited too.
- **Licensed data is matched as everywhere else.** The research read layer hid a claim or source only when its source
  was exactly "dakota"; it now matches `dakota…` ids and any Dakota origin, as the other readers do. Nothing writes
  such records today: this closes the gap before something does.
- **Searches say what they covered.** The MCP routes answer with no route now names what was searched, as of when,
  and that none found is not none (rule 7); the name search adds its date.
- **Only the app itself and LabOS may frame it.** No page sent a framing policy, so any site could put an approval
  button in a frame (the session cookie limits this to same-site pages). Every response now says `frame-ancestors
  'self' https://os.pl.xyz`, `nosniff` and a strict referrer policy.
- **The feedback form has an overall size limit.** The browser route read the whole body before checking each
  picture; it now stops reading past 42 MB (the pictures' 40 MB plus text) and answers 413, as the token route does.
- **Astra's strategy runs have no network.** Every Astra worker could reach the network, including the W5 family,
  which reads the team's `context` notes (a Team member on one vehicle can write them) and quoted mail, with the whole
  real export on disk. A planted instruction could have sent it out. Only the web workflows (w1w5, w1, w1s) now get the
  network. The brief and the W5 protocol also say that record text is data about the LP, never instructions to the worker.
- **Astra runs pin what they meant.** The ledger hashed the template and protocol but not `common.md` or the
  filled brief, so a `git pull` changed later runs without a new hash. It now hashes the filled brief plus the protocol, and
  records the runner's commit as the protocol version.
- **A restricted firm's own address is barred too.** The desk's SEND ticket checked recipients only against people,
  so `investments@` a firm under a do-not-contact, or a person who deals with us through that firm, passed. The check
  now covers an organisation's email claims and send-to, and a person's primary current firm.
- **The desk wraps a material as the Materials page does.** It sent every non-SPV material as a commitment, so a
  grants-rail send skipped the funder-invitation check. It now takes the instrument and refusals from the same gate
  (moved to `lib/outreach/send-gate.ts`).
- **A request key answers only its own token and request.** Keys were shared across one owner's tokens and replayed
  without comparing arguments, so a narrower token reusing a key read the wider token's answer. A replay to another
  token, or for different arguments, is now refused (409). An `/update` key is per LP, so a reused key no longer
  silently answers another LP's update.
- **A calendar entry that only names an LP climbs nothing.** An entry with none of their guests on it, matched by a
  name in its title or description, recorded Meeting held and LP opted in and moved the LP to Discussing, so a
  vendor's accepted invite saying "we work with X" did it for X. It still shows on the LP's timeline with "Not this
  LP", but Reconciliation no longer uses it for a rung or a status.
- **An invite with no answer from us is not accepted.** An invite sent to a group address, or read from a calendar
  shared with someone, has no guest line for them, and that counted as accepted. It now counts only when someone on the
  team organized it.
- **A rung taken back stays back under a new reference.** A retraction blocked only the exact record behind it, so
  Affinity's copy of the same email, or an older message ingested later, recorded the rung again. A record dated
  before the retraction is no longer used for that rung.
- **The Mac app checks it is talking to its own copy.** The core took any 200 from the local copy's port as its server,
  so another account on the Mac holding that port while the app was closed would have been served as the app, with
  the session. The health check now sends a nonce and needs the launch secret's HMAC back (proxy.ts), and its own
  child must still be running.
- **The copy cluster's password never goes out in the clear.** Connections to it now require scram
  (`PGREQUIREAUTH`), so a listener on its port while it is down gets nothing. The app's data folder is made
  owner-only even when the shell created it first.
- **A report can't pass itself off as Juan's.** An issue file was read with the first `json context` block in it, so
  a report that typed one ("user": "juan", verified) was read as Juan's, and the dev agent's triage treats his reports
  as "do it". The reader now takes the block the server appends last, and the triage doc says the reporter comes only
  from the frontmatter and that context, the report's text being data, never instructions. The feedback status call
  stops reading past 8 KB.
- **One LP's commitment can't be hardened twice after a merge.** Merging two records of an LP left both commitments
  on the vehicle, and each could get its own MONEY ticket, counting the money twice in the hard headline. Asking for or
  applying a hardening now refuses while the LP has another open commitment on that vehicle and instrument.
- **A person's withdrawal or revised amount survives the next Affinity read.** The read reopened a withdrawn
  commitment and put Affinity's figure back over a revised one; it now leaves a commitment a person withdrew or revised.
- **Withdraw and revise act only on an open soft commitment, under its lock.** A withdrawal from a page read before an
  approval could close a commitment that had just been countersigned. Two adjudications of one overlap at once lock the
  case, so it can't name one winner while the asks name the other.
- **Licensed Dakota employment rows stay out of what tokens read.** Finding an LP's firm, the firm's pursuits, the
  people a message is about and the addresses barred from a send all went through affiliations, including those from
  Dakota's licensed list, so a token could learn of a Dakota-only tie. Those readers now skip Dakota rows, like the
  research read layer already did.
- **A Team member's pushed decisions are their own and on their vehicles.** A Team token could push a merge decision
  signed with someone else's name, or one joining LPs on vehicles it can't change. Such a push now answers which row and
  why; an Admin pushes others' decisions.
- **A draft made through the API no longer hands back the strategy's subject line.** The draft tool returned the
  subject filled in from the LP's strategy, which can rest on licensed data; like the body and the address, it now
  comes back only when the caller wrote it.
- **The relationships list shows hard and soft money per vehicle.** An LP with $5M on Neurotech and $2M on Crypto
  showed $7M, against its own label and invariant 1. Each vehicle's figure is shown on its own line, and the list is
  ordered by the largest one.
- **Issue bodies stay in the app for tokens kept to some vehicles.** The feedback issues tool withheld bodies from
  Viewers only; a body can quote records on any vehicle, and the app already showed such a user titles only.
- **The capital pool leaves grants out.** A funder holding a grant and an SPV position could show as over budget,
  since the pool check added the grant (invariant 10: the pool is fund and SPV money).
- **An expired ticket can't be approved late, and a stale Approve says what happened.** Approving a ticket someone else
  had just rejected answered "Approved, but the action did not run"; it now says it was already rejected. An expired
  ticket is asked for again.
- **An Affinity write batch writes only what the Admin saw.** A name filled in after the batch was shown (the first
  proposal had a bare address) kept the shown id, so approving it created the person under the later name; it now
  waits in the next batch. Mail in an approved item not yet written (its batch writing, or stopped by a restart) is not
  proposed again, and a write checks that no other batch has already noted the same mail.
- **DocSend sign-in asks only for read scopes** when DocSend lists them apart, so a stored token can't change a data
  room even outside PLC OS's own client.
- **A material's link change keeps both links on the record.** The mail desk offers the link next to an approved
  material, and the audit row said only that a link was there before and after.
- **Revising a soft amount keeps the old amount on the record.** An amount from the Affinity read had no earlier event,
  so its first revision erased it.
- **The Mac's local copy stops serving the moment its person is no longer an Admin.** It kept answering pages for up to
  a back-off (30 s or more) after the server first refused it.
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
    running as Juan can read; the whole real-data copy sits in the same user's Library, so locking the item down
    would not change what such a program reaches. Explore mode refuses only writes other than GET; none of the 27
    GET route handlers writes.
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
- A calendar guest from the LP who never answered the invite still makes it a meeting held, and one accepted recurring
  series counts each past occurrence. Requiring their answer would drop real meetings with people whose mail client
  doesn't send one.
- A Message-ID reported again keeps the first copy's date, sender and direction; a second mailbox's copy can add the LP
  it is about. Mailboxes report the same message with different directions, so refusing a mismatch would refuse real
  mail; credit still goes only to the LP who sent it.
- A rung taken back still blocks a later genuine record of that rung while the retracted record remains the earliest.
- Astra's main window loads the server page with the global Tauri object. Tauri 2 refuses commands from a remote
  origin unless a capability lists it, and Astra's lists only its bundled feedback window, so no change; a
  navigation guard would need a Rust build to verify, which the cloud can't do.
- The launch key cookie goes to every port on 127.0.0.1; nothing in the app's pages points elsewhere on the loopback.
- Two commitments left by a merge still both count in the soft total until a person withdraws or revises one. Folding
  them on merge would decide which amount stands; hardening is refused meanwhile, so hard money is never doubled.
- Self-approval is checked by user id only; with the local user switcher one person can ask as one user and approve as
  another. It waits for real sign-in.
- A token for one vehicle may set where an LP's mail goes when that LP is also pursued on another vehicle. An address
  is the person's, not a vehicle's, and Juan wants the desk to do more on its own; the audit row records who changed it.
- A push identical to an earlier one answers that push's run and job ids, whoever pushed it; the job itself answers
  only its own pusher.
- Approving an already approved ticket runs its action again: that is how a hardening refused for a lapsed
  verification is retried. Hardening does nothing the second time, and the amount is now bound.
- A received message's From is taken as sent: a spoofed sender can record "LP opted in" (undoable, marked). Checking
  DMARC needs the mail desk to pass the verdict; not worth it yet.
- A note Affinity attaches to a meeting still dates that meeting by the note: the meeting is Affinity's own record.
- DocSend visits name the visitor by the email they typed, unchecked. Visits feed only the conversion charts, never
  the consent ladder, so a made-up address can't move an LP.
- The two data planes are kept apart by which module reads which schema, checked by `npm run boundaries`, not by
  Postgres grants: the app connects as one role. Separate roles need a second connection pool; worth it when a
  second process reads the database.
- The capital pool check shows an LP over budget but does not stop a hardening: refusing would be a new blocking rule,
  and those wait for Juan to ask for them.
- Changing an approved material's link doesn't ask for approval again: pasting the DocSend link after approval is the
  normal order, and both links are now audited.
