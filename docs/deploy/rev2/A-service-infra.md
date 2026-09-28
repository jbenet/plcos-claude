# A — The service as the system of record: runtime, connectors, migration, security, PL Infra asks

Rev 2 plan section, 28 Sep 2026. It replaces rev 1's "the Mac keeps the connectors and pushes
bundles" (00-plan §4–5, 01 §2, 04 §3). In rev 2 the deployed service's database is the primary,
the service runs its own connectors and jobs, and the Mac is a development machine. Sources:
rev 1 (00, 01, 04), the B1 measurements (06), the kit v1.13 (`deploy-to-labs`, `db-migration`,
`AGENTS.md` "Resource limits", `pln-app.config.json`), docs/15, 20, 21, 22 and 24, and file sizes
taken tonight with `du` (sizes only). Numbers marked GUESS are unmeasured. No real records here.

## 1. What the kit gives us, and the gap

**What the kit gives us:**
- One container per app, built by Kaniko and run on PL's EKS.
- LabOS sign-in in front of the app, with `/me` to identify the member.
- A PL-provisioned RDS Postgres: one user, TLS required, `CREATE TABLE` only, no roles, no stated
  backups or PITR (`deploy-to-labs` "Apps that want a provisioned database").
- Secrets typed into a LabOS page, with a new draft and a Deploy click for every later code update
  ("Apps that need secrets").
- CloudWatch logs, readable by the owner with a one-hour deploy token (`app-logs`).

**What it rules out:**
- Resources: "fixed platform default" limits of 384 MiB and 300m CPU at runtime, 2 GiB and 1 CPU
  at build.
- "Don't spawn extra worker threads/processes".
- No scheduler and no persistent disk. File storage "needs an external object store the member
  sets up separately" (`db-migration` step 2).
- The data copy in `db-migration` 6b runs from inside the container and needs the old database
  reachable. Ours listens on the Mac's loopback.

So the kit fits a small app with one process. A system of record with its own connectors needs
more: separate web and worker processes, scheduled jobs, a volume, a database with roles and PITR,
and scoped secrets. Juan said resources are negotiable, so section 6 asks PL for them.

## 2. The runtime shape

We ask PL for an **extended LabOS app**: the same front door (os.pl.xyz, LabOS sign-in, `/me`),
with several processes behind it. It is **one image, run with three commands**, so every process
runs the same commit.

| Process | What it does | Ingress | Holds secrets | Size (see §6) |
|---|---|---|---|---|
| **web** (`next start`) | Pages, server actions, the approval queue and user actions in the live database. It queues jobs and never runs them, and never spawns a child process. | From the LabOS proxy only | Database role `plcos_app`; no connector keys | 1 replica at launch; 2 once issues and activity are in the database |
| **worker** | Claims `platform.import_job` rows with `FOR UPDATE SKIP LOCKED` and takes the same per-kind advisory lock and heartbeat as today (04 item 3, now in the cluster). Runs the twelve import kinds and the connector syncs. | None | `plcos_worker` role; Affinity, Linear, Dakota and warehouse credentials | 1 replica; one heavy job at a time per kind |
| **agents** | Server-side research and strategy workflows (W1, W3, W5, reviews) on API models. It reads frozen batches and writes result files to the volume. The worker imports them after checks, as today. | None | Model API keys only; **no connector keys and no database write** | 1 replica, 4 concurrent agent runs (GUESS) |
| **cron** | A scheduled one-shot, `node scripts/cron.ts <job>`, that only enqueues jobs. Every run is idempotent, so a double fire is harmless. | None | `plcos_worker` role (to enqueue) | Seconds per run |

The agents process holds no connector keys and has no write access to the database. It is the
process with open web egress, and it reads pages written by strangers, so a page that injects
instructions into an agent cannot reach Affinity or rewrite pipeline rows.

**Storage:**
- **Postgres primary:** RDS, Postgres 17, with automated backups and PITR (§6).
- **File volume:** mounted at `config.data.root`. Today 23 `readFile(join(process.cwd(), …))` sites
  and every import kind read files from there (01 §2). A mounted volume that web, worker and agents
  can all share (EFS, ReadWriteMany) keeps that code working unchanged. S3 would mean rewriting
  every reader against a storage seam, so it comes later, one reader at a time.
- **Object store (S3):** the encrypted nightly logical dumps, the cold archive of raw research logs,
  and the Mac's pull point for mirrors.

**Environments:**

| Environment | Data | Database | Connectors | Who |
|---|---|---|---|---|
| **production** | Real | RDS prod, PITR, Multi-AZ if affordable | Live, read-only | The roster (02) |
| **staging** | Invented demo data only, always | RDS small, reset from the seed on each deploy | Fixture connectors (Linear already has an invented workspace; Affinity and Dakota fixtures exist for tests) | Juan, Claude, Astra, testers |
| **preview (on demand)** | Demo data | A throwaway database or schema, deleted after 24 h (GUESS) | None | Anyone reviewing a branch |
| **rehearsal (on demand)** | Real | A PITR clone of prod, made by RDS "restore to point in time" as a new instance, deleted after use | None | Juan and the integrator only |

Rehearsal is the cloud form of 04's rule to "rehearse on a copy, then apply the same bundle". A
large import or bulk merge runs on a fresh clone first, the counts are compared, and then the
same job, with the same input hashes, is queued on prod.

**Migrations** run once per deploy, before the web and worker processes roll, as a one-shot job
under the owner role. If PL gives us no pre-deploy hook, they keep running at boot under today's
advisory lock (`lib/db/index.ts`), which is safe with several replicas. Migrations stay
expand-and-contract, so the old and new pods overlap safely during a rolling deploy.

## 3. The service's own connectors

**Rules for every connector:**
- **New credentials that belong to the service.** Juan's personal Keychain keys are not copied.
- **Read-only is enforced twice where the vendor allows it:** by the credential's scope, and by our
  client's allowlist, which exists and is proven by properties.
- **Only the worker holds the keys.**
- **Egress to the vendor's host only,** through an allowlist (§5).

| | **Affinity** | **PL warehouse (Polaris)** | **Linear** | **Dakota** |
|---|---|---|---|---|
| **Egress** | `api.affinity.co:443` | `bigquery.googleapis.com`, `oauth2.googleapis.com`, and `sts.googleapis.com` if we use workload identity | `api.linear.app:443` | `marketplace-as-a-service.herokuapp.com:443` (the host in `lib/connectors/dakota/`). It is on Heroku, so its IPs change: the allowlist must match on the hostname, not an IP. |
| **Credential** | An API key for a dedicated Affinity user, or better an OAuth client with `api.read`, which Affinity itself refuses to write with (docs/15 §5). Ask Affinity. | A GCP service account with `bigquery.dataViewer` on the datasets we read and `bigquery.jobUser` for running queries. Best is workload identity federation from PL's AWS, which needs no key file. The fallback is a JSON key in the secret store. It replaces Juan's gcloud ADC and the `bq` CLI (`scripts/warehouse-graph.ts` calls it with `execFile`). | An OAuth app with the `read` scope, so read-only holds on Linear's side too (docs/24). Today's key is personal and can write. | Username and password with the OAuth2 password grant: a one-hour token and a five-hour refresh (docs/20). There is no read-only scope. Ask whether the licence gives a second login for the service. |
| **Read-only enforcement** | GET only, allowlisted paths, and a property that a write throws. Plus the `api.read` scope if we get it. | SELECT or WITH only, with DML and DDL refused in code (`warehouse-graph.ts`). A role with no write grants. `maximumBytesBilled` set on every job. | Allowlisted query names, each text checked for `mutation` or `subscription`, and properties. Plus the `read` scope. | The client builds only list and count bodies and checks module, field and operator names. That is the only enforcement, so also log every request (path, status, never bodies). |
| **Rate limits** | 100,000 a month per account on Scale and Advanced, shared with every other integration. Our caps (GUESS, `config/deployment.ts`): 300 a minute, 25% of the monthly quota (about 830 a day), and a stop when under 10% is left. | Billed by bytes scanned: $6.25 per TiB on demand (GUESS; list price, check PL's contract). Today's per-query cap is 10 GB, at most about $0.06 per query. Results are cut off at 10,000 rows, so we page. | An hourly request and complexity budget. A full pull is 44 requests, about 2% of the hour. An incremental pull with nothing changed is 9. | None documented. We send 1 request a second and stop on a 429 or a run of 5xx errors. The first full pull was 312 requests. |
| **Schedule** (cron enqueues) | Incremental lists, notes and interaction deltas **hourly** (GUESS about 10–40 requests a run, under 1,000 a day). A deletion and merge sweep **monthly**. No account-wide email sweeps without pricing them (docs/15). | The graph extract **weekly**, plus on demand. W3 runs after it. | Incremental **every 15 minutes** (at most 36 requests an hour). A full resync **weekly**. | Incremental, changed-since, **weekly**, then translate. A first full pull only on demand. |
| **Where the data lands** | `affinity` schema plus the raw replica on the volume | `enrich/warehouse` on the volume, then the W3 import. The page cache is regenerated, not migrated. | `linear` schema | `dakota` schema plus the raw replica on the volume. **Only if Juan decides it may be on PL infrastructure (§8, decision 3).** |

**The Dakota boundary in the service.**
- Dakota's private fields must never appear in logs or be sent to model APIs. Those fields are AUM,
  tickets, contact details, notes and consultant relationships (real-data rules).
- So the agents process reads the database only through a projection with those fields left out,
  enforced by a view the agents' role can read. The agents role gets no grant on the `dakota`
  schema.
- The Dakota import runs in the worker. It is the only code that reads the raw replica.

**Secrets.**
- **The kit's store** is the LabOS secrets page: names are declared in `requiredEnvVars`, Juan types
  the values, and they are injected as env vars into the app.
- **Problems for us:**
  - it injects the same variables into every process, where we want per-process scoping;
  - every code update of a secrets app needs a new draft and a Deploy click;
  - rotation happens by hand.
- **Proposal to PL:**
  - AWS Secrets Manager, or PL's equivalent, with a secret set per environment and per process:
    web gets nothing but the database URL, worker gets the connector credentials, and agents get the
    model keys;
  - mounted as files, or through the External Secrets Operator;
  - values entered once by Juan and kept across code deploys;
  - encrypted with the app's own KMS key (§5).
- **Fallback if PL says no:** the LabOS page. The web and worker code still refuses to read any
  variable its process role does not own, so a leaked web process holds no connector key it can
  use.

## 4. Migrating from today

**Sizes measured tonight** (`du`, no contents read):
- Postgres cluster directory: 1.6 GB, of which about 640 MB is logical; the last dump was 624 MB.
- `enrich`: 1.9 GB, not the 1.4 GB in the brief. It breaks down as:
  - `log` 652 MB (raw agent transcripts)
  - `prospects` 399 MB
  - `warehouse` 369 MB (mostly the BigQuery page cache)
  - `batches` 368 MB
  - `raw` 25 MB, `strategy` 18 MB, other folders under 20 MB each
- `issues` 48 MB, `dakota` 50 MB, `materials` 51 MB, `intake-archive` 40 MB, `workflows` 15 MB,
  `activity` 3.3 MB.
- The stale PGlite `database` folder: 6.9 GB.

**What moves where:**

| Set | Size | Destination |
|---|---|---|
| Database | 624 MB dump | RDS prod, via `pg_restore` |
| Hot files: `enrich` minus `log` and the warehouse cache, plus issues, materials, intake, portfolio, workflows ledger, tags, strategy moves and config files | about 1.0 GB | The volume |
| Raw research logs `enrich/log` | 652 MB | An S3 cold archive, encrypted. Not on the live volume. |
| Warehouse page cache | 369 MB | Not moved. The first cloud extract rebuilds it. |
| `dakota` raw replica | 50 MB | The volume, **only after decision 3**; otherwise it stays on the Mac and the cloud Dakota sync stays off |
| PGlite `database` | 6.9 GB | Not moved; deleted after the 14-day rollback window of the Postgres switch |
| `activity` | 3.3 MB | Into the database table (rev 1 build item 4) |

**The one-time move.** It is our own path, because the kit's 6b copy cannot reach the Mac.
1. `pg_dump -Fc` as `plcos_ro`, and `tar` of the hot file set with a per-file SHA-256 manifest.
   Both are encrypted with `age` to the service's restore key.
2. Upload to the prod S3 bucket over a presigned multipart upload issued to Juan, or to an
   admin-only chunked upload route if PL gives no bucket.
3. A one-shot restore job in the cluster decrypts both. It runs `pg_restore --no-owner` as the owner
   role, then the grants, then unpacks the files onto the volume.
4. Verification reuses docs/21's `pg-copy` checker: per-table row counts and ordered-row checksums,
   and every file's SHA-256 against the manifest. The report holds counts, never rows.
   - Any mismatch blocks the cutover.
   - Restore time GUESS: 5–15 minutes for 640 MB. The upload is about 1.7 GB.
- **Faster alternative:** PL opens RDS for one day to Juan's IP, and the existing tooling runs
  directly.

**Cutover, with rollback.**
1. **T-3 days: a rehearsal.** Do the whole move into the prod environment. Verify, smoke-test the
   core pages and one reversible write, then drop the database and volume contents. Time each step.
2. **Freeze.** Stop the Mac live server (:3000) and pause workflows. Take a final event backup
   (docs/22).
3. **Move** the final dump and files, then verify. The connector cursors, job ledger and migration
   ledger travel inside the database, so the first cloud syncs are incremental.
4. **Smoke-test prod.** Then enable the cron schedules one connector at a time: Linear first, since
   it is cheapest, then Affinity, the warehouse, and Dakota (if decision 3 allows it).
5. **Point the team at the service.** On the Mac:
   - rename the old database to `plcos_live_precutover`, untouched for 14 days;
   - disable the Mac's connector keys; delete them after the window (decision 4).

**Rollback.**
- **Before any team write:** point people back to the Mac and restart :3000. Nothing is lost.
- **After team writes:** a reverse cutover.
  1. Take a fresh dump from prod.
  2. Restore it into a new Mac database. The Mac is primary again, holding every write the team
     made in prod.
  3. Re-enable the Mac keys.

  The loss is zero if prod is reachable. If it is not, the loss is everything written since the last
  nightly dump; PITR narrows that once PL restores it.
- A rollback is a full-database restore, not a replay of changes, so it uses the same verified
  tooling in reverse. **Keep the reverse cutover ready and rehearsed for 14 days.**

**What the Mac keeps afterwards:**
- Dev worktrees on PGlite and demo data, as now.
- A **read-only mirror**: `npm run mirror` (04 item 5, retargeted) pulls the newest encrypted nightly
  dump from S3 and restores it into the local cluster, with `default_transaction_read_only` on. Real
  previews clone from the mirror as they do today.
- A file mirror of the hot set, pulled the same way when needed.
- The Mac never writes to prod, and holds no prod connector keys.

## 5. Security

**Network policy:**
- Ingress: the web process accepts traffic only from the LabOS proxy. Worker, agents and cron accept
  none.
- The RDS security group admits only our namespace's pods on 5432. There is no public endpoint.
- Egress is default-deny, with a hostname allowlist per process:
  - **web:** RDS, and `api-directory.os.pl.xyz` for `/me`.
  - **worker:** RDS, the four connector hosts (§3), and S3.
  - **cron:** RDS.
  - **agents:** the model API hosts, and the public web on 443 through a logging egress proxy with
    per-domain rate limits (1 request a second, matching the enrichment rules). It needs broad web
    access, which is why it has no keys and cannot write to the database.
- In the code too: a `fetch` wrapper refuses hosts off its process's list. This is defence in depth
  if PL cannot enforce hostname egress.

**Encryption:**
- **At rest:** RDS, its snapshots, the volume and S3, all under a **customer-managed KMS key
  dedicated to this app**. The key policy is the real control over who at PL can read snapshots.
- **In transit:** TLS to RDS with certificate verification. We ship the RDS CA bundle in the image;
  we do not follow the kit's `rejectUnauthorized: false`. TLS on the LabOS ingress.
- **Logical dumps** are encrypted with `age` to Juan's public key before they leave the process. The
  private key lives only with Juan (and in 1Password), so PL operators with S3 access cannot read the
  dumps. They can still read RDS snapshots if they hold the KMS key, hence the named list below.

**Who can access what:**

| Who | Database | Logs | App |
|---|---|---|---|
| The web process | `plcos_app`: DML on module schemas; INSERT only on the audit log | Writes (no record contents) | Serves |
| The worker | `plcos_worker`: DML on source-owned schemas and the job queue | Writes | None |
| The agents process | `plcos_agent`: SELECT on the agent views only | Writes | None |
| Backups and the mirror | `plcos_ro`: SELECT everywhere | None | None |
| Juan (admin) | Break-glass only, through a logged port-forward (SSM or bastion) as `plcos_ro`; the owner role only for incidents | Read | Admin |
| A named backup admin (TBD) | As Juan, read-only | Read | Admin |
| Team members | None directly; only through the app, governed by the roster and roles (02) | None | By role |
| PL Infra operators | **Ask PL to name them.** The KMS key policy and IAM should limit decrypt and RDS access to those names. | CloudWatch for our log group limited to those names | PL directory admins pass the LabOS gate on a PRIVATE app; our roster gate refuses them (rev 1, 02) |

**Audit:**
- **In the app:** the audit log is append-only. The app role holds INSERT only on it, a property
  proves it, and rev 1 build item 1 moves it there.
- **The approval tickets and import-job rows** record the actor's LabOS uid.
- **At the database:** `pgaudit` for DDL and role changes (nice-to-have).
- **In AWS:** CloudTrail on the RDS instance, the KMS key, the S3 bucket and the secrets. Ask PL to
  send us these events monthly, and on request for any access by a person.
- **In the logs:** logs are not an audit channel for data. No `console.*` may print a record, and a
  boundaries rule checks it.

## 6. PL Infra wishlist (to send tomorrow)

**The basis for the numbers:**
- The dev server used 5–7 GB and was pegged. That is dev mode (Turbopack, hot reload), not the
  production figure.
- A production demo build peaked at 1.80–1.84 GiB in one process (06).
- The production runtime RSS is **not yet measured**: 06 was blocked by the sandbox. GUESS
  400–800 MB idle.
- An import fixture on PGlite peaked at 1.17 GiB, and `--max-old-space-size=256` did not cap it (06).
- The findings import took 35–96 minutes on an M-series Mac. It is CPU-bound, and a cloud vCPU is
  likely slower per thread (GUESS 1.5–2×).
- The database is 640 MB logical, 1.6 GB on disk with WAL, and growing.
- 25 module schemas plus `platform`. No extensions: `gen_random_uuid()` is built into Postgres 13
  and later.

We will send measured runtime numbers before go-live. The asks are sized with headroom for that
measurement.

| # | Ask | Number | Why | |
|---|---|---|---|---|
| 1 | **Web runtime** | Request 1 GiB and 1 vCPU; limit 2 GiB and 2 vCPU. 1 replica, 2 later. | 384 MiB is below the idle dev server and below one import. The route and network pages are CPU-bound, and 300m throttles them. | Must |
| 2 | **Worker process** (a second Deployment from the same image) | Request 2 GiB and 2 vCPU; limit 4 GiB and 4 vCPU. 1 replica. | Imports run 35–96 minutes of CPU on the Mac. They must not share a pod with pages, as they stalled pages before the Postgres switch (docs/21). | Must |
| 3 | **Agents process** | Request 1 GiB and 0.5 vCPU; limit 2 GiB and 1 vCPU. 1 replica. | Server-side research and strategy runs are I/O-bound API calls, isolated from keys and database writes. | Must |
| 4 | **Scheduled jobs** (Kubernetes CronJobs or equivalent) | About 8 schedules, from every 15 minutes to monthly, each under 5 minutes and 256 MiB | Connector syncs, the nightly dump and the stale-job reaper, without any Mac | Must |
| 5 | **Build limits** | 4 GiB and 2 vCPU, **or** let us push a prebuilt image (ECR push rights) | One build process reached 1.84 GiB, against a 2 GiB limit for the whole container | Must (either) |
| 6 | **Postgres** | Postgres 17 (16 at least); db.m7g.large (2 vCPU, 8 GiB) or db.t4g.large minimum; gp3 20 GB with storage autoscaling to 100 GB; `max_connections` of at least 100 | 640 MB and growing; heavy imports; connections are 8 (web pool) + 3 (worker) + agents, cron and backup, doubled during deploys | Must |
| 7 | **Database rights and roles** | `CREATE SCHEMA` for the owner, plus four extra login roles we define (`plcos_app`, `plcos_worker`, `plcos_agent`, `plcos_ro`), or the rights to create them | 26 schemas; an append-only audit log needs a role without UPDATE; backups and agents need read-only roles | Must |
| 8 | **Extensions** | None needed now. Allow `pg_stat_statements` and `pg_trgm`; `pgaudit` if you run it | Query tuning; name search; DDL audit | Nice |
| 9 | **Backups and PITR** | Automated backups kept 35 days, PITR across that window, restore-to-new-instance on request (or self-serve), cross-region snapshot copy | The system of record must survive a bad import or migration; rehearsal clones need PITR restores | Must (35 days, PITR); nice (cross-region) |
| 10 | **Multi-AZ for prod** | Yes, if the price is acceptable (§7) | The team works in it every day | Nice |
| 11 | **Persistent volume** | EFS or another ReadWriteMany volume, 50 GB, shared by web, worker and agents, encrypted | About 1.0 GB of hot files today; research adds hundreds of MB a week (GUESS from `enrich` growth); the code reads files at `config.data.root` | Must |
| 12 | **Object store** | One S3 bucket per environment, SSE-KMS, versioning, lifecycle to Glacier after 90 days, about 100 GB | Encrypted nightly dumps (624 MB each; the docs/22 thinning keeps about 40), the 652 MB research-log archive, the Mac mirror pull | Must |
| 13 | **Outbound network allowlist, by hostname** | Web: the LabOS directory API. Worker: `api.affinity.co`, `api.linear.app`, `marketplace-as-a-service.herokuapp.com`, `bigquery.googleapis.com`, `oauth2.googleapis.com`, `sts.googleapis.com`, S3. Agents: the model APIs, plus public 443 through a logging proxy. | Read-only connectors; stop exfiltration; the Dakota host is on Heroku, so IP rules will not work | Must |
| 14 | **Secrets** | Secrets Manager (or equivalent), per environment and per process; values kept across code deploys; the app's own KMS key | Each process holds only its own keys; no Deploy click per code update | Must |
| 15 | **GCP access** | Workload identity federation from our worker's service account to a GCP service account with read-only BigQuery on the needed `plrs-data-platform` datasets | No long-lived key file; the warehouse stays read-only on Google's side | Nice (a JSON key in secrets is the fallback) |
| 16 | **Logs** | Runtime and build logs kept 30 days (90 nice), readable by Juan and one named backup without a deploy token; CloudWatch access limited to named PL operators | Incident work at night without an approval click; confidentiality | Must (30 days, named access) |
| 17 | **Staging environment** | A second app with the same shape at about half the size: web 1 GiB, worker 2 GiB, db.t4g.small with 20 GB, its own bucket and volume. Demo data only. | Every change is tested on the real shape before prod; load and attack tests run only here | Must |
| 18 | **Preview on demand** | Short-lived web pods per branch against a throwaway database, deleted after 24 h | Review a branch in the real runtime | Nice |
| 19 | **Rehearsal clones** | Our ability to create and delete a PITR clone of prod in the same private network | "Rehearse on a copy, then apply" for bulk jobs | Nice |
| 20 | **CI and deploy tokens** | An app-scoped, revocable deploy token (or GitHub OIDC) that can deploy staging unattended. Prod may keep a human approve. | The one-hour token tied to Juan blocks overnight deploys to staging | Must for staging |
| 21 | **A migration hook** | A pre-deploy one-shot job run under the owner role | Migrations run once and before the rollout, not in every pod | Nice (the boot-time lock works) |
| 22 | **Access and SSO** | (a) A PRIVATE mode that excludes directory admins. (b) An `HttpOnly`, `SameSite` session, or an app-scoped signed token, instead of the JavaScript-readable `authToken` shared across subdomains. (c) The member's email or groups in `/me`. | Confidential LP data; a script-injection bug in a sibling app must not yield tokens for ours; role mapping | (a) and (b) must; (c) nice |
| 23 | **Custom domain** | A stable name such as `capital.os.pl.xyz` | Bookmarks and our CSP `frame-ancestors`. The URL is otherwise kept private by the kit's rules. | Nice |
| 24 | **Operators and data residency** | Name who at PL can reach the database, snapshots, the KMS key and logs; the AWS region; confirmation that nothing in PL's pipeline trains on or exports app data | Juan's "our system" decision and Dakota's terms depend on it | Must |
| 25 | **Cost** | Tell us PL's internal chargeback, if any | Budgeting (our GUESS is in §7) | Nice |

## 7. Cost (GUESS, AWS on-demand list prices, us-east-1, before PL discounts)

- **Prod RDS:** db.m7g.large Single-AZ about $120 a month; Multi-AZ about $240. gp3 at 20 GB, about
  $3.
- **Prod compute:** about 5–8 GiB requested across the three processes, roughly half of one m7g.large
  node, about $30–60.
- **Staging:** about $60–80, with db.t4g.small plus pods.
- **EFS and S3:** under $20.
- **Total:** about **$250–400 a month**, excluding model API tokens.
- **Model tokens:** the workflows section prices those. Rev 1 put a night like 26 Sep at "hundreds
  to low thousands of dollars" at API rates.
- **BigQuery:** at most about $0.06 per capped query.

## 8. Decisions for Juan (suggested answers in italics)

1. **Ask PL for an "extended LabOS app" (web, worker, agents, cron, volume, bucket, RDS with roles
   and PITR), and fall back to a PL-owned AWS account or namespace we operate behind LabOS sign-in
   if they can't?** *Yes. Hosting outside PL reopens the "our system" question.*
2. **Is PL's AWS, under an app-dedicated KMS key and a named operator list, "our system" for
   Affinity- and warehouse-derived records?** *Yes, conditional on wishlist item 24's answers.*
3. **Dakota in the service?** *Yes, once Dakota confirms in writing that hosting on PL's AWS is
   within the licence. Until then the `dakota` schema and replica stay out of the service, the cloud
   Dakota sync is off, and the Mac mirror keeps Dakota enrichment for Juan only. In every case, no
   Dakota private field reaches an agent prompt or a log.*
4. **New service credentials, not your personal keys; the Mac's connector keys disabled at cutover
   and deleted after 14 days?** *Yes. Ask Affinity and Linear for read-scoped OAuth, and Dakota for
   a second login.*
5. **What moves:** about 1.0 GB of hot files to the volume; the 652 MB research log to an encrypted
   cold archive; the warehouse cache regenerated; the PGlite folder not moved? *Yes.*
6. **Dumps encrypted to your `age` public key, so PL can't read them?** *Yes. You hold the private
   key, with a copy in 1Password.*
7. **No direct human database access by default, with break-glass for you through a logged
   port-forward?** *Yes.*
8. **Cutover:** a rehearsal three days before, a freeze of under 2 hours (GUESS), the Mac database
   kept 14 days, and a rehearsed reverse cutover as the rollback? *Yes.*
9. **Staging and previews on demo data only; real-data previews only on the Mac, from service
   dumps?** *Yes.*
10. **Multi-AZ for the prod database, about $120 a month extra (GUESS)?** *Yes. The team depends on
    it daily.*

## 9. Build order

**Tonight (no decision needed, invented data only):**
1. **S.** Finish 06's blocked measurements: production `next start` RSS, idle and under a 10-way
   page walk on Postgres, and the import child's RSS. Then update the wishlist numbers before sending.
2. **M.** A `RUNTIME=service` mode:
   - `DATABASE_URL` with verified TLS, and refuse PGlite;
   - a `PROCESS_ROLE` of web, worker, agents or cron;
   - the web role never spawns import children;
   - each role reads only its own env vars.
3. **M.** A worker entrypoint: claim with `SKIP LOCKED`, advisory lock, heartbeat, and refuse on a
   migration-ledger mismatch (rev 1 04 item 3, in the cluster).
4. **S.** `scripts/cron.ts <job>`: enqueue only, idempotent by a `(job, window)` key, with property
   tests for double fires.
5. **M.** Role-split migrations: owner, `plcos_app` (INSERT only on the audit log), `plcos_worker`,
   `plcos_agent` (views only, no `dakota` schema), and `plcos_ro`. Properties for each grant. Test
   on the :5434 dev cluster.
6. **M.** Connector credential adapters: env in the service, Keychain on the Mac. Replace the `bq`
   shell-out with the BigQuery client library under a service account, keeping the SELECT guard and
   the byte cap.
7. **S.** A per-role egress allowlist in a `fetch` wrapper, with a property that each process refuses
   off-list hosts.
8. **M.** One Dockerfile, three commands, built from a clean `git archive`, with the tracing guard
   from 06; bundle the RDS CA.
9. **M.** A backup job (`pg_dump` as `plcos_ro`, then `age`, then S3) and the Mac `npm run mirror`
   pull and restore.
10. **M.** Cutover tooling: the file manifest, encrypted upload, the in-cluster restore job, the
    verification report (counts and checksums, no rows), and the reverse-cutover script. Rehearse
    end to end between the :5434 dev cluster and a second local database.

**After Juan's decisions and PL's answers:**

11. **S.** Send the wishlist (after item 1 updates its numbers).
12. **M.** Stand up staging on the extended shape, with demo data and fixture connectors. Run the
    rev 1 load and attack suites there.
13. **S.** Register the service credentials (decision 4) in the secret store, and run the staging
    connectors against the real vendors in dry-run mode: counts only, nothing written.
14. **M.** Prod environment, then the rehearsal move (T-3 days), then the cutover. Turn schedules on
    one connector at a time.
15. **S.** Dakota in the service, after decision 3.
16. **L, later.** Move the file readers from the volume to S3 behind a storage seam, one reader at a
    time. Only if the volume becomes a problem.

## 10. Feedback for the kit devs

- A multi-process tier: web, worker and scheduled jobs from one image, with per-process secrets and
  resources.
- Persistent storage (ReadWriteMany) and a bucket as first-class options.
- Provisioned Postgres with extra roles, `CREATE SCHEMA`, stated backups and PITR, and a documented
  restore path that does not need the old database reachable from the container.
- Hostname-based egress allowlists.
- A PRIVATE mode without directory admins, and a non-JavaScript-readable session.
- An app-scoped deploy token for staging.
