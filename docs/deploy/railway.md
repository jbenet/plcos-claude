# Capital OS on Railway (3 Oct 2026)

Juan, 3 Oct: deploy to Railway to manage his own infra, move the database off the Mac, keep a quick local
copy for testing, and run workflows in the cloud with results synced down. This replaces PL's LabOS app
as the target for now. Almost everything built for [rev 3](rev3.md) carries over: the image, the import
child process, the daily timer, the encrypted backup, `cutover.sh` and the Dakota strip. What changes is
where it runs, how people sign in, and a few small code changes (§2).

**The rule:** one web service and one Postgres. Nothing else until something measured needs it.

## 1. The shape

| Part | What | Notes |
|---|---|---|
| **Web service** | Built from the GitHub repo with the existing `Dockerfile`: `next build`, then `next start` (the production build; see the page-speed and prod-build changelog entries) | Import jobs run as child processes of this server, as on the Mac. The daily timer (`SCHEDULE_DAILY_AT`) and the backup (`BACKUP_COMMAND`) run inside it too. No worker service, no cron service, no Redis. |
| **Volume** on the web service | Mounted at `/app/data`; the working files live in `/app/data/real` | About 2.2 GB today: research (`enrich/`, 2.1 GB, 37K files), issues, materials, intake, workflow ledger. Start at 10 GB. |
| **Postgres 17** | Railway's Postgres template, pinned to 17 to match the Mac | Holds the only copy of the real data after cutover. The Mac's cluster is 2.3 GB on disk today; the last measured dump was 190–222 MiB (28 Sep). |
| **Region** | US West | Juan is on Pacific time. |
| **Size** | Memory limit 8 GB, 2+ vCPU | Measured (06-measurements): the server peaks at 1.25 GiB under 10 users, the findings import child at 2.43 GiB. Railway bills for what is used, not the limit. |

The Mac becomes a development machine: demo servers, previews of local copies (§6), and Dakota (§7).

## 2. Code changes before the first real deploy

None of these is built yet. Together they are about half a day, plus sign-in (decision A).

| # | Change | Why |
|---|---|---|
| 1 | **Database TLS on Railway.** Off loopback, the app demands a certificate it can verify (`lib/db/postgres.ts`), and the real profile refuses a non-loopback database unless `LABOS_ME_URL` is set (`config/deployment.ts`). Allow `*.railway.internal` without TLS, and accept `sslmode=require` for the public proxy. | Railway's private network has no public certificate (Railway says the network itself is encrypted; check), and its proxy certificate is self-signed. `pg-verify` and `strip-dakota` connect through the same client at cutover. |
| 2 | **Commit for the build.** The Dockerfile refuses an empty `GIT_COMMIT`. Fall back to Railway's `RAILWAY_GIT_COMMIT_SHA`. | Railway passes service variables to `ARG`s at build time (check on the first build). |
| 3 | **Volume owner.** The image runs as uid 10001; Railway mounts volumes owned by root. Add a tiny entrypoint that fixes the owner and drops to 10001, or set `RAILWAY_RUN_UID=0` until then. | Otherwise the first write to `/app/data` fails. |
| 4 | **Sign-in and "this is the live server".** Both key on `LABOS_ME_URL` today (`config/ports.ts` `isLiveServer`). If sign-in is not LabOS (decision A), replace that with one explicit setting. | The local user switcher must never serve real data on a public URL. Today the code already refuses to start that way: real data plus a remote database needs `LABOS_ME_URL`, which hides the switcher. Keep that property. |
| 5 | **The Mac stops being live.** After cutover, `npm run dev:real` refuses when `data/real` holds a `moved-to-cloud` marker. | Habit would otherwise write to the frozen Mac database, or fall back to the 6.9 GB stale PGlite copy if `postgres.url` were removed. |

Already fixed on this branch: `pg-verify` hashed rows as text in each server's own time zone, so the Mac's
cluster (Los Angeles) and a UTC cloud database could never match and the cutover would always stop. It now
pins UTC, as `pg-copy` does. Rev 3's rehearsals were Mac to Mac, which is why nobody saw it.

## 3. Sign-in on a public URL

Today anyone on the Mac's network can pick any user from the switcher. On Railway the app has a public URL,
so the switcher must never be reachable with real data. Two ways:

- **LabOS (no new code).** The server reads LabOS's `authToken` cookie and asks LabOS's `/me` who it is
  (the labos-signin entry). The browser sends that cookie only to LabOS's own domain. So this works only if
  PL lets the app live on a domain that receives the cookie. Ask PL Infra.
- **Google sign-in with an allowlist (about 1–2 days).** Reuse the Google OAuth client from Gmail drafts
  (docs/25), add the Railway URL as a redirect, and map each verified email to its `platform.app_user`. Anyone
  else is refused. This also gives Gmail drafts the https redirect they need to work from the cloud.

Until one of them works, Railway runs the demo only. MCP tokens (`/api/mcp`) are bearer tokens and work
either way; they move with the database. Point `claude mcp add` at the new URL.

## 4. Setting it up (Railway UI; CLI in brackets)

**Variables.** `npx tsx scripts/railway-env.ts` prints this table from
[service.env.example](service.env.example), so the two can't drift. Type values into the service's Variables
tab, and seal the secret ones (Railway hides sealed values after saving). Never put a value in chat, a file,
a commit or this doc. Each Mac Keychain item becomes a Railway variable: the Affinity key, the Linear key,
and new Postgres passwords, not the Mac's. The `admin` role becomes Railway's own `postgres` superuser,
which only Juan uses. "Mailguard" is not named anywhere in this repo; if it is a token, it follows the same
rule.

| Variable | Tag | Secret | On Railway |
|---|---|---|---|
| `DATA_PROFILE` | required |  | `demo` for the first boot, `real` at cutover. |
| `LABOS_ME_URL` | required |  | Decision A. Set only if LabOS sign-in can reach the Railway domain; otherwise the sign-in that replaces it. |
| `DATABASE_URL` | required |  | `postgresql://plcos_app@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/plcos_demo` first, then `…/plcos_live`. No password in it. |
| `PGPASSWORD` | optional | yes | The `plcos_app` password you set on Railway Postgres (§4 step 3). Not the Mac's: new passwords for the cloud. |
| `PGSSLMODE` | optional |  | Leave unset on the private network (code change 1). |
| `AFFINITY_API_KEY` | required-real | yes | Keychain `plcos-affinity`. Set at cutover. |
| `LINEAR_API_KEY` | required-real | yes | Keychain `plcos-linear` / `api-key`. Set at cutover. |
| `DAKOTA_USERNAME` | never |  | **Never set.** Dakota stays on the Mac (decision C). |
| `DAKOTA_PASSWORD` | never |  | **Never set.** See DAKOTA_USERNAME. |
| `CLOUDSDK_AUTH_ACCESS_TOKEN` | never |  | **Never set** on Railway. |
| `GOOGLE_OAUTH_CLIENT_ID` | never |  | **Not yet.** Gmail drafts move to the cloud with decision A's Google option, or later (docs/25). |
| `GOOGLE_OAUTH_CLIENT_SECRET` | never | yes | **Not yet.** Gmail drafts move to the cloud with decision A's Google option, or later (docs/25). |
| `ANTHROPIC_API_KEY` | later | yes | From an Anthropic workspace with a monthly limit. Set when the cloud research jobs start (§7). |
| `ANTHROPIC_MODEL` | optional |  | Leave unset (the default works). |
| `FEEDBACK_EXPORT_TOKEN` | required-real | yes | A new random token (`openssl rand -hex 32`); the Mac keeps its copy with `npm run secret:store -- feedback-export-token`. |
| `SCHEDULE_DAILY_AT` | later |  | `03:00` (UTC), the day after a manual Affinity sync works from Railway. |
| `PAGE_WARM` | optional |  | Leave unset (the default works). |
| `BACKUP_COMMAND` | required-real |  | `bash scripts/backup-service.sh` |
| `BACKUP_BUCKET` | required-real |  | The S3 bucket in your AWS account (decision D). |
| `BACKUP_GPG_PUBLIC_KEY` | required-real | yes | The armored public half only (rev3.md "Backups"). The private half never goes to Railway. |
| `AWS_REGION` | optional |  | The bucket's region. |
| `AWS_ACCESS_KEY_ID` | optional | yes | An IAM user that can only put, list and delete under the bucket's `plcos-*` prefixes. Railway has no AWS role. |
| `AWS_SECRET_ACCESS_KEY` | optional | yes | That IAM user's secret. |
| `BACKUP_DRY_RUN` | optional |  | Leave unset (the default works). |
| `BACKUP_KEEP_DIR` | optional |  | Leave unset (the default works). |
| `NODE_ENV` | image |  | Do not set: the Dockerfile sets it. |
| `NEXT_DIST_DIR` | image |  | Do not set: the Dockerfile sets it. |
| `PORT` | image |  | Do not set: Railway sets it, and the image listens on it. |
| `NODE_EXTRA_CA_CERTS` | image |  | Do not set: the Dockerfile sets it. |
| `PGSSLROOTCERT` | image |  | Do not set: the Dockerfile sets it. |
| `GIT_COMMIT` | image |  | Build argument; code change 2 takes it from Railway's commit variable. |
| `PLCOS_IMPORT_WORKER` | internal |  | Do not set: the code sets it. |
| `PLCOS_INTERNAL_ROUTING_KEY` | internal |  | Do not set: the code sets it. |
| `NEXT_RUNTIME` | internal |  | Do not set: the code sets it. |
| `NEXT_PHASE` | internal |  | Do not set: the code sets it. |
| `POSTGRES_REHEARSAL` | never |  | **Never set** on Railway. |
| `PREVIEW_COPY_AT` | never |  | **Never set** on Railway. |
| `PGLITE_DIR` | never |  | **Never set** on Railway. |
| `ENRICH_DIR` | never |  | **Never set** on Railway. |
| `RAILWAY_RUN_UID` | railway | | `0` only if the volume is not writable by the image's user 10001 (code change 3); remove it once that change lands. |

**Steps, once:**

1. **Project.** New project, region US West. Plan: Pro (decision B). [`railway login`, `railway init`]
2. **Postgres.** Add → Database → PostgreSQL. In its settings, pin the image to version 17 and run
   `select version()` to confirm. Turn on its volume backups (daily). Leave the public TCP proxy on for
   now (cutover and pulls use it; decision G).
3. **Roles.** Connect as `postgres` [`railway connect Postgres`] and run:
   ```sql
   create role plcos_app login;  \password plcos_app
   create role plcos_ro login;   \password plcos_ro
   create database plcos_demo owner plcos_app;
   create database plcos_live owner plcos_app;
   ```
   `\password` asks for each password without showing it. Put the `plcos_app` one in the web service's
   `PGPASSWORD`. Keep the `plcos_ro` one only on the Mac, inside the pull URL (§6). This is the Mac's
   split: `plcos_app` owns everything, and `plcos_ro` reads (docs/21 "Roles").
4. **Web service.** Add → GitHub repo → this repo, branch `master`. Railway finds the `Dockerfile`. Settings:
   healthcheck path `/api/health`; restart on failure; memory limit 8 GB. Add a volume, mounted at `/app/data`,
   10 GB. Deploy only from GitHub, never `railway up` from a checkout: GitHub holds only tracked files, which
   is the same guarantee as rev 3's `git archive`, and the Dockerfile's guards still refuse any `data/` path.
5. **Variables** for the demo: `DATA_PROFILE=demo`, `DATABASE_URL` to `plcos_demo`, `PGPASSWORD`, plus code
   changes 1–3. Deploy.
6. **Check:** `/api/health` gives 200 and the demo pages load. Run `bash scripts/preflight.sh --dry` in the
   container [`railway ssh`].
7. **Deploys from then on:** Railway builds every push to `master`. Juan pushes only after
   `scripts/ship.sh` passes, as today. Rollback is one click: Deployments → an earlier one → Redeploy.

## 5. Moving the database (one evening, rehearsed first)

**Dakota never reaches Railway.** Rev 3's `cutover.sh` restored everything into the target, then stripped
Dakota there. On Railway that would put Dakota rows on Railway's disk, WAL and volume backups, even if only
for minutes. So strip on the Mac first, then move the stripped copy. Two hops, both with the existing
script, and no new code:

- **Hop 1 (Mac → Mac):** freeze the live database, copy it into an empty `plcos_stripped` on the Mac's own
  cluster, verify, strip Dakota (510 s in rehearsal 3), and stop copied jobs.
- **Hop 2 (Mac → Railway):** freeze `plcos_stripped`, copy it to Railway's empty `plcos_live`, verify for an
  exact MATCH, and apply [railway-grants.sql](../../scripts/railway-grants.sql). `--keep-dakota` here only
  skips a second strip, because there is nothing left to strip.

**Rehearse once,** into a scratch `plcos_rehearsal` on Railway, a week before. It measures the real network
times and checks code change 1 against Railway's certificate. Then drop it.

**The evening** (freeze to open: about 30–45 minutes, GUESS; the rehearsal replaces this number):

| Step | What | Time |
|---|---|---|
| a | No import job queued or running. Stop the Mac's Next server (not Postgres). `npm run backup -- event "pre-railway"`. | minutes |
| b | Hop 1: `bash scripts/cutover.sh run --from postgres://plcos_app@127.0.0.1:57433/plcos_live --to postgres://plcos_app@127.0.0.1:57433/plcos_stripped` | about 10 min (rehearsed) |
| c | Hop 2: `bash scripts/cutover.sh run --from …/plcos_stripped --to postgres://plcos_app@<proxy host>:<port>/plcos_live?sslmode=require --keep-dakota --grants scripts/railway-grants.sql` | 5–15 min, GUESS: the uncompressed rows go up Juan's home upload |
| d | Files: `bash scripts/cutover-files.sh pack ../plcos-data/real <outside>/files.tar.gz` (it leaves out the databases, `dakota/`, logs, snapshots and the research exports), then unpack it into `/app/data/real` through `railway ssh`. Runs alongside c. | 5–10 min, GUESS |
| e | Verify: c must say **MATCH**. `cutover-files.sh` checks its own archive. | in c |
| f | Variables: `DATA_PROFILE=real`, `DATABASE_URL` to `plcos_live`, the keys, sign-in; leave `SCHEDULE_DAILY_AT` unset. Redeploy. | 3 min |
| g | Smoke, as admin: `/today`, each vehicle's overview, pipeline, selection and strategy, `/orgs/g/lps`, `/developer/enrich`. Make one reversible note. Run **Export the research set**, which rebuilds the exports step d left out (149 s in rehearsal). Take the first backup by hand. | 15 min |
| h | On the Mac: drop the `moved-to-cloud` marker into `data/real` (code change 5). | 1 min |

Passwords for b and c: `cutover.sh` takes URLs without passwords. Use a temporary pgpass file made from the
Keychain (`PGPASSFILE=$(mktemp)`, mode 600) and delete it straight after.

If `railway ssh` can't stream a file into the container (check this in the rehearsal), put the archive in the
backup bucket under a one-day prefix, encrypted with a one-time passphrase (`gpg -c`), and fetch it from
inside the container with `aws s3 cp`.

**Rollback.** Before anyone writes on Railway: `bash scripts/cutover.sh unfreeze --db <Mac plcos_live>` and
restart the Mac server. After writes: `scripts/cutover-reverse.sh` from Railway into a new Mac database.
Keep the frozen Mac database and the pre-move backup for 14 days (decision H).

## 6. Local copies for testing (one way: cloud → Mac)

[scripts/cloud-pull.sh](../../scripts/cloud-pull.sh) pulls a fresh copy of the cloud database into its own
local cluster and serves the app on it:

```bash
bash scripts/cloud-pull.sh init  --to postgres://plcos@127.0.0.1:57434/plcos_copy   # once
bash scripts/cloud-pull.sh pull  --to postgres://plcos@127.0.0.1:57434/plcos_copy   # each time
bash scripts/cloud-pull.sh serve --to postgres://plcos@127.0.0.1:57434/plcos_copy   # from a dev worktree
```

- It reads the cloud as `plcos_ro`, over Railway's public proxy, so it **cannot** change the cloud. It refuses
  any other role off this machine. The pull URL is one Keychain item (`plcos-railway` / `pull-url`) and the
  copy cluster's password is another (`plcos-railway` / `copy`). Neither is printed or put on a command line.
- The copy lives in `plcos-data/real/cloud-copy/`, beside the real data. That cluster listens only on 127.0.0.1
  and has no Unix socket. The script refuses the Mac's live port (57433) and any database not named
  `plcos_copy…`. It restores into `plcos_copy_incoming`, checks the table count, and only then replaces the
  last copy. A failed pull leaves the previous copy in place.
- `serve` runs the app with `PREVIEW_COPY_AT` set to the time the copy was taken. The app then shows the copy
  banner, refuses every write, and runs no connector (the existing preview rules). It has no keys. It refuses
  to run in the live folder.
- **Time, at today's size:** about 2–4 minutes (GUESS). Measured locally, the dump takes 15–17 s and the
  restore 40–45 s. Over the proxy, the rows come down uncompressed, so the download dominates (at 100 Mbit/s,
  about a minute).
- **Tested** on invented data only: the test cluster (:5434) and scratch clusters. That covered two pulls in
  a row, a failed pull that kept the last copy, a SCRAM-password cluster, every refusal, a pull as `plcos_ro`
  after `railway-grants.sql`, and `serve` (health 200, copy banner, no errors).

**The 25 GB under `plcos-data/real`:** most of it never moves. Two old PGlite snapshots (14 GB) and the old
PGlite database (6.9 GB) stay on the Mac until Juan deletes them. The Postgres cluster (2.3 GB) becomes the
frozen rollback copy. Dakota (50 MB) stays on the Mac. About 2.2 GB of working files move up once, at
cutover. A pull brings down **the database only**: almost every page reads only the database. If a local test
needs the files, take them from the nightly encrypted backup in S3 (§8). That needs the backup's private key on
the Mac (decision D).

## 7. Workflows: run in the cloud, see results on the Mac

- **Already in the server:** imports (child processes, one heavy job at a time), the Affinity and Linear
  syncs, the SPV derivation, the daily timer and the backup. On Railway they run as they do on the Mac.
- **Research (W1, W1c, W5):** the buttons on Developer → Enrichment call the Anthropic API from the server
  (workflow-api entry). They write the same files to the volume, and the existing importers take it from
  there. They need `ANTHROPIC_API_KEY`, from a workspace with a monthly limit (rev 3: $1,500, a GUESS).
- **Making a batch** is still a script (`scripts/enrich-batch.ts`). Run it in the container through
  `railway ssh` until a button exists. That button is the first workflow gap to close.
- **Where the files live: on the Railway volume.** The code reads and writes them as it does today, so the
  volume needs no code change. 2.2 GB fits, and the nightly backup carries them. S3 would mean rewriting every
  file reader, and listing 37K small files there is slow. Postgres would mean a migration for files that are
  mostly inputs and logs; promote a file into a table when the schema rule says so, not before.
- **Stays on the Mac:**
  - Dakota: the raw replica, its sync and its key (decision C).
  - Polaris, the PL warehouse: it signs in with Juan's own gcloud login, and its 369 MB of extracts in
    `enrich/warehouse` go up only if Juan says so (decision E).
  - The old PGlite files and snapshots.
- **Mac-side research workers** (Claude Code sub-agents, ChatGPT) stop writing real research at cutover. What
  they wrote would have to go up, and nothing goes up. If they are wanted later, add a narrow upload instead:
  an admin hands the cloud a finished findings file, and the cloud's own importer validates it. That carries
  inputs only, never database state (decision F).

**Why there is no two-way sync.** Both sides would take writes: notes, statuses, imports and the routes
derived from them. Merging means conflict rules for every table, tombstones for deletes, and replaying the
derived caches. Those are the hardest parts of a distributed system, and the audit log and approval tickets
would have to survive them too. One writer avoids all of it. **The cloud is the only source of truth.** A
local copy is a read-only preview that is thrown away at the next pull. Nothing on the Mac writes to the
cloud database. If the Mac needs to change something, it does it through the cloud app, like anyone else.

## 8. Backups

- **Railway's volume backups** on the Postgres service, daily. This is the fast restore. Check what the plan
  keeps.
- **The encrypted off-site copy:** `BACKUP_COMMAND="bash scripts/backup-service.sh"`, unchanged
  (service-backup entry). It runs `pg_dump` of the Railway database plus a tar of the working files, encrypts
  both to the GPG public key, uploads them to S3, and thins them with the Mac's retention policy and the
  300 GB cap. On Railway the AWS access comes from an IAM user limited to the bucket's `plcos-*` prefixes
  (`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`), because there is no role. The restore drill
  (`scripts/service-drill.sh`) already passed; repeat it once against a real Railway backup.
- **The Mac's daily backup** keeps covering what stays there (Dakota, the frozen copy) until decision H.

## 9. Cost (GUESS, from Railway's prices as remembered; check railway.com/pricing)

| Item | Rough monthly |
|---|---|
| Pro plan seat (includes $20 of usage) | $20 |
| Web service: about 1.5 GB average memory, more during imports; under half a vCPU on average | $15–30 |
| Postgres: about 1 GB memory, little CPU | $8–15 |
| Volumes and backups: about 15 GB | $2–5 |
| Egress: pulls (~1 GB each) and pages | $1–5 |
| **Railway total** | **about $35–65 a month** |

Outside Railway: the Anthropic API (capped by the workspace limit) and S3 (a few dollars).

## 10. Decisions for Juan

- **A. Sign-in.** Ask PL whether LabOS's cookie can reach an app on Railway (no code). If not, Google sign-in
  with an allowlist (1–2 days). *Recommend: ask PL today, and build Google sign-in if the answer is no or slow.
  Until then Railway runs the demo only.*
- **B. Plan.** Pro, so the service can have 8 GB and larger volumes, and the database gets backups.
  *Recommend Pro.*
- **C. Dakota.** Strip at the move and keep Dakota on the Mac (rev 3 decision 3), or ask Dakota whether a
  database Juan hosts on Railway counts as "our system". *Recommend strip now and ask. If they say yes,
  Dakota syncs straight into Railway with its own variables; nothing has to go up from the Mac.*
- **D. The bucket and the keys.** An S3 bucket in your AWS account, and an IAM user for Railway. Should files be
  pullable to the Mac? That needs a second backup key whose private half sits in the Mac Keychain, so the
  offline key stays offline. *Recommend: bucket yes; the second key only when a local test needs the files.*
- **E. Which files go up.** The Polaris extracts (`enrich/warehouse`, 369 MB), and whether to scan
  `enrich/raw`, `enrich/batches` and `prospects/` for Dakota-derived fields first (open since 30 Sep).
  *Recommend: run the scan (counts only), and leave the Polaris extracts on the Mac.*
- **F. Mac research workers after the move.** Stop them and use the cloud API jobs, or add the findings
  upload later. *Recommend: API jobs first; build the upload only if subscription-run workers are clearly
  cheaper.*
- **G. The public database proxy.** Leave it on, so pulls work any time (password, read-only role), or turn it
  on only while pulling. *Recommend on, with a long random `plcos_ro` password; turn it off if it's ever
  unused for a month.*
- **H. Rollback window.** 14 days for the frozen Mac database, then the Mac's real backups stop. *Recommend 14.*
