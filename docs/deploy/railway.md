# Capital OS on Railway (3 Oct 2026; decisions 4 Oct)

Juan, 3 Oct: deploy to Railway to manage his own infra, move the database off the Mac, keep a quick local
copy for testing, and run workflows in the cloud with results synced down. This replaces PL's LabOS app
as the target. Almost everything built for [rev 3](rev3.md) carries over: the image, the import child
process, the daily timer and `cutover.sh`.

**The rules:**
- One web service and one Postgres. Nothing else until something measured needs it.
- **Our API is the only door** (Juan, 4 Oct). The database has no public port. Pulls, pushes and
  sign-ins go through the app, which checks who is asking and logs it. One-off admin work (the move, a
  rollback) goes through Railway's SSH, which only Juan's keys open.
- **Secrets live in the app** (Juan, 4 Oct; MailGuard's design). Only two values sit outside it:
  - `PLCOS_SECRET`, the key that encrypts the stored secrets and signs sessions;
  - the database connection.
  Everything else is entered in `/setup` or in Settings, encrypted in the database. This covers the
  Google client, the connector keys, the Anthropic key and the tokens.
- The cloud is the only writer of its database.

## 1. The shape

| Part | What | Notes |
|---|---|---|
| **Web service** | Built from GitHub with the existing `Dockerfile`: `next build`, then `next start` (the production build; see the page-speed and prod-build changelog entries); `railway.json` sets the healthcheck and one replica | Import jobs run as child processes of this server, as on the Mac. The daily timer runs inside it too. No worker or cron service, no Redis. |
| **Volume** on the web service | Mounted at `/app/data`; working files in `/app/data/real` | About 2.2 GB today: research (`enrich/`, 2.1 GB, 37K files), issues, materials, intake, workflow ledger. Start at 10 GB. |
| **Postgres 17** | Railway's template, pinned to 17 to match the Mac; private network only | The only copy of the real data after cutover. The Mac's cluster is 2.3 GB on disk; the last measured dump was 190–222 MiB (28 Sep). |
| **Size** | Railway Pro (Juan upgraded on 5 Oct): app volume 10 GB, Postgres volume 20 GB (resized in the dashboard; neither the API nor the CLI can), 8 GB memory and 8 vCPU per service. Pro bills for the GB used, not the capacity. | Measured (06-measurements): the server peaks at 1.25 GiB under 10 users, the findings import child at 2.43 GiB. Memory limit at least 4 GB, ideally 8. |

The Mac becomes a development machine. It serves demos and previews of pulled copies (§6), and runs local
research that pushes its results up (§7). Dakota moves to the cloud with everything else (decision C).

## 2. What to build before the first real deploy

| # | Change | State |
|---|---|---|
| 1 | **Settings, `/setup` and Google sign-in** (§3), copied from MailGuard. Also replaces "this is the live server" (it keyed on `LABOS_ME_URL`) with a deployed sign-in being on, and lets the real profile use a remote database once it is. | **Done** (branch `claude/railway-setup`, migration platform 018) |
| 2 | **Pull and push through the API** (§6, §7): an admin's snapshot token streams a database dump down; a push token sends finished research files up for the cloud's own importers. `cloud-pull.sh` switches to it. | **Built** on `claude/cloud-sync` (§7a), not merged |
| 3 | **Database TLS on the private network.** Off loopback the app demands a verifiable certificate; `*.railway.internal` has none, and Railway encrypts that network with WireGuard. | **Done** (`lib/db/postgres.ts`) |
| 4 | **Commit for the build.** The Dockerfile now also accepts Railway's `RAILWAY_GIT_COMMIT_SHA`. | **Done** |
| 5 | **Volume owner.** Railway mounts volumes as root, and the image runs as uid 10001. With `RAILWAY_RUN_UID=0` (Railway's documented switch), `scripts/docker-entrypoint.sh` starts as root only to hand `/app/data` to 10001, then drops to it. Elsewhere the image still starts as 10001. | **Done** |
| 6 | **The Mac stops being live.** `npm run dev:real` refuses once `data/real/moved-to-cloud` exists. | **Done** (`scripts/serve.ts`) |

Also fixed: `pg-verify` hashed rows as text in each server's own time zone. A Los Angeles cluster and a
UTC one could never match, so every cutover off the Mac would have stopped. It now pins UTC, as `pg-copy`
does.

## 3. Settings, `/setup` and sign-in (decided 4 Oct)

Juan, 4 Oct: Google OAuth, "just copy that flow" from MailGuard; and all secrets configurable inside the
app, with a `/setup` that guides you from scratch. The design, adapted from MailGuard (which uses SQLite)
to our Postgres:

- **The key.** `PLCOS_SECRET` (32+ random bytes, base64), set as a sealed Railway variable. Each purpose
  gets its own subkey through HKDF-SHA256. Secrets are encrypted with AES-256-GCM; sessions and the OAuth
  state are signed with HMAC. If `PLCOS_SECRET` is unset, the app makes one on the volume, and Settings
  recommends moving it into the variable.
- **Stored secrets.** One `platform.setting` table, with each secret encrypted on its own. A registry names
  every setting: label, secret or not, validation, and the environment variable that overrides it. An env
  value always wins, so the Mac's Keychain wrappers keep working. Each connector declares its own setting
  inside its own folder, so the boundaries hold. A stored secret is never shown again: the UI shows `••••`
  plus its last four characters, with **Replace** and **Remove**. Every change is audit-logged by field
  name, never by value.
- **`/setup`.** It stays open until Google sign-in is configured. On boot the server prints a one-time code
  in its log; Railway's Deploy Logs show it. Wrong codes are rate-limited. The steps:
  1. The public address, taken from Railway's domain.
  2. The Google OAuth client, with the console steps and a copyable redirect URI.
  3. The first admin's email.
  4. Optionally: Affinity, Linear and Anthropic.

  Then "Continue with Google". After that, `/setup` says it's set up, and the rest lives in Settings →
  Connections. It warns when no volume is mounted at the data folder.
- **Sign-in.** Google with PKCE and a signed state cookie, MailGuard's flow:
  - It accepts only a verified email from a Google Workspace account that matches an active
    `platform.app_user`. There is no self-sign-up.
  - The session is a signed cookie with a per-user epoch, so an admin can sign someone out everywhere.
  - Cookie-acting route handlers refuse cross-site POSTs.
  - Roles stay as they are. The local switcher never serves real data on a public URL.
  - MCP tokens are bearer tokens and keep working. Point `claude mcp add` at the new URL.
- **Other Workspaces (Juan, 4 Oct).** The deploy runs on the plcapital.xyz Workspace. Google's consent screen
  decides who reaches sign-in: **Internal** admits only that Workspace's accounts; **External** in Testing admits
  up to 100 listed test users (their consent lapses after 7 days, harmless here since no refresh token is kept);
  External **in production** needs no verification for name, email and profile only. Our own checks stay the
  same whichever is chosen: on the roster, a verified address, `hd` equal to its domain unless allowed.
- **Setup never reopens (5 Oct, security review).** Finishing it writes `setup.completedAt`; after that a lost
  or rotated `PLCOS_SECRET`, or a removed Google client, does not reopen it. An admin re-enters Google in
  Settings → Connections; if nobody can sign in, the two `GOOGLE_SIGNIN_` variables on the service win and let
  an admin in. A deployed server with no `PLCOS_SECRET` and no volume at the data folder refuses to start.
  Settings are read-only under the Mac's user switcher.
- **As built (4 Oct).** Which sign-in a server uses is `config/sign-in.ts`: Google when the image says so
  (`PLCOS_DEPLOYED=1`, set in the Dockerfile) or Railway's variables are present, LabOS with `LABOS_ME_URL`,
  the switcher on the Mac. The sign-in client lives in its own connector, `lib/connectors/google-signin`
  (openid, email and profile only; the removed Gmail OAuth client's variables stay forbidden), with new
  variable names `GOOGLE_SIGNIN_CLIENT_ID` / `_SECRET` for when the environment should win. Mailguard's
  address is a setting too; each person's mailguard key is still theirs, and a Railway server has no store
  for it yet.

## 4. Setting it up

**Variables.** `npx tsx scripts/railway-env.ts` prints this table from
[service.env.example](service.env.example). Only `PLCOS_SECRET` and the database connection are entered here;
the rest are entered in the app (/setup, then Settings → Connections). Seal the secret ones. Never put a value in chat, a file, a commit or this doc.

| Variable | Tag | Secret | On Railway |
|---|---|---|---|
| `DATA_PROFILE` | required |  | `demo` for the first boot, `real` at cutover. |
| `LABOS_ME_URL` | optional |  | Leave unset: sign-in is Google (§3). |
| `PLCOS_SECRET` | required | yes | `openssl rand -base64 32`, sealed. One of the two values that live outside the app; keep a copy in a password manager (§8). |
| `PLCOS_PUBLIC_URL` | optional |  | Leave unset: /setup fills it from Railway's domain. |
| `GOOGLE_SIGNIN_CLIENT_ID` | optional |  | Leave unset: enter it in /setup (then Settings → Connections), encrypted with PLCOS_SECRET. An env value still wins. |
| `GOOGLE_SIGNIN_CLIENT_SECRET` | optional | yes | Leave unset: enter it in /setup (then Settings → Connections), encrypted with PLCOS_SECRET. An env value still wins. |
| `PLCOS_SIGNIN_DOMAINS` | optional |  | Leave unset (empty is right unless the Workspace signs in with an alias domain). |
| `PLCOS_TRUSTED_PROXY_HOPS` | optional |  | Leave unset: 1, Railway's edge. The rehearsal confirms it (§4 step 5). |
| `DATABASE_URL` | required |  | `postgresql://plcos_app@${{Postgres.RAILWAY_PRIVATE_DOMAIN}}:5432/plcos_demo` first, then `…/plcos_live`. No password in it. |
| `PGPASSWORD` | optional | yes | The `plcos_app` password you set on Railway Postgres (§4 step 2). One of the two secrets that live outside the app. |
| `PGSSLMODE` | optional |  | Leave unset on the private network (code change 1). |
| `AFFINITY_API_KEY` | optional | yes | Leave unset: enter it in the app (/setup, then Settings → Connections), encrypted with PLCOS_SECRET. An env value still wins. |
| `LINEAR_API_KEY` | optional | yes | Leave unset: enter it in the app (/setup, then Settings → Connections), encrypted with PLCOS_SECRET. An env value still wins. |
| `DAKOTA_USERNAME` | optional |  | Leave unset: enter it in Settings → Connections, encrypted with PLCOS_SECRET (decision C: Dakota moves to the cloud). An env value still wins. |
| `DAKOTA_PASSWORD` | optional | yes | Leave unset: enter it in Settings → Connections, encrypted with PLCOS_SECRET. An env value still wins. |
| `CLOUDSDK_AUTH_ACCESS_TOKEN` | never |  | **Never set** on Railway. |
| `MAILGUARD_URL` | optional |  | Leave unset: enter it in Settings → Connections. An env value still wins. |
| `MAILGUARD_TOKEN` | never | yes | **Never set** on Railway. |
| `ANTHROPIC_API_KEY` | optional | yes | Leave unset: enter it in the app (/setup, then Settings → Connections), encrypted with PLCOS_SECRET. An env value still wins. |
| `ANTHROPIC_MODEL` | optional |  | Leave unset (the default works). |
| `FEEDBACK_EXPORT_TOKEN` | optional | yes | Leave unset: enter it in Settings → Connections, encrypted with PLCOS_SECRET. An env value still wins. |
| `SCHEDULE_DAILY_AT` | later |  | `03:00` (UTC), the day after a manual Affinity sync works from Railway. |
| `PAGE_WARM` | optional |  | Leave unset (the default works). |
| `BACKUP_COMMAND` | required-real |  | Leave unset: no S3 for now. Railway backs up its volumes, and the Mac keeps encrypted pulls (§8). |
| `BACKUP_BUCKET` | required-real |  | Leave unset (no S3 for now, §8). |
| `BACKUP_GPG_PUBLIC_KEY` | required-real | yes | Leave unset (no S3 for now, §8). |
| `AWS_REGION` | optional |  | Leave unset (no S3 for now, §8). |
| `AWS_ACCESS_KEY_ID` | optional | yes | Leave unset (no S3 for now, §8). |
| `AWS_SECRET_ACCESS_KEY` | optional | yes | Leave unset (no S3 for now, §8). |
| `BACKUP_DRY_RUN` | optional |  | Leave unset (the default works). |
| `BACKUP_KEEP_DIR` | optional |  | Leave unset (the default works). |
| `NODE_ENV` | image |  | Do not set: the Dockerfile sets it. |
| `NEXT_DIST_DIR` | image |  | Do not set: the Dockerfile sets it. |
| `PORT` | image |  | Do not set: Railway sets it, and the image listens on it. |
| `NODE_EXTRA_CA_CERTS` | image |  | Do not set: the Dockerfile sets it. |
| `PGSSLROOTCERT` | image |  | Do not set: the Dockerfile sets it. |
| `GIT_COMMIT` | image |  | Build argument; code change 2 takes it from Railway's commit variable. |
| `PLCOS_DEPLOYED` | image |  | Do not set: the Dockerfile sets it (Google sign-in, never the user switcher). |
| `RAILWAY_PUBLIC_DOMAIN` | platform |  | Do not set: Railway sets it. |
| `RAILWAY_ENVIRONMENT_ID` | platform |  | Do not set: Railway sets it. |
| `RAILWAY_PROJECT_ID` | platform |  | Do not set: Railway sets it. |
| `RAILWAY_VOLUME_MOUNT_PATH` | platform |  | Do not set: Railway sets it. |
| `PLCOS_IMPORT_WORKER` | internal |  | Do not set: the code sets it. |
| `PLCOS_INTERNAL_ROUTING_KEY` | internal |  | Do not set: the code sets it. |
| `NEXT_RUNTIME` | internal |  | Do not set: the code sets it. |
| `NEXT_PHASE` | internal |  | Do not set: the code sets it. |
| `POSTGRES_REHEARSAL` | never |  | **Never set** on Railway. |
| `PREVIEW_COPY_AT` | never |  | **Never set** on Railway. |
| `PGLITE_DIR` | never |  | **Never set** on Railway. |
| `ENRICH_DIR` | never |  | **Never set** on Railway. |
| `SYNC_DEMO_SNAPSHOT` | never |  | **Never set** on Railway. |
| `RAILWAY_RUN_UID` | railway | | `0`: the entrypoint starts as root only to hand `/app/data` to user 10001, then drops to it (§2). |

**Steps, once:**

1. **Postgres.** In Juan's Railway project: Add → Database → PostgreSQL. Pin the image to 17 **before first use**: the
   template now defaults to 18 (5 Oct 2026), and the image's pg_dump 17 can't dump an 18 server (snapshots, pulls,
   backups). Set the source image to `ghcr.io/railwayapp-templates/postgres-ssl:17`, with a fresh volume if 18 already
   ran, and run `select version()`. Volume backups: on since 5 Oct, daily at 22:15 UTC (kept 6 days) and weekly on Saturdays (kept 27
   days), billed at volume rates for what changed. **Remove its public TCP proxy** (Settings →
   Networking).
2. **Roles,** from a shell in the web service (`railway ssh`, then `psql` as `postgres`):
   ```sql
   create role plcos_app login;  \password plcos_app
   create role plcos_ro login;   \password plcos_ro
   create database plcos_demo owner plcos_app;
   create database plcos_live owner plcos_app;
   ```
   `\password` asks for each password without showing it. This is the Mac's split: `plcos_app` owns
   everything, and `plcos_ro` only reads (docs/21 "Roles").
3. **Web service.** Add → GitHub repo → this repo, watching a `deploy` branch (Settings → Source), so a
   release is a choice: `git push origin master:deploy` (MailGuard's practice). Add a volume at `/app/data`:
   10 GB, holding today's ~2.2 GB of working files. The web service is named `plcos-app`, so CLI commands take
   `--service plcos-app`. Then set the variables:
   - `RAILWAY_RUN_UID=0`;
   - `PLCOS_SECRET` (`openssl rand -base64 32`, sealed);
   - `DATABASE_URL` pointing at `plcos_demo`, with `PGPASSWORD`;
   - `DATA_PROFILE=demo`.

   Check that a push actually starts a build: on 5 Oct the new service had no source trigger until it was
   reconnected (Settings → Source shows the repo and the `deploy` branch). Deploy only from GitHub, never `railway up` from a checkout. GitHub holds only tracked files, and the
   Dockerfile's guards still refuse any `data/` path.
4. **Networking → Generate Domain.** Open `https://<domain>/setup`, enter the code from the Deploy Logs, and
   follow the page. It shows the redirect URI to add to the Google OAuth client.
5. **Check:** `/api/health` gives 200, sign-in works, and the demo pages load. Run
   `bash scripts/preflight.sh --dry` through `railway ssh`.
   **Also confirm how Railway's edge sets `X-Forwarded-For`.** The setup-code limits count wrong codes by the
   address the outermost trusted proxy appended (`PLCOS_TRUSTED_PROXY_HOPS`, default 1, a GUESS). Send a request
   with a made-up `X-Forwarded-For: 192.0.2.1` and check that the audit row of a wrong code names your real
   address, not 192.0.2.1. If it does not, set the hop count in Settings → Connections.
6. **Deploys from then on:** Juan fast-forwards `deploy` after `scripts/ship.sh` passes. Rollback is one
   click: Deployments → an earlier one → Redeploy.

## 5. Moving the database (one evening, rehearsed first)

**No public port, even for the move.** Railway's SSH forwards ports (docs.railway.com/cli/ssh), so the Mac
reaches Postgres through a tunnel that only Juan's SSH key opens. The tunnel goes into Postgres's own
container and its loopback. It was tested on 5 Oct: `pg_isready` said "accepting connections":
`ssh -N -L 55432:127.0.0.1:5432 <postgres service instance>@ssh.railway.com`. Railway's `scp` reaches a
container's filesystem, including its volume, which is how the working files go up to `plcos-app`. The
fallback is the Postgres TCP proxy, turned on for that hour only.

**Dakota moves too (decision C, Juan 4 Oct: "it should be our db same way as pl's warehouse").** So it
is one hop, Mac → Railway through the tunnel. `cutover.sh` freezes, dumps, restores, verifies for an exact
MATCH, and applies [railway-grants.sql](../../scripts/railway-grants.sql). `--keep-dakota` skips the strip
that rev 3 needed. Dakota's raw replica (`dakota/`, 50 MB) goes up with the working files. The cloud's Dakota
sync then carries on from the last pull, with the Dakota sign-in entered in Settings.

**Rehearse once, from a copy, never from live.** `cutover.sh run` always freezes its source, and it has no rehearsal
flag. So:
1. Dump live with `pg_dump -Fc` as `plcos_ro`. It reads one consistent snapshot without freezing anything.
2. Restore the dump into `plcos_rehearsal_src` on the Mac cluster.
3. Run `cutover.sh` from that copy to an empty `plcos_rehearsal` on Railway, through the tunnel. Rehearse the
   file pack and `scp` the same way, into a scratch path.
4. Record the times, then drop both databases and delete the dump (kept in `plcos-data/real/rehearsal/` meanwhile).

Check that a plain (non-TLS) `psql` connects through the tunnel: `pg_isready` doesn't authenticate.

**The client address behind Railway's edge: two hops (confirmed 5 Oct).** With one trusted hop, the audit log recorded
one of Railway's edge servers, shared by many clients. `PLCOS_TRUSTED_PROXY_HOPS=2` is set on `plcos-app`. A sign-in
refusal carrying a forged `X-Forwarded-For: 203.0.113.9` was audited with the client address from Railway's HTTP log,
not the forged one. So the limits and the audit rows name the real client and can't be forged.

**Done on 5 Oct 2026.**
- The rehearsal took 741 s, then the move 789 s; both said MATCH: 135 tables, 1,609,149 rows, 6 sequences, and every
  view, function, trigger, index and constraint.
- The live Mac server was stopped at 08:45 UTC, and `moved-to-cloud` was set at once.
- The frozen Mac `plcos_live` is kept until 19 Oct.

**The evening, as measured** (freeze to open was about 45 minutes, most of it the restore over the tunnel):

| Step | What | Time |
|---|---|---|
| a | No import job queued or running. Stop the Mac's Next server only (`npm run dev:stop` would stop Postgres too). `npm run backup -- event "pre-railway"`. Open the tunnel. | minutes |
| c | `bash scripts/cutover.sh run --from postgres://plcos_app@127.0.0.1:57433/plcos_live --to postgres://plcos_app@127.0.0.1:55432/plcos_live --keep-dakota --grants scripts/railway-grants.sql` | 789 s measured, with the restore through the tunnel ~11–12 min of it |
| d | Files: `bash scripts/cutover-files.sh pack ../plcos-data/real <outside>/files.tar.gz` (Dakota's replica included; it leaves out the databases, logs, snapshots and the research exports), `scp` it up, and unpack it into `/app/data/real` with `railway ssh`. Runs alongside c. | 37,914 files: pack 42 s (554 MiB), scp 235 s (~2.4 MB/s), unpack 15 s |
| e | c must say **MATCH**; `cutover-files.sh` checks its own archive. Close the tunnel. | in c |
| f | Before switching, copy the settings Juan entered in `/setup` on the demo: `pg_dump --data-only -t platform.setting plcos_demo \| psql plcos_live` through the tunnel. Same `PLCOS_SECRET`, and the encryption binds only each setting's name, so they decrypt; the setup-done marker comes along, so no `/setup` reopens. Then `DATA_PROFILE=real`, `DATABASE_URL` pointing at `plcos_live`, and redeploy. **The files (d) must be on the volume first**: the real profile loads `/app/data/real/init.jsonc` at boot, and the redeploy's entrypoint hands the root-owned unpacked files to uid 10001. Add the missing connector keys in Settings → Connections. Leave the daily schedule off. | 10 min |
| g | Smoke, signed in as admin: `/today`, each vehicle's overview, pipeline, selection and strategy, `/orgs/g/lps`, `/developer/enrich`. Make one reversible note. Run **Export the research set** (149 s in rehearsal). Pull a first copy to the Mac (§6). | 15 min |
| h | On the Mac: `touch data/real/moved-to-cloud` in the live folder. | 1 min |

**Before the evening: every team member's addresses.** Google sign-in admits an active person signing in with
any of their addresses (`platform.user_address`, migration 019): the `login` (the Google sign-in, for example
someone@plcapital.xyz), the default-to `email` (the one we email them at) and any `aliases`, all set in
`data/real/init.jsonc`. On the Mac's live server:
- give each team member their `login` and `aliases` in the init file, and load it (Developer → Data); an address
  listed on two people, or already someone else's, is reported and nothing is applied;
- check each team row has an address they sign in with (counts and handles only);
- or plan to fix them in Settings → People right after step f.

Passwords for b and c: `cutover.sh` takes URLs without passwords. Use a temporary pgpass file made from the
Keychain (`PGPASSFILE=$(mktemp)`, mode 600), and delete it straight after.

**Rollback** (14 days, decided 4 Oct). Before anyone writes on Railway, unfreeze the Mac and restart it:
`bash scripts/cutover.sh unfreeze --db <Mac plcos_live>`, remove the marker. After writes, run
`scripts/cutover-reverse.sh` from Railway into a new Mac database, through the tunnel. Keep the frozen Mac
database and the pre-move backup for 14 days.

## 6. Local copies for testing (cloud → Mac, through the API)

[scripts/cloud-pull.sh](../../scripts/cloud-pull.sh) puts a fresh copy of the cloud database into its own
local cluster and serves the app on it:

```bash
bash scripts/cloud-pull.sh init  --to postgres://plcos@127.0.0.1:57434/plcos_copy          # once
bash scripts/cloud-pull.sh pull  --to postgres://plcos@127.0.0.1:57434/plcos_copy --keep   # daily
bash scripts/cloud-pull.sh serve --to postgres://plcos@127.0.0.1:57434/plcos_copy          # from a dev worktree
```

- **Down through our API.** `pull` asks `GET /api/sync/snapshot` with an Admin's snapshot token. The server
  runs `pg_dump -Fc` against its own private database and streams the dump. The token is minted in
  Preferences → MCP access and kept in one Keychain item, `plcos-railway / snapshot-token`; the app's address
  is `--from`, `CLOUD_APP_URL` or the item `plcos-railway / app-url`. Each pull is audit-logged (§7a).
- **`--keep` is the off-site copy** (decision D). It also fetches the working files (`?files=1`), then packs
  the dump and the files into one archive and encrypts it into `~/plcos-backups` with `backup-real.sh`'s
  method and passphrase, as `plcos-cloud-<time>-daily.tar.gz.gpg`. `backup-prune.py` thins these with the
  Mac's own backups. Restore with `npm run backup:restore -- <file> <empty dir>`; it holds
  `cloud/database.dump` and `cloud/files.tar.gz`. The archive is kept before the restore, so a failed restore
  still leaves it.
- **The copy is a preview.**
  - It lives in `plcos-data/real/cloud-copy/`, in a cluster that listens only on 127.0.0.1.
  - It replaces the last copy only after the new one restores and checks out.
  - `serve` sets `PREVIEW_COPY_AT`, so the app shows the copy banner, refuses every write and runs no
    connector.
- **Time at today's size:** about 2–4 minutes (GUESS). Locally, the dump takes 15–17 s and the restore 40–45 s.
- **Files:** most pages read only the database, so a pull without `--keep` brings the database alone. The
  files archive leaves out what cutover leaves out: the server reads `cutover-files.sh`'s own three lists on
  each request (the databases, logs, snapshots, copies and the regenerated research exports), so what moves
  up at cutover is what a pull brings down. About 2.2 GB raw today.
- **Dakota comes down too** (Juan, 4 Oct: the cloud database "should be our db same way as pl's warehouse"):
  the cloud and a pulled copy are both our system. MCP and every agent-facing answer still withhold licensed
  Dakota values (the GP view, docs/26).
- **Tested** on invented data only: the property suite pulls the route's dump through `cloud-pull.sh` into a
  scratch cluster on a free port, compares every table's row count (130 tables, all equal), and opens the
  `--keep` archive with its passphrase. Never the live cluster or real data.
- **The 25 GB under `plcos-data/real`** mostly never moves:
  - The old PGlite snapshots (14 GB) and database (6.9 GB) stay until Juan deletes them.
  - The Postgres cluster (2.3 GB) becomes the frozen rollback copy.
  - About 2.2 GB of working files move up once.

**The daily pull (5 Oct).** The Mac's daily loop runs from the live checkout: once a day,
`bash scripts/cloud-pull.sh pull --to postgres://plcos@127.0.0.1:57434/plcos_copy --keep` (log in
`~/.plcos-helpers/backups.log`). It replaced the old Mac backup loop, since the Mac's own database is frozen.
- Its Keychain items (`plcos-railway` / `snapshot-token`, `app-url`, `copy`) are readable without a prompt, so it
  runs unattended. Juan, 5 Oct: "Don't need to ask for this". This is a deliberate exception to the "every read
  asks" rule for these items only.
- `--keep` never deletes a backup.

## 7. Workflows: in the cloud and on the Mac (decided 4 Oct)

Juan, 4 Oct: "we should be able to run research from both cloud and local … run those research agents here
and push up results".

- **In the cloud:**
  - What already runs in the server: imports, the Affinity and Linear syncs, the SPV derivation and the
    daily timer.
  - The W1, W1c and W5 buttons call the Anthropic API, with the key entered in Settings.
  - Making a batch is still a script. Run it with `railway ssh` until a button exists.
- **On the Mac:**
  - Claude Code sub-agents and ChatGPT run research against a pulled copy, which includes Dakota, plus
    Polaris with Juan's gcloud login, which stays on the Mac.
  - They **push the results up** with `bash scripts/cloud-push.sh [--run <Mac ledger run>] <file>…` and a
    push token (a GP's or an Admin's, Keychain item `plcos-railway / push-token`). A push carries only the
    finished files W1, W1c and W5 already write (findings, a review with its corrected findings, strategies),
    never database rows.
  - **Prospects** (5 Oct): `bash scripts/cloud-push.sh prospects <file.jsonl>…` sends researched LPs in the
    format of `docs/prospects-import.md`. The cloud runs Add prospects on them as you, so the pursuits are
    yours, and the script prints the counts. A vehicle made on the cloud (Settings → Vehicles) is not on the
    Mac yet: check the file first with `scripts/prospects-check.ts --vehicle <slug> <file>`.
  - The cloud checks each file with the importers' own validators, files it under `enrich/inbox/<run>/`,
    records a ledger run, and imports it the usual way. A rejected file comes back with the reason.
  - A claim sourced from Dakota is validated like any other (Juan, 4 Oct: the cloud is our system, as PL's
    warehouse is). Its private fields still never go to an outside service, a web search or an agent's
    prompt; pushes stay between our own Mac and our own cloud.
- **Where the files live: on the Railway volume,** read and written as today, with no code change.

### 7a. The pull and push API (built 4 Oct, `claude/cloud-sync`)

- **Tokens.** Two scopes in the MCP token model, beside the outreach scopes: `sync:snapshot` and `sync:push`
  ride in `platform.mcp_token.tools` (`lib/sync/scopes.ts`). Each endpoint declares a policy like an MCP tool
  (risk, scopes) and is checked by the registry's own `allowed`. Who may hold a scope is data too: snapshot
  Admin only, push GP or Admin. That is checked when the token is made (Preferences, and the service) and on
  every use against the owner's access then. A sync token holds its scope alone, so it lists and calls no MCP
  tool. Hashed at rest, revocable, with an expiry and last use, like every token. Every use is one
  `mcp.call` row in the audit log, `via: sync`, the shape of MCP and outreach calls; a revoked or expired
  token is `mcp.refused`. No browser requests: any `Origin` is refused.
- **`GET /api/sync/snapshot`.** `pg_dump -Fc` of the server's own `DATABASE_URL`. The password goes to
  `pg_dump` only in its environment, never on its command line, and the child gets no other variable of the
  server's. `?files=1` streams a gzipped tar of the data root instead. One at a time: 409 while one streams.
  The status waits for the first bytes, so a dump that fails at once is a 500 with a reason; one that fails
  later cuts the body short, which curl reports and the pull refuses. Refused on a preview copy, on a
  real-profile server that is not the live one, and on the demo unless `SYNC_DEMO_SNAPSHOT=1` (tests only).
- **`POST /api/sync/push`.** `{ workflow: W1 | W1c | W5, files: [{ path, content }], run? }`, paths as under
  `enrich/` (20 MB and 500 files at most, GUESSES). All-or-nothing: shape, paths, the importers' validators
  (`check`, `checkStrategy`, the W1c review rows), then against what the server holds.
  An older finding or strategy never replaces a newer one. A review is graded against the server's finding.
  A review file name is never reused for other rows. A refusal (422) lists every reason by file and writes
  nothing. An accepted push (201) is kept as received under `enrich/inbox/<run>/` (with any file it replaces
  under `replaced/`) and published where the workflow writes. It is recorded as a ledger run (operation
  `push`, the Mac's run as parent) and queues the findings import as the token's owner. Idempotent by
  content hash (`platform.sync_push`): the same content again answers the first run (200, `duplicate`) and
  writes nothing.
- **A prospects push** (5 Oct): `{ workflow: "prospects", files: [{ path: "prospects/<name>.jsonl", content:
  "<the file's text>" }] }`. The text travels as written, so line numbers are the file's. Every line passes the
  importer's own row checks (`lib/enrich/prospect-rows.ts`, the ones `scripts/prospects-check.ts` runs), every
  `vehicle` is a slug the server has, and a Team member's rows name only vehicles they may change. One failing
  line refuses the whole push (422, `line N: reason`) and writes nothing. Accepted, the file is kept under
  `enrich/inbox/<run>/` and written to `enrich/prospects/<date>-push-<run>-<name>.jsonl`, a new name each run,
  by a hard link that fails rather than replace a file. Then the prospects import is queued as the token's
  owner, the job Developer → Enrich → Add prospects queues, so each new pursuit is theirs. The importer reads
  only files unchanged for two minutes, since someone may still be writing a file placed by hand. The push
  names its own files in the job, and only those skip the wait. The server wrote them whole before queueing,
  and every other file still waits, even one a job names. A running prospects import refuses a push (409)
  before anything is written. Same scope, `sync:push`: a prospects push is one more set of finished files for
  the server's own importer, like a W1 push, with the same holders and audit.
- **`GET /api/sync/push?job=<id>`** answers the person who pushed: the import's status, phase and counts
  (added, existing, ambiguous, invalid, in progress, …), plus how many of their own file's rows won or lost
  against other files. Counts only, never names. Anyone else gets a 404. `cloud-push.sh` asks it for up to two
  minutes after a prospects push; `cloud-push.sh status <id>` asks again later.

- **A W13 push** (7 Oct): `{ workflow: "W13", files: [{ path: "identity-decisions[-<name>].jsonl", content: [rows] }] }`.
  Every row passes the merge's own decision validator; accepted rows are appended to `enrich/identity-decisions.jsonl`
  (append-only, a row already there is skipped). No import is queued: an Admin applies them with Merge duplicate
  identities, which judges each row against the identities then.

- **Retiring a strategy file** (8 Oct). A W5 push file whose content is `{ "retire": true, "reason": "…" }` removes
  the server's strategy file at that path, keeping it under the push's `inbox/<run>/replaced/`, and queues the import. A path
  with no file, a missing reason or any other field is refused. Use it for a second file on one LP and vehicle (the
  import refuses both) and for orphan files.
- **`POST /api/sync/vehicles`** (6 Oct; Juan: "i really want you to be able to do this"). An Admin adds a vehicle
  by token, so Claude can add one without anyone clicking through Settings → Vehicles. One JSON object (`name`,
  `slug`, `kind`, `exemption`, optional `phase`, `target`, `opens`, `closes`, `aliases`; 4 KB at most; an unknown
  field is 422) goes to `createVehicle`, the form's own writer, so its checks hold: Admin only, the exemption never
  defaulted, a taken slug or name refused (409) and never updated, one `vehicle.created` audit row. It needs the
  Admin scope, `sync:admin`. Nothing removes a vehicle this way.
- **`PATCH /api/sync/vehicles`** (8 Oct; Juan: "move date to Oct 9"). An Admin moves an existing vehicle's raise
  window, `{ slug, opens, closes, note }` (`scripts/cloud-vehicle.sh --window`), and nothing else about it. One
  `vehicle.raise_window` audit row; from then on an init reload and the Affinity translation leave that window alone.
- **The Admin scope, `sync:admin`** (7 Oct; Juan: "something w/ very broad perms"). Preferences offers it as
  "Admin". Only an Admin holds it, and it opens everything above (pull, push, the cloud ledger, adding a vehicle)
  plus each Admin task offered by token later, which takes this scope rather than one of its own. It is checked
  against the owner's access on every use, so a former Admin's token opens nothing. It is not the MCP tools or the
  outreach desk, and nothing under it sends, decides a ticket or moves money. `scripts/cloud-vehicle.sh
  <vehicle.json>` sends it with the Keychain's `push-token`.

- **`POST|GET /api/sync/jobs`** (7 Oct, `sync:admin`): queue a research export or a findings import, as the
  buttons in Developer → Enrichment do, and read any job's state (counts only). `scripts/cloud-job.sh export`, then
  `cloud-job.sh status <id>`; with a files snapshot the Mac then has the server's fresh `candidates.jsonl` for W5.
  A findings push that meets a running import queues one more run after it; a push and a status check first
  clear a job a restart stopped. A push that fails after it was checked says at which stage and what kind of
  error, and a ledger that will not take its finish no longer fails a push whose files are in place.

- **`GET|POST /api/sync/feedback`** (7 Oct, `sync:admin`; Juan: "do it the same way other services (like JuanMail
  and MailGuard are doing it)"): list the open feedback issues, read them with their screenshots, and set an
  issue's status. `scripts/cloud-feedback.sh`; details in `docs/deploy/07-feedback-signal.md` §6.

**Why this is not two-way sync.** Sync would merge two writable databases: conflict rules for every table,
deletes, and rebuilt caches. Here there is one writer. Copies come down as read-only previews. Results go up
as new input files, which the cloud validates and imports itself, exactly like a button press. Nothing on
the Mac ever writes the cloud database.

## 8. Backups (decided 4 Oct: no S3 for now)

- **Railway's volume backups,** daily, on Postgres and on the web volume, for a quick restore.
- **The Mac holds the off-site copy.** A daily `pull --keep` (§6) keeps the encrypted dump and working files
  in `~/plcos-backups`, with the Mac's existing encryption, retention and 300 GB cap. That covers losing the Railway project, which
  Railway's backups don't.
- **`PLCOS_SECRET`** goes in Juan's password manager too. Without it, a restored database's stored secrets
  can't be read; they have to be entered again.
- S3 (`backup-service.sh`) stays unused until the Mac stops being a reliable second home for backups.

## 9. Cost (GUESS, from Railway's prices as remembered; check railway.com/pricing)

| Item | Rough monthly |
|---|---|
| Web service: ~1.5 GB average memory, more during imports; under half a vCPU on average | $15–30 |
| Postgres: ~1 GB memory, little CPU | $8–15 |
| Volumes and backups: ~15 GB | $2–5 |
| Egress: daily pulls (~200 MB each) and pages | $1–3 |
| **Usage, on top of Juan's existing plan** | **about $25–55 a month** |

## 10. Decisions

| | Decision | Answer (4 Oct) |
|---|---|---|
| A | Sign-in | Google OAuth, MailGuard's flow; secrets set in the app through `/setup` |
| B | Plan | Juan's existing Railway plan, raised if needed |
| C | Dakota on Railway | Yes: "it should be our db same way as pl's warehouse". One-hop move; Dakota's sync runs in the cloud |
| D | S3 | Not now: Railway's backups plus the Mac's encrypted pulls |
| E | Polaris extracts and other working files go up | Yes: "its our own PL level deployment" |
| F | Research | Both cloud and Mac; the Mac pushes results up |
| G | Database port | None: pulls and pushes through our API; the move through Railway's SSH tunnel |
| H | Rollback window | 14 days |

**C: what we knew about Dakota when Juan decided.**
- No copy of Dakota's terms in the repo.
- Juan's rule (27 Sep): "should just go into our db".
- PL's warehouse on Google Cloud already holds Dakota data.

Juan, 4 Oct: Railway is "our db" the same way. Dakota's other rules stand, inside and outside the cloud:
read-only, only its connector talks to it, and its private fields never leave our system
(docs/agent-rules/real-data.md).
