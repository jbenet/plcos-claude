# W3 LP units — paths through the firm's contacts

Organisation LPs now export their pursuit contacts and eligible current primary work
contacts, with entity keys and roles. Board, adviser and investor affiliations alone do
not qualify. Contact-only people stay nested under the firm; a person investing personally
keeps their own LP row.

W3 counts a path to a contact as a path to the firm, labelled “via <role> (<name>)”, with
exactly the same tier, warmth and warehouse evidence. Each LP unit counts once. The graph
keeps the original personal relationship; the firm's display projection never creates a
new direct edge or converts a warehouse person into an organisation.

Routes, Selection's best path, triage and LP stats share the contact-aware interpretation.
Live routes enforce both firm and contact restrictions. Contact membership changes
invalidate cached searches, and graph changes at a contact invalidate the firm's routes.
Individual LP paths retain their existing behavior.

Validation uses invented fixtures only: contact eligibility and deduplication, dual personal
and firm capacity, A–D tier preservation, warehouse hops, export contents, cached/live
routes and restrictions. `tsc --noEmit`, `npm run boundaries` and all **989/989** properties
in `npm run props` pass. The requested Postgres command was attempted; the sandbox rejected
`127.0.0.1:5434` with `EPERM` before the tests could run.

Claude's live rerun: after integration, use Developer → Enrich → Export the research set;
then, in `plcos-claude-live`, run `DATA_PROFILE=real npx tsx scripts/enrich-connect.ts`.
Rerun `scripts/enrich-triage.ts` under the same profile for saved W9 lanes, then Import the
findings through the live app. Freeze and record the run per [W3 protocol](docs/workflows/w3-connect.md)
and `docs/COLLAB.md`. No real data was read or live workflow run on this branch.
