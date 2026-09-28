# Capital OS: requests for PL Infra (draft, 28 Sep 2026)

**What we're running.** Capital OS is a Next.js and Postgres app for the PLC fundraise, used by about
ten people through LabOS. It will be the system of record for confidential LP data. It runs its own
read-only connectors (Affinity, the PL warehouse, Linear and, if licensed, Dakota) and server-side agent
workflows on API models. That is more than the kit's single 384 MiB container covers, so we are asking
for the following.

**The runtime memory numbers are not measured yet.** A production `next start` measurement was blocked
in our sandbox. The sizes below are provisional, with headroom, and we will send measured RSS and p95
figures before go-live. What we have measured:
- a production build peaks at 1.80–1.84 GiB in one process;
- an import fixture peaks at 1.17 GiB;
- the database is 640 MB logical (1.6 GB on disk), and growing.

Every number marked GUESS is a planning figure.

| # | Request | Number | Why | Priority |
|---|---|---|---|---|
| 1 | **Web process** | Request 1 GiB / 1 vCPU, limit 2 GiB / 2 vCPU; 1 replica, 2 later (GUESS until measured) | 384 MiB is below one import; route pages are CPU-bound | Must |
| 2 | **Worker process** (same image, second command) | Request 2 GiB / 2 vCPU, limit 4 GiB / 4 vCPU; 1 replica | Connector syncs and imports (35–96 min of CPU on a Mac) must not share a pod with pages | Must |
| 3 | **Agents process** (same image) | Request 1 GiB / 0.5 vCPU, limit 2 GiB / 1 vCPU; 4 concurrent model runs (GUESS) | API-bound research runs, isolated from connector keys and database writes | Must |
| 4 | **Scheduled trigger** | A CronJob every minute (under 5 s, 256 MiB), or about 8 schedules | Syncs, nightly dump and reaper, without anyone's laptop | Must |
| 5 | **Build** | 4 GiB / 2 vCPU builder, **or** we push a prebuilt image; a registry keeping 20 releases | One build process reached 1.84 GiB against a 2 GiB container limit | Must (either) |
| 6 | **Postgres 17** (16 minimum) | 2 vCPU / 8 GiB (db.m7g.large class); gp3 20 GB autoscaling to 100 GB; ≥ 100 connections | 640 MB today; 26 schemas; about 34 steady connections, 62 during a rolling deploy | Must |
| 7 | **Database roles** | `CREATE SCHEMA` for an owner/migrator role, plus 4 login roles we define (app, worker, agent, read-only), or the right to create them | The runtime must not own its append-only audit log; agents and backups need read-only roles | Must |
| 8 | **Backups and PITR** | PITR 14 days (35 nice); RPO ≤ 5 min; RTO ≤ 60 min; restore-to-new-instance for drills and rehearsal clones | This is the system of record; bad imports must be recoverable | Must |
| 9 | **Multi-AZ** for the prod database | About $120 a month extra (GUESS) | The team works in it daily | Nice |
| 10 | **Shared volume** | ReadWriteMany (EFS or similar), 50 GB, encrypted | About 1.0 GB of hot files, read from a path by today's code | Must |
| 11 | **Object storage** | One bucket per environment, SSE-KMS and versioning, about 100 GB prod, Glacier after 90 days | Encrypted nightly dumps (624 MB each) and a 652 MB research archive | Must |
| 12 | **App-dedicated KMS key** | One key per environment; decrypt limited to named people | The key policy is the real control over who can read snapshots | Must |
| 13 | **Hostname egress allowlist** per process | Web: LabOS directory API. Worker: `api.affinity.co`, `api.linear.app`, `marketplace-as-a-service.herokuapp.com`, BigQuery/OAuth/STS Google hosts, S3. Agents: model API hosts only. | Read-only connectors; stop exfiltration; the Dakota host is on Heroku, so IP rules can't work | Must |
| 14 | **Secrets** | Secrets Manager (or equivalent) per environment and per process, kept across code deploys | Each process holds only its own keys; no Deploy click per code update | Must |
| 15 | **GCP workload identity** for the warehouse | Read-only BigQuery on the named datasets; about 10 GB per query and 100 GB a day caps | No long-lived key file; replaces a personal gcloud login | Nice (a JSON key is the fallback) |
| 16 | **Verifiable app identity** | A signed, app-audience assertion or an HttpOnly per-app session, instead of the JavaScript-readable shared `authToken` | A script-injection bug in any sibling app can replay a member's token into ours | Must |
| 17 | **PRIVATE without directory admins**, and the LabOS iframe `allow="publickey-credentials-get"` | Configuration | Confidential data; our passkey sign-in inside the iframe | Must |
| 18 | **Named operators and residency** | Who at PL can reach the DB, snapshots, KMS key and logs; the region; a written statement that nothing trains on or exports app data; CloudTrail on request | Our confidentiality rules and a vendor licence depend on it | Must |
| 19 | **Logs** | 30 days (90 nice), readable by our two admins without a deploy token; access limited to named operators | Night-time incident work; confidentiality | Must |
| 20 | **Analytics opt-out** | Route templates only, no titles or error text | Paths and error text can carry LP names | Must |
| 21 | **Staging environment** | The same shape at half size: web 1 GiB, worker 2 GiB, small DB (20–30 GB), own bucket; invented data only | Every change is tested on the real shape; load and attack tests run only here | Must |
| 22 | **CI deploy token** | App-scoped and revocable, for staging and previews; prod keeps the human Approve | The one-hour personal token blocks unattended staging deploys | Must for staging |
| 23 | **Rollback and a migration hook** | A deployment list, a rollback call (< 5 min), and a pre-deploy one-shot job under the owner role | Safe releases without a rebuild | Nice |
| 24 | **Previews** | Short-lived per-branch apps, or a pool of 2 | Review branches in the real runtime | Nice |
| 25 | **Restricted dev VM** inside the boundary | 4 vCPU / 16 GiB, no prod writer credentials | Real-shape development without a laptop | Nice |
| 26 | **Custom name and pricing** | e.g. `capital.os.pl.xyz`; baseline and burst priced separately | Bookmarks, CSP; budgeting (our GUESS is $250–400 a month for infra at list prices) | Nice |
