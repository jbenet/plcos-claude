# Cloud pull and push — through the app's own API, with tokens from Preferences · 4 Oct 2026

Juan's decisions for the move to Railway (4 Oct): no public database port, so pulls and pushes go through
the app, which checks who is asking (G); no S3, so the Mac's daily encrypted pulls are the off-site copy (D);
research runs in the cloud and on the Mac, and the Mac pushes its results up (F); and Dakota stays off the
cloud (C). This builds that door. [docs/deploy/railway.md](docs/deploy/railway.md) §6, §7 and §7a have the
details. Nothing was deployed, and nothing contacted Railway.

**Two token scopes, in the existing model.** `sync:snapshot` (Admins only) and `sync:push` (a GP or an
Admin) ride in an MCP token's tools, like the outreach scopes. Each endpoint declares a policy the way an MCP
tool does, and the same `allowed` checks it. Who may hold each scope is data (`lib/sync/scopes.ts`). It is
checked when the token is made and again on every use, so a demoted Admin's snapshot token stops working.
Preferences → MCP access offers both under "May". It shows the token once, with the Keychain line the
script reads it from. A sync token holds its scope alone, so it lists no MCP tool. Every use is an
`mcp.call` audit row with `via: sync`, beside MCP and outreach calls.

**Down: `GET /api/sync/snapshot`.** The server runs `pg_dump -Fc` against its own database and streams it,
one at a time (409 while one runs). The password reaches `pg_dump` only through its environment. `?files=1`
streams the working files instead, minus what cutover leaves out, by `cutover-files.sh`'s own lists.
`scripts/cloud-pull.sh pull` now reads this with the Keychain item `plcos-railway / snapshot-token`, in
place of a database URL. `init`, `serve` and the check-then-swap are unchanged. `--keep` also fetches the
files and encrypts both into `~/plcos-backups` the way `backup-real.sh` does, and `backup-prune.py` thins
those copies with the Mac's own.

**Up: `POST /api/sync/push`.** `scripts/cloud-push.sh <file>…` sends one finished W1, W1c or W5 output. The
importer's own validators run on the Mac before anything is sent, and on the server again. Any claim sourced
from Dakota, or citing it, is refused at both ends. The server also refuses an older finding or strategy over
a newer one, and grades a W1c review against its own finding. A refusal lists every reason by file and writes
nothing. An accepted push is kept under `enrich/inbox/<run>/`, published where the workflow writes, and
recorded as a ledger run with the Mac's run as its parent. It then queues the normal findings import. The
same content pushed twice is taken once (`platform.sync_push`, migration platform 017).

Tested on invented data, the demo profile and the :5434 test cluster only. Eleven properties cover the
scopes, the refusals, Dakota, idempotency, the audit, and `cloud-push.sh` end to end. On Postgres, a
snapshot round trip runs through `cloud-pull.sh` into a scratch cluster on a free port: all 130 tables'
row counts match, and the `--keep` archive opens with its passphrase. An e2e check makes a push token in
Preferences and sees it refused a snapshot and every MCP tool. Scratch clusters and databases were removed.
