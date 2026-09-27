# interactions-0045 — Complete bounded interaction history and canonical links

Issue 0045 exposed incomplete interaction coverage upstream of the research export. This change
was developed from code and invented fixtures; no real database or Affinity endpoint was read.

## Causes found in code

- The slice reads named/SPV list entries and their last/next interaction summaries, not complete
  histories. It never fetched email, call or chat collections or the account-wide person directory.
- The legacy calendar starts at 2024 even with `full: true`. Its 99/1,000-request runs record a
  resume URL but do not consume it on retry. History now has a separate resumable all-years path.
- Calendar translation required a participant's exact source ID. Off-list aliases, email-only
  participants and identities arriving after the interaction were missed; organizer-only
  participation and alternate team emails could also lose ownership.
- Source IDs were read without canonical resolution. Alternate full addresses were not joined.
- Notes already read account-wide with created/updated deltas. Their documented first-100
  attachment previews and omitted replies remain limits; relationship-strength reads deliberately
  keep only the first 100 on vehicle-claimed People lists. Neither is complete event history.

## Change

A new **Interaction history** section on `/dev/affinity/meetings` queues GET-only account-wide
person, meeting, email, call and chat metadata. Reads checkpoint every page, resume cap/rate/network
interruptions or server restarts, reject cursor loops, and advance the watermark only after all
streams finish. Caps count transport attempts including retries. The existing key, path allowlist,
monthly budget and demo transport boundaries remain in force.

Translation links exact source IDs to canonical entities and safely connects unbound aliases by
full email address. Ambiguous addresses, shared domains, name-only matches and explicit negative
identity assertions do not merge people. Company contacts keep their own dated histories through
claimed associations. Replaying translation links late identities, repairs owners and dates, and
reuses event/entity references. Human-reviewed identities are not automatically merged.

No migration or external write. Four small demo response files and twelve properties use invented
records. Raw participant preview truncation is disclosed in each history receipt; API visibility
and internal-mail omissions cannot be repaired by a re-sync.

## What Claude must run on live

1. Run `npm run check`, `npm run boundaries`, and both property backends on the integrated branch.
2. In the live server, refresh the Affinity slice so pursued list identities/addresses are current.
3. On Developer → Affinity → Meetings, start **Interaction history**, then use **Continue** until
   its receipt says `ok`. This first history read is a full backfill regardless of the old calendar
   watermark. Continue retains the cursor; do not click Restart between capped chunks. The larger
   continuation permits at most 1,000 requests in that run. Respect monthly quota refusals.
4. Run the existing Notes read for new/changed notes. A full notes re-sync is unnecessary for the
   identity fix; previously landed notes are replayed. Missing/truncated attachments and replies
   remain explicitly outside the current notes coverage.
5. Run **Translate local replica** (the existing import job also reconciles proposals and rebuilds
   the network). No external requests are made by translation. Inspect counts of still-unlinked
   participants and zero-interaction pursued entities through the live server, and review remaining
   name-only duplicates manually. Do not infer that a zero count means no relationship.
6. Use the separate warehouse path for internal communications that Affinity does not expose.
   No real-record diagnosis or warehouse import was performed on this branch.

## Request volume

For P people, M meetings, E emails, C calls and H chats, a full history pass costs approximately
`max(1,ceil(P/100)) + max(1,ceil(M/100)) + max(1,ceil(E/100)) + max(1,ceil(C/100)) + max(1,ceil(H/100))`
requests, plus retries or a terminal empty page where the API requires one. No count endpoint
is called and no per-person interaction fanout occurs. 99 attempts per ordinary chunk; 1,000
per larger continuation. Actual account totals are unknown because no real replica was inspected.

Later reads repeat P/E/C/H sweeps and two meeting change passes. Notes remain one count plus
`ceil(N/100)` pages for a full read, or two counts plus created/updated pages for a delta; a
stopped notes read retains its existing approval rules. Slice volume is list-entry pages plus
one relationship request per selected person. Local retranslation costs zero API requests.

## Validation

- TypeScript and connector boundaries: passed.
- Twelve focused interaction/history properties: passed on PGlite.
- Full PGlite suite: 984/984 passed. The subsequent negative-identity bridge guard also passed all twelve focused properties.
- Requested PostgreSQL command attempted exactly; sandbox refused `127.0.0.1:5434` with `EPERM`
  before test setup. PostgreSQL validation must be run by Claude; no real Postgres data was read.
- Demo visual check attempted on port 3211; sandbox refused the launcher's IPC listener with
  `EPERM` before the server started. No screenshot was captured.
