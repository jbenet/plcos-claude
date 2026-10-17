# Reconcile finds people Affinity holds through our lists, and Affinity's emails refresh daily · 17 Oct 2026

JuanMail reported on 17 Oct 2026 that Reconcile (`POST /api/outreach/parties`) said "not in Affinity" for people Affinity
holds at exactly the address emailed, and that the copy's date had not moved after a refresh.

- **Addresses from list entries.** PLC OS's copy of Affinity has two places a person's addresses live: the person
  record (the history read's sweep of every person, which pauses at its 99-request cap) and their entry on each list we
  read (the daily slice). Only person records counted, so an LP on a vehicle's list whose person record the sweep had
  not reached was "not in Affinity" and had no Affinity address. Both now count, in Reconcile, in an LP's addresses for
  the mail desk, in add-an-LP's match by address, and in the calendar's matching (`AFFINITY_PERSON_ADDRESSES`,
  `lib/calendar-sync.ts`). Matching was already case-insensitive and read every address, not only the primary.
- **Emails daily.** The 03:00 UTC daily chain read the lists and translated them, but never Affinity's emails, so
  "covered" compared the day's mail with a copy from whenever someone last read emails by hand. The chain now runs
  `recent-emails` (about 30 requests) between the slice and translate; if it fails, the chain carries on.
- **Honest dates.** `affinityCopyAsOf` is now the older of the lists' and the emails' last read, and `affinityCopy`
  dates each part (`listsAsOf`, `peopleAsOf`, `emailsAsOf`). Before, it was the newest slice or history read, which
  says nothing about the emails.
- **Receipts by token.** `GET /api/sync/jobs?receipts=affinity` (Admin token) lists the last 20 Affinity reads and jobs:
  kind, state, times, counts, the receipt's note and who ran it. Whether a refresh read anything could only be seen in
  a signed-in session before.
