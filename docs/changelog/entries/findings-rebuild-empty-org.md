## Import findings — the ties rebuild stopped on a nameless organization; failed imports say where and why

30 Sep 2026, 07:48–07:50 UTC: Developer → Enrich → *Import the findings* imported the findings,
re-pointed pursuits and derived the SPV stance, then stopped at phase 4 of 5, *Rebuilding research
ties*, about 35 s in. The receipt and the live log said only "Import stopped."

**Cause.** One research source gave an organization as a single punctuation mark. The network
planner keys an organization on its name's Latin letters and digits, so that name's key was empty.
The live database has held that empty-keyed organization since 26 Sep. Until 29 Sep a rebuild
skipped identity resolution for a node already pinned to an entity. Since c2c6b0c (29 Sep, "Resolve
duplicate identities before creation") every pinned node also goes through `resolveEntity`, which
refuses an empty source ID. So the build transaction threw at that node (node 8,104 of about 99,000)
and rolled back. It was the first findings import since that commit. The evidence: no Postgres error
in the server log in that window (so a JavaScript throw, not a timeout, lock or constraint); the last
route warm-up is from 29 Sep (so the phase never reached it); no network edge or identity row was
written after 29 Sep; exactly one planned node had an empty source ID, and a property on invented data
reproduces the throw.

**Fix.**
- A name with no letter or digit is not an organization: the planner makes no node or tie for it.
  A name in another script (Greek, Chinese…) keys on that script's letters and digits. Before, every
  such name fell into the same empty key, so one "organization" joined every person it was written
  against. On the current files that shared node held the symbol and 3 other-script names, and 8
  unreviewed ties.
- The next rebuild retires those 8 unreviewed ties, as it does for any stale managed tie. Reviewed
  ties are kept. The 3 names become their own organizations.

**Diagnosis next time.** A failed import job's receipt, and a line in the server log, now say where
it stopped and what kind of error it was, with no message text and no parameters. That means the
error's class, a Postgres SQLSTATE with its condition name and the schema object it names, a Node
system code, and the first frame of our own code. For example:

> Import stopped at Rebuilding research ties (57014 query_canceled (statement timeout or cancel) on network.edge, 118 s into the phase, 240 s in all). Review the last committed results before retrying; completed changes are preserved.

With this in place, the 30 Sep receipt would have read `Error at modules/identity/create.ts:117`. The
worker's own output stays discarded. The server logs the stored receipt as
`[import] <kind> job <id prefix> failed: …`.

Properties (invented data): the planner makes no empty-keyed organization and keeps two Greek names
apart; a rebuild over an existing empty-keyed organization completes and retires its hub ties (this
failed with the live error before the fix); a failed receipt carries the phase, SQLSTATE, schema
object and elapsed time and none of the message; frames outside the checkout or in dependencies
are dropped; the server log gets the receipt line.

**Left as it is.** A rebuild still calls `resolveEntity` for every pinned node, about 99,000 on
live. At the rate this run reached (about 8,100 nodes in under 35 s) that adds an estimated 5–6
minutes to phase 4. The earlier findings imports took 7–10 minutes in all. If that becomes the
bottleneck, skip the call when a pinned node brings no organizations, domains or links to remember.
