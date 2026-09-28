# 01 — Deployment, secrets and the repo

Plan section, 28 Sep 2026. Sources are the LabOS starter kit v1.13
(`plcos-data/intake/ai-app-starter-kit-v1.13/`) and the app on master (`f2f7988`). One measurement was
taken for this plan: a demo-profile `next build` in an agent worktree, invented data only. Figures marked
GUESS are unmeasured.

## 1. What the kit / LabOS provides

**How a deploy works** (`deploy-to-labs/SKILL.md` steps 3–8, `app-logs/SKILL.md`):
- The agent zips `app/`, with the `Dockerfile` at the root, and POSTs it to `deployEndpoint`.
- PL builds the image with Kaniko and runs it as pods on EKS (the log group is `/eks/…`).
- Logs go to CloudWatch.
- The app lives at `https://<appId>.os.pl.xyz` and is shown in an iframe on `os.pl.xyz`.
- `appId` is global across all PL members.
- The same `appId` redeploys, with a fresh `deploymentId` each time.

**Deploy authorization** (README "How deploy authorization works", skill step 3):
- The agent starts a connect session, Juan opens the link, signs in to LabOS and clicks Approve.
- The agent gets a `plndeploy_…` token. It lasts about an hour, is tied to Juan (it needs
  `ai_apps.write`) and is held in memory only.
- There is no long-lived or CI token, so every deploy session needs a human click.

**The runtime contract** (kit `AGENTS.md` "Building the app", "Must be iframe-embeddable"):
- The app serves on `$PORT`, bound to `0.0.0.0`.
- `GET /health` returns 200, and `GET /` is usable.
- No `X-Frame-Options` header. Any CSP `frame-ancestors` must include `https://os.pl.xyz`.
- Every route must work on a hard load at its real URL.

**Resources** (kit `AGENTS.md` "Resource limits"):
- Runtime: **384Mi memory, 300m CPU**.
- Build: **2Gi memory, 1 CPU**.
- These are "a fixed platform default, not something you request". An OOM means the build fails or
  the app crash-loops. PL Infra is asked for more only for "a genuine, explainable need".
- The kit also says not to spawn extra worker threads or processes.

**Storage:** the kit never mentions a persistent volume. `db-migration` says file storage "needs an
external object store the member sets up separately". So treat the container disk as ephemeral:
lost on every redeploy or restart.

**Postgres** (skill "Apps that want a provisioned database", `db-migration` steps 4–6):
- Adding `database={"enabled":true,"type":"postgres"}` to the deploy provisions a dedicated RDS
  database and user.
- The app receives `DATABASE_URL` and `DB_*` variables. The password never appears in any response.
- SSL is required. Node `pg` needs `ssl: { rejectUnauthorized: false }`; `?sslmode=require` is
  ignored.
- The user is not a superuser and cannot create databases or roles. `CREATE TABLE` works.
- There is no platform migration step: the app applies its own schema at boot.
- The kit's data-copy runner assumes the old database is reachable from inside the container.

**Secrets** (skill "draft flow"):
- The agent registers a draft that lists `requiredEnvVars`. Juan types the values into a LabOS page
  and clicks Deploy.
- **Every later code update of a secrets app is another draft that Juan must click Deploy on.**
- Values are replaced in the app's Deployment settings.

**Access and public paths** (skill steps 2 and "Public endpoints"):
- `OPEN` lets all PL Infra members open the app.
- `PRIVATE` means the owner, **directory admins**, and members the owner picks in LabOS.
- `publicPaths` skip LabOS sign-in, and the app must secure those paths itself.

**Logs** (`app-logs`): build and runtime logs come through the API with the deploy token. They are
readable by the owner only, and CloudWatch retention applies.

**Analytics** (`app-analytics`): the baseline snippet sends `location.pathname + location.search` to
PL on every route change.

**Not provided:**
- CI deploys
- A scheduler
- A persistent disk or an object store
- Database access from outside the cluster
- A staging slot (one `appId` is one app)
- The region, the replica count, the egress IPs, the Postgres major version, database backups

## 2. How our app fits, and what must change

### Build and run

**Server.** Today `scripts/serve.ts` runs `next dev`, or `next start` for `start:real` (N77). It reads
`.ports.json`, wraps the Keychain scripts and binds `0.0.0.0`. In the container:
- Run a plain `next start -H 0.0.0.0 -p $PORT` from a new `RUNTIME=labos` mode.
- No Keychain, no `.ports.json`.
- Bake the commit SHA in at build time, because `lib/dev/git.ts` calls `git`, and the image has no
  `.git`.

**Build.** **Measured tonight:** a demo `next build` (Turbopack, 15 workers) took 10 s, and its
largest process peaked at **2.5 GB RSS**. That is above Kaniko's 2Gi. On 1 CPU it would also be much
slower. So build locally and ship the output, and have the Dockerfile only copy files and install
production dependencies. The alternative is asking PL for a bigger build limit.

**File tracing is a leak risk.** The build warns that 23 dynamic `readFile(join(process.cwd(), …))`
sites match 12,000–24,500 files:
- the issues, activity and workflow ledger
- the Dakota replica
- enrich
- docs

Next's output tracer copies the files it matches. So a build run where `data/real` is a link to the
real data could carry real files into the build output.

The fix:
- Build only from a clean `git archive` tree that has no `data/`.
- Add `outputFileTracingExcludes` for `data/**` and `issues/inbox/**`.
- Add a zip guard that fails on `data/`, `.env*`, `*.pem`, `*.jsonl` or any file over 20 MB.

**Health and framing.**
- `/api/health` exists, so add a `/health` rewrite.
- No `X-Frame-Options` is sent today. Add a CSP with `frame-ancestors 'self' https://os.pl.xyz` so
  no other site can frame the app.

### The database

**Selection.** In the real profile, `config/deployment.ts` `databaseUrl()` refuses any non-loopback
`DATABASE_URL`. That is right for the Mac, so keep it there. The `labos` runtime instead:
- accepts the injected URL
- turns SSL on
- **refuses to start without it**, because PGlite on an ephemeral disk would silently lose writes

PGlite stays the fallback on the Mac only.

**Migrations.** Ours already do what the kit asks. They run at boot (`lib/db/index.ts`), with a
checksum ledger and an advisory lock. Keep ours and skip the kit's `_pln_migrations`. Three things
to confirm with PL:
1. **`CREATE SCHEMA` rights.** We have 25 modules, one schema each, plus `platform`. The kit only
   promises `CREATE TABLE`.
2. **The Postgres major version.** We run 17. `gen_random_uuid()` is built into Postgres 13 and
   later, so it needs no extension.
3. **Whether one pod or several run.**

**Roles.** The provisioned database gets one owner user, and no role can be created. So
`plcos_ro`, the read-only role used today for backups and agents, cannot exist there.

**Initial load.** The kit's data copy cannot reach our loopback cluster. The first load has to be our
own: signed chunked uploads to the app, checked per table with counts and checksums as `pg-copy`
does (docs/21).

**Note for the integrator, against section 04.** Its "Mac runner connects over TLS as a
`plcos_import` role" plan conflicts with the kit on two counts: no role can be created, and the
password never leaves PL. Plan on 04's fallback, the signed bundle endpoint, unless PL offers
external access and a second role.

### Import jobs and file-based state

**Import jobs.** A job runs as a child process, `node --import tsx scripts/import-worker.ts`, and
more work runs in worker threads (import, activity, enrichment summary). The image therefore needs
`tsx`, `scripts/` and the `lib/` sources. That means a full production `node_modules` (441 MB with
dev dependencies), not Next's standalone output. With 384Mi, heavy kinds must run on the Mac,
which is section 04's recommendation.

**File-based parts.** Everything lives under `config.data.root` (`data/real`), sized on 28 Sep:

| Part | Size | In the deployed app |
|---|---|---|
| Issues and screenshots, with the journal | 48 MB | A DB-backed `IssueSink` in the `labos` runtime (the seam exists) |
| Activity log (JSONL plus a file watch) | 1.8 MB | An append-only DB table |
| `init.jsonc`, mapping, answers, readings, event tags (team roster, real names) | < 1 MB | A `platform.config_file` table loaded by sync, never in the ZIP |
| Workflow ledger `runs.jsonl` | 15 MB folder | Stays on the Mac; lines go up with imports (04) |
| Enrich | 1.9 GB (brief said 1.4) | Mac only; pages that read it are hidden in the deployed build |
| Dakota raw replica | 50 MB | Mac only |
| Linear replica | 5.8 MB | Mac only |
| Intake, materials, portfolio | ~95 MB | Mac only |
| Backups `~/plcos-backups` | 13 GB | Mac only. The deployed DB relies on PL's RDS backups (ask) plus our nightly signed export (04) |
| Stale PGlite directory | 6.9 GB | Not deployed |

In-process serialization assumes one process: `lib/issues/file.ts` `serially()` and the activity
notifications. The DB-backed versions remove that assumption. Ask PL to pin the app to one replica
anyway.

### Resources

**Memory:**
- The dev server peaked at 5–7 GB, and idles at about 690 MB RSS tonight.
- A production `next start` with an 8-connection pool is unmeasured. GUESS: 400–800 MB before any
  import runs.
- **384Mi is below the idle dev server.** Ask for 1.5 GiB (GUESS, to be measured) with imports on
  the Mac, or 4 GiB if heavy imports run in the container.

**CPU:** 300m throttles the CPU-bound pages (routes, network). Ask for 1 CPU.

**Database:**
- About 640 MB logical (the dump is 624 MB); the cluster directory is 1.7 GB with WAL.
- Ask for 10 GB of storage (GUESS: headroom for imports and bloat).

**Build:** 2.5 GB measured, which is over the limit. Ship a prebuilt output.

### Secrets

| Secret | Today | Deployed |
|---|---|---|
| Affinity key (can write, unscoped) | Keychain, Juan approves each read | Stays on the Mac |
| Linear key (can write, unscoped) | Keychain | Mac. First candidate to move later, through the LabOS draft flow (04 decision 5) |
| Dakota user and password | Two Keychain items | Mac only, never in the cloud |
| Local Postgres roles `app`, `ro`, `admin` | Keychain `plcos-postgres` | Unchanged; they are local |
| Deployed Postgres | none | Injected by PL; we never see it |
| Polaris | Juan's gcloud ADC | Mac only |
| Anthropic and OpenAI keys | Not used by the server | None in the cloud; the Agent seam stays a no-op |
| Backup passphrase | Keychain | Unchanged |
| **New: sync signing key** | none | Ed25519. The private key lives in the Mac Keychain (`plcos-sync / signing-key`); the **public** key is committed in config and verified by the deployed app |

So **no connector runs in the cloud at launch**, and the deployed app needs **no LabOS secrets**.
That matters because the kit's draft flow puts a human click on every code deploy of a secrets app.
A public key is not a secret, so signed sync keeps direct redeploys possible.

The sync endpoint:
- a `publicPaths` entry that accepts writes only
- signed, with a timestamp and a nonce table against replay
- returns counts, never records

### The repo

**Today:**
- The remote is `git@github.com:jbenet/plcos-claude`, on Juan's personal account. Whether it is
  private was not checked, because checking would contact the remote.
- `.git` is 53 MB. There are no hooks, no CI and no Dockerfile.
- The rule: nobody fetches, pulls or pushes, because Juan's SSH key is a hardware key and every
  remote contact prompts him. Juan pushes master.

**Automatic push.** A **write deploy key** is an ed25519 key with no hardware, valid for this one
repository. It sits behind an SSH host alias (`github-plcos`) and a second remote (`auto`). Juan's
hardware key is never touched, and his `origin` stays as it is.
- The integrator pushes `master` and `claude/main` after the ship script passes.
- It never force-pushes.
- A GitHub rule on master blocks force pushes and deletion.

**The pre-push hook** (tracked in `scripts/hooks`) refuses:
- anything under `data/` or `issues/inbox/`
- files over 5 MB
- secret-looking strings

It also runs `npm run boundaries`. Before the first automatic push, do a one-time scan of the whole
history: it was rewritten once before.

**How deploys connect.** Deploy from the local integrator agent, not from GitHub or CI; the kit has no
CI token. The order:
1. Checks pass.
2. Master moves.
3. Master is pushed automatically.
4. The pushed SHA is deployed from a clean `git archive`.
5. The deploy is recorded in a local deploy ledger: SHA, `deploymentId`, target, result.

This way every deployed build exists on GitHub. GitHub Actions stays deferred to D2 (AGENTS.md).

### Environments and data flow

| Environment | Where | Data | Database | Connectors |
|---|---|---|---|---|
| Dev worktrees | Mac :3100/3200 and sub-agent ports | Demo, and preview copies | PGlite; test cluster :5434 (invented) | None |
| Local live | Mac :3000 | Real, full | Postgres :57433 | All, read-only |
| **Staging** | LabOS app `…-staging`, PRIVATE | **Demo only**, always | Its own provisioned Postgres | None |
| **Production** | LabOS app, PRIVATE | Real, per decision 2 and decision 3 | Its own provisioned Postgres | None |
| Mac mirror (after the cutover) | Mac | Nightly export of production | Postgres :57433, read-only use | All; their outputs go up as signed bundles (04) |

**Code** moves dev → master → GitHub → staging → production.

**Data** moves as section 04 describes. After the cutover, production is the only primary. The Mac
keeps the connectors and workflows and pushes their outputs up as signed bundles.

**The cutover** follows docs/21's runbook:
1. Stop local writes.
2. Snapshot.
3. Bulk-load, verifying every table by count and checksum.
4. Smoke-test production.
5. Point the team at production.
6. Keep the Mac database untouched for two weeks as the rollback.

**The confidentiality boundaries this crosses:**
1. **Data at rest.** Real LP records sit in PL's RDS, in an AWS account PL Infra operates, including
   its snapshots.
2. **Who can open the app.** A PRIVATE app is still open to "directory admins", so PL directory
   admins can open the real app.
3. **Runtime logs** go to CloudWatch. No `console.*` may print record contents. Import-job errors are
   already sanitized; audit the rest.
4. **The ZIP** is stored by PL. It must hold code only, which the zip guard enforces.
5. **Analytics.** The kit's snippet would send our paths and query strings, which include LP ids and
   search text, to PL. Do not install it in the real app, or send route templates only.
6. **Dakota.** Its rule reads "never leaves our system … should just go into our db". PL's warehouse
   already holds some Dakota data.
7. **No training.** Confirm that PL's infrastructure and CloudWatch use no data for training.

## 3. Options

**Deploy path:**
- **(a) The kit as written:** Kaniko builds from source. Cost S. It fails the 2Gi build limit on our
  measured 2.5 GB.
- **(b) A prebuilt output uploaded by the local agent (recommended).** Cost M. The ZIP is larger, but
  the build is deterministic.
- **(c) CI from GitHub.** The kit has no token for it, so this needs the kit devs.

**Residency:**
- **(R1) Staging only, with demo data; real data stays on the Mac.** No new exposure, and it does not
  meet the goal.
- **(R2) Real data except what is private to Dakota.** The `dakota` schema and claims stay on the Mac.
  Dakota-sourced names and prospects go up, since Juan said names are fine. Cost M: a schema filter in
  the sync, and hidden Dakota panels.
- **(R3) PL infrastructure counts as our system: everything goes up.** Cost S. The risks are Dakota's
  terms and the directory admins.
- **(R4) The deployed app on a database hosted on the Mac.** It uses a bring-your-own database secret
  over a tunnel. Data at rest never leaves the Mac, but every query crosses the internet, uptime is the
  Mac's, and Postgres is exposed. Poor fit.

**Push authentication:**
- Manual, as today.
- **A write deploy key (recommended):** one repository, no expiry to manage, revoked in repository
  settings.
- A fine-grained personal access token in the Keychain: it expires and needs a credential helper.
- A GitHub App: overkill.

## 4. Recommendation

Deploy two **PRIVATE** LabOS apps with PL-provisioned Postgres:
- **staging**, on demo data, first. This proves the build, the memory, the framing and the
  migrations with zero data risk.
- **production**, on real data under R3 for our own records. Dakota-private data stays under R2 until
  Juan confirms Dakota's terms and PL's admin access.

The integrator ships a **prebuilt, guarded ZIP** in a `labos` runtime that has no connectors and no
secrets. Connectors and workflows stay on the Mac and sync up through a signed endpoint.

Code goes to GitHub automatically through a repo-scoped **write deploy key** with a pre-push guard.
Deploys go from the pushed SHA.

This is the shortest path that keeps every key on the Mac, avoids a human click per deploy beyond
the hourly LabOS approval, and keeps Dakota's rule intact by default.

## 5. Decisions for Juan

1. **Deploy as two PRIVATE LabOS apps, staging (demo data) and production, each with PL-provisioned
   Postgres?** *Yes.*
2. **Does PL's provisioned infrastructure count as "our system" for our real LP records, including
   Affinity-derived ones?** *Yes, if the app is PRIVATE with named members only, and PL tells us who
   can reach the database and the logs.*
3. **Does Dakota data go to the deployed database?** *Not at launch. The `dakota` schema and claims
   stay on the Mac (R2) until you confirm that Dakota's terms allow PL hosting. The warehouse holding
   some is a precedent, not a licence.*
4. **Do connector keys stay in the Mac Keychain, so the deployed app has no LabOS secrets?** *Yes.
   Revisit Linear first.*
5. **May the integrator push to GitHub automatically with a write deploy key for this repository only?
   You add the public key once.** *Yes: `master` and `claude/main` after the checks pass, never
   force.*
6. **The repository's home?** *Keep `jbenet/plcos-claude` and confirm it is private. Move it to a PL
   org later; deploy keys and redirects survive a transfer.*
7. **Accept one LabOS approval per deploy session (a one-hour token)?** *Yes. Overnight work lands on
   master and staging-ready, and deploys after your morning click. We ask the kit devs for an
   app-scoped CI token.*
8. **Ask PL Infra for 1.5–2 GiB and 1 CPU at runtime, and 10 GB of database storage?** *Yes, with
   measured numbers attached. Until then, ship a prebuilt output.*
9. **Leave out the kit's baseline analytics in the real app?** *Yes, or send route templates only.*

## 6. Build list

**Tonight, no decision needed (demo data only):**
1. **S.** Measure `next start` RSS on a demo production build during a page walk. Measure the
   real-profile production RSS on a preview copy, locally.
2. **M.** Add the `RUNTIME=labos` mode:
   - the injected `DATABASE_URL` with SSL, and refuse PGlite
   - no Keychain or `.ports.json`
   - a baked-in SHA
   - a `/health` rewrite and a CSP with `frame-ancestors`
   - hide pages and import kinds that are Mac-only
3. **M.** Build script and Dockerfile:
   - build from a clean `git archive`
   - `outputFileTracingExcludes`
   - install production `node_modules` in the image
   - the zip guard, with properties that prove it
4. **M.** A DB-backed `IssueSink` and activity log for `labos`.
5. **S.** A deploy wrapper around the kit's connect and upload (the token in memory only), plus a
   deploy ledger. Rehearse it against the invented test cluster at :5434.

There is no local container runtime (no Docker, Podman or Colima). Staging is the image test, unless
Juan approves installing Colima.

**Needs Juan:**

6. **S. The first staging deploy.** Juan approves the name and access, and clicks the LabOS link.
   Needs decision 1.
7. **S. The deploy key, the pre-push hook and the history scan.** Needs decisions 5 and 6.
8. **S. The resource request to PL Infra.** Needs decision 8.
9. **M. The signed sync endpoint and chunked bulk load,** with per-table checksums. It is shared with
   section 04.
10. **M. The Dakota exclusion filter.** Needs decision 3.
11. **L. The production cutover:** freeze, load 640 MB, verify, smoke-test, point the team at it.
    Needs decisions 2 and 3.

## 7. Feedback for the kit devs

- An **app-scoped, long-lived or CI (OIDC) deploy token**. Today every deploy needs the owner at a
  LabOS link within the hour.
- **Code-only redeploys of an app whose secrets are already stored**, without a new draft and a click.
- **Per-app resources, or a documented way to request them.** 384Mi does not fit a Next.js SSR app
  with a Postgres pool, and our build measured 2.5 GB, over the 2Gi build limit. Also allow
  uploading a prebuilt output.
- **Document the platform:** persistent storage (or its absence), the replica count, the region, the
  egress IPs, the Postgres version, `CREATE SCHEMA` and extra roles, RDS backups and point-in-time
  recovery, access from outside the cluster for operations and backups, and log retention and who can
  read the logs.
- **A PRIVATE mode that excludes directory admins,** for confidential apps.
- **Analytics that send route templates, or let an app turn off query strings.**
- **A staging slot per app,** instead of a second global `appId`.
