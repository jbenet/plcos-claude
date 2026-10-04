# Railway plan — one service and one Postgres, with local copies one way · 3 Oct 2026

Juan, 3 Oct: deploy to Railway to manage his own infra, move the database off the Mac, keep a quick local
copy for testing, and run workflows in the cloud. [docs/deploy/railway.md](docs/deploy/railway.md) is the
plan: one web service from the existing Dockerfile (`next start`, import children, daily timer, backup), a
volume for the working files, and Railway Postgres 17. It covers variables, the steps in Railway, the
database move, local copies, workflows, backups, a cost guess, and eight decisions. Nothing was deployed and
nothing contacted Railway.

**The move strips Dakota on the Mac first.** Rev 3 stripped Dakota after restoring into the target, which on
Railway would leave Dakota rows on its disk and backups. Now there are two hops with the same `cutover.sh`:
Mac → a stripped Mac copy, then the stripped copy → Railway, with an exact MATCH and
`scripts/railway-grants.sql`. That file sets the Mac's role split on the new database: `plcos_app` owns
everything, and `plcos_ro` reads, including future tables.

**A bug that would have stopped any cutover off the Mac.** `pg-verify` hashed rows as text in each server's
own time zone, so a Los Angeles cluster and a UTC cloud database never matched. A simulated cutover between
two invented clusters in different zones failed on 45 of 123 tables. With the fix (pin UTC and the other
output settings, as `pg-copy` does), it gave MATCH on all 123.

**Local copies, one way.** `scripts/cloud-pull.sh init|pull|serve` copies the cloud database into its own
loopback-only cluster beside the real data. It reads the cloud as the read-only role, and it replaces the
last copy only after the new one has restored and been checked. It serves the copy with `PREVIEW_COPY_AT`,
so the app refuses writes and runs no connectors. Secrets come from the environment or the Keychain and are
never printed. `scripts/railway-env.ts` generates the doc's variable table from `service.env.example`,
which gains the two AWS key names Railway needs, since Railway has no IAM role. `cutover-files.sh` now leaves
out `cloud-copy/`.

Tested on invented data only (the :5434 test cluster and scratch clusters, all dropped afterwards):
- two pulls in a row, and a failed pull that kept the last copy;
- a SCRAM cluster made by `init`, with a wrong and an empty password both refused;
- eight refusals;
- a cutover with the grants file: 123/123 tables owned by `plcos_app`; `plcos_ro` reads, cannot insert or
  create, and can read a table created afterwards;
- a pull as `plcos_ro`;
- `serve`: health 200, the copy banner, no errors.

Not built yet (railway.md §2): database TLS for Railway's hosts, the build's commit variable, the volume
owner, sign-in for a public URL (decision A), and a guard that stops `dev:real` on the Mac after the move.

**4 Oct: Juan's decisions.**
- Sign-in is Google OAuth on MailGuard's pattern, and every secret is entered in the app. Outside the app
  there is only `PLCOS_SECRET`, which encrypts and signs, plus the database connection.
- No public database port. Pulls and pushes go through our API; the move goes through Railway's SSH tunnel
  and `scp`, both in Railway's CLI docs.
- No S3 for now. Research runs in the cloud and on the Mac, and the Mac pushes results up.
- The plan is rewritten to match.

Four deploy fixes landed with it:
- `*.railway.internal` connects without TLS. Railway's private network is WireGuard-encrypted, and its
  Postgres has no public certificate.
- The Dockerfile accepts Railway's commit variable.
- An entrypoint started with `RAILWAY_RUN_UID=0` hands `/app/data` to uid 10001 and drops to it.
- `npm run dev:real` refuses once `data/real/moved-to-cloud` exists.

`railway.json` sets the healthcheck and one replica.
