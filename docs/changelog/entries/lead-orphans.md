# Connector rounds named by their author stale nothing; leads with no strategy get re-pinned · 7 Oct 2026

Two findings from the W5 writers after the narrower staleness rule (PR #23). A connector-research append whose words
didn't say "connector evidence" still counted as reaching every vehicle, so strategies went stale on ties alone.
`correctionReach` now also reads the round in its author ("cold1-07", "connection-only") as a ties append.

Many firm-level strategies pin a lead colleague who has no strategy for that vehicle, often no candidate line at all.
Nothing could move, so the checker counted them as healthy. It now reports "N whose lead has no strategy" beside the
leads rewritten since, and `--lead-moved` lists them too, so the re-pin batch picks them up.
