# Identity reviews reach the cloud: a W13 push · 7 Oct 2026

Since the move to Railway, a W13 identity review written on the Mac had no way up: a push took W1, W1c, W5 and
prospects only, and `identity-decisions.jsonl` lives on the server's volume. Meanwhile the 7 Oct audit of the cloud
copy counted 92 pairs of same-named LPs pursued twice in one vehicle and about 3,300 open possible matches.

`POST /api/sync/push` now takes `{ workflow: "W13", files: [{ path: "identity-decisions[-<name>].jsonl", content:
[rows] }] }`. Each row passes the decision validator the merge itself uses (group hash, decision kind, evidence with a
date and quote, `decided_by`); one bad row refuses the push, by row. Accepted rows are appended to the server's
`enrich/identity-decisions.jsonl`, skipping any row already there, as the W13 protocol keeps the file append-only.
Nothing is merged and nothing is imported: an Admin still applies proposals with Developer → Enrichment → Merge
duplicate identities, which refuses a stale or unknown group by line, as before. `bash scripts/cloud-push.sh
…/enrich/identity-decisions-<batch>.jsonl` reads the workflow from the name.

Tested on invented rows (`npm run props`, SYNC push): a bad row refused by number, two pushes appending three distinct
rows, no import queued.
