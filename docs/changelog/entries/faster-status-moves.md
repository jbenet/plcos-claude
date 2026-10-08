# Status moves no longer wait for imports or for the whole list · 8 Oct 2026

Juan, 8 Oct 2026: "why performance of setting statuses of LPs from the selection screen or Pipeline screen is so
slow". Measured on an invented copy at the live scale (115,000 entities, 3,000 LPs on one vehicle, 70,000 meetings).

- **A move waited for any running import.** Every write to about thirty tables (pursuits, research notes,
  identities, affiliations…) updated one shared "revision" row at once, and held that row until its transaction
  ended. A findings or Affinity import writes notes and identities in long transactions, so a move to Selected
  queued behind it, often past the 12 s the page waits, which then reloaded. Revisions now move when a transaction
  commits (network migration 016): a write only notes that it will change a revision, in its own row. Readers see
  the new revision exactly when they see the data, as before. The new value follows commit order, so a route cache
  still finds every change after the revision it read. A second such row, `dakota.identity_revision`, was updated
  by every write to identities, claims and notes and read by nothing; its triggers are gone (dakota 004).
- **A move rebuilt the list twice before the page let go.** The move's server action asked Next to revalidate the
  page, which rebuilds the whole list into the action's answer (about 2 s on the invented copy, more on the live
  data), and then the page refreshed and rebuilt it again. The action now only saves (about 30 ms here), and the page
  refreshes once.
- **The list shows a move at once.** Move to Selected (button or `s`) changes the LP's status on the page
  immediately and goes on to the next LP; the save runs behind and the receipt says "Moving…" until the server
  confirms, then offers Undo (Undo waits for the save). A refused move puts the LP back and says why. "Set status"
  in the tray shows its result as soon as it is saved. Selection and Pipeline both.
- **A page no longer fails as "busy" while an import writes.** Page inputs (the pipeline, the strategy plans) were
  thrown away and rebuilt up to three times when the data changed during a build, then failed. Such a build is now
  shown once and not kept; the next request builds again. Route searches keep their stricter rule.

Checks: tsc, boundaries, the properties on PGlite and on Postgres (new: `commit-revisions`, which also proves a
status change goes through while another connection holds a long write to notes and identities; `cache-retries`
updated for the page-cache rule).
