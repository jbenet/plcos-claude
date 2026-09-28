# Alias join — strategy checker uses the candidate identity

The strategy checker now resolves research aliases through explicit candidate IDs, the exported
alias map, or an unambiguous finding identity before checking W3 pins, evidence gates, firm names,
lead pins and overlapping asks. Unresolvable files get their own diagnostic and fail the check.
The batch tool reuses the same file-only resolver; findings use the newest research per candidate.

Invented properties cover canonical/alias equivalence, both strategy layouts, unchanged and stale
pins, naming, evidence gates, firm asks, lead revisions and unresolved identities.
Validation: `npx tsc --noEmit`, `npm run boundaries`, `npm run props`. Postgres runs at merge.
