# Writes no longer deadlock on the route change log; the list and the plan share one read · 8 Oct 2026

Third round of the performance pass Juan asked for on 8 Oct 2026. Invented data only.

- **Two writes could deadlock at commit.** When a write touches people, organizations, affiliations or edges, it
  marks those records for the route checks and stamps them with the route revision at commit. The mark was the
  transaction's id, and an already committed stamp is often equal to some later transaction's id, so that later
  commit restamped (and locked) other records too. Two such commits could deadlock, and one of them failed (seen in
  the identity-resolution property on Postgres). A transaction now marks its own records with the negated id, which no
  committed stamp carries (network migration 018). Nothing else about the stamps changes.
- **The list and the vehicle plan read the pursuits and their touchpoints once.** A cold list build read every
  pursuit on the vehicle and their touchpoints twice, once for the list and once for the plan; both now share one
  cached read. Cold build on the invented copy, about 0.78 s → 0.7 s; same output.
- **A rebuild behind an answer reads its inputs current.** A cache rebuilt behind an answer now never itself answers
  from a stale inner cache, so it cannot rebuild from the same stale data it is replacing.

Checks: tsc, the properties on PGlite and Postgres (`commit-revisions`: a commit restamps only its own records, and
fails on the old migration; `cache-retries`: a rebuild behind an answer reads its inputs current).
