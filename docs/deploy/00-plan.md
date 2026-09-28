# Deploying PLC Raise Tools as a team service: the plan (for Juan's review, 28 Sep 2026)

Synthesis of five sections in this folder:
- 01, deploy, secrets and the repo;
- 02, accounts and guardrails;
- 03, feedback and the dev cycle;
- 04, workflows and sync;
- 05, testing and hardening.

Each section has its options, evidence and details. This page gives the shape, the decisions, and the build order. The LabOS starter kit (v1.13, `plcos-data/intake/ai-app-starter-kit-v1.13/`) is read as guidance, not law.

## The shape

1. **Two PRIVATE LabOS apps.**
   - **Staging:** invented demo data only. Load tests and attack agents run here and nowhere else.
   - **Production:** the team's app.

   Each has a PL-provisioned Postgres. Both are PRIVATE, with named members added under Manage access.
2. **The deployed app is a team surface only.** A `labos` build flag compiles out the Developer section, connectors, imports, merges, re-points, syncs and the user switcher. What's left: the vehicle pages, LP pages, strategy, selection, pipeline, calendar, the approval queue and feedback.
3. **Who can get in: three layers.**
   1. LabOS PRIVATE access.
   2. Our own roster gate. The server resolves the LabOS member (`/me`) to `app_user.labos_uid` and refuses anyone not on the roster, including PL directory admins.
   3. Server-side authorisation in every server action and route: roles Admin, GP (per vehicle) and Viewer, plus restricted fields. A property test proves nothing skips the check.
4. **The Mac stays home for development, research workflows and connectors.** Claude and Codex agents, and the Affinity, Dakota, Linear and warehouse keys, stay in the Mac Keychain; nothing goes into LabOS secrets at first. Results go up to production as **signed, hashed bundles to an authenticated import endpoint**. The provisioned database gives one user and no outside role, so the Mac can't write to it directly (01 corrects 04 here). Imports never overwrite a human edit; a conflict skips the record and flags it for review.
5. **One primary.** Once the team is on it, the deployed database is the only real primary. The Mac holds a read-only nightly mirror, pulled as an encrypted `pg_dump`. That mirror is also our backup until PL states what backups the provisioned database has.
6. **Feedback:** a feedback table in the deployed database, pulled to the Mac every minute and filed through today's inbox. No GitHub issues: titles, bodies and most screenshots carry real LP data.
7. **Triage uses four classes:**
   - A, no-brainer: just do it.
   - B, data correction: just do it, audited.
   - C, contradicts your decisions: goes to you, checked against a new `docs/decisions/` log seeded from 123 dated quotes.
   - D, big change: your own D items are built behind a flag and reviewed after; the team's are specced first.

   Confidentiality, access and outward actions always need your yes.
8. **Release channels:** local live (yours, real data, fastest), then staging (demo), then production.
   - **Cadence:** two production "trains" (scheduled releases) a day, plus hotfixes.
   - **Approval:** each train needs your one LabOS Approve click. Tokens last an hour, so nothing deploys unattended; we'll ask the kit devs for an app-scoped CI token.
   - **Safety:** feature flags, expand/contract migrations, and automatic smoke tests with rollback. The ship script moves into the repo.
9. **The repo:** automatic pushes to the private GitHub repo with a deploy key for this repo only, `master` and `claude/main`, never force-pushed. Each deploy is built from the pushed commit, as a **prebuilt output**: a demo `next build` peaks at 2.5 GB, over the kit's 2 GiB build limit. Checks make sure no real data gets into the build; Next's file tracer can pull in `data/real`.

## Blockers to raise with PL Infra (measured, with numbers attached)

- **Runtime memory:** the kit caps a container at 384 MiB, killing it if exceeded; our server needs more. Ask for 1.5–2 GiB and 1 CPU. We measure a production build tonight (item 3 below).
- **Build memory:** 2 GiB is below our 2.5 GB build. Workaround: upload a prebuilt output.
- **Database:** 10 GB of storage, what backups and point-in-time recovery exist, and **who at PL can read the database and the logs** (CloudWatch).
- **Cookie security:** the LabOS `authToken` cookie is readable by JavaScript and shared across every app subdomain. A cross-site-scripting bug in any sibling app can steal a member's token. That's kit feedback, and it's why the dangerous surfaces stay off the deployed build.
- **No scheduled jobs, workers or persistent disk** in the kit. Heavy imports stay on the Mac.

## Decisions for you (suggested answers in italics)

1. **Is PL-hosted infrastructure "our system" for real LP data?** *Yes, if both apps are PRIVATE with named members and PL tells us who can reach the database and logs.*
2. **Dakota data in the deployed database?** *Not at launch. The Dakota-only fields and claims stay on the Mac until you confirm Dakota's terms allow PL hosting. Names stay.*
3. **Should the deployed build be a team surface only** (no Developer, connectors or imports), with all such operations run on your Mac? *Yes.*
4. **Access:** PRIVATE, plus our roster gate that refuses non-roster users, directory admins included? *Yes.*
5. **Roles:** is Admin (you), GP per vehicle (defaulting to all vehicles) and Viewer enough? Name a backup admin later? *Yes.*
6. **Approvals:** you plus one named approver per vehicle for MONEY and ALLOCATION_EXCEPTION, with no self-approval? *Yes.*
7. **Team visibility:** GPs see amounts and note bodies for their vehicles; viewers don't. Dakota's private fields are admin-only until the licence is confirmed? *Yes.*
8. **Staging data is invented only, never real,** and real-volume performance is tested on a local copy? *Yes.*
9. **Feedback travels through a table pulled to the Mac,** with no GitHub issues? *Yes.*
10. **The four-class triage and the `docs/decisions/` log?** *Yes.*
11. **Two production trains a day,** each with your one Approve click, plus a backup approver? *Yes.*
12. **Automatic pushes with a deploy key** (you add the public key once), repo `jbenet/plcos-claude` kept private, moved to a PL org later? *Yes.*
13. **Ask PL for 1.5–2 GiB of runtime memory, 10 GB of database storage and answers on access, logs and backups** before designing around the limits? *Yes; we send measured numbers.*
14. **Kit analytics:** route templates only, never full paths? *Yes.*
15. **Concurrent edits:** a version check on stage, amounts and consent, and last writer wins (audited) for notes? *Yes.*

## Build order

**Tonight (needs no decision; all local and all tested):**
1. **Security fixes that matter today:**
   - `app/api/identity/pursuit-merge` has no user or live-server check, so anyone on the local network can merge or reverse pursuits.
   - `proxy.ts` trusts a client-supplied `x-routed` / `x-vehicle` header.
   - `decideTicket` allows self-approval.
   - The app can rewrite its own audit log (make it append-only).
2. **The authorisation layer:** one policy check (roles × actions × vehicles × restricted fields) called from every server action and route. A boundaries rule fails any action without it, and a property test proves it. Roles come from the roster, defaulting to today's behaviour for the local live server.
3. **A production build:** `next build` and `next start` locally on the demo, with memory and latency measured, to get the numbers for PL.
4. **The `labos` build flag:** strips the Developer section, connectors, imports, the user switcher and dangerous actions. A check proves none are reachable in that build.
5. **Move the ship script into `scripts/`** (gate, smoke test, rollback), and document it.
6. **Fix the feedback reporter:** 51 issues carry `reporter: unknown` because the name comes from an unverified cookie.
7. **Seed `docs/decisions/`** from the dated quotes, as the source for the triage "contradiction" check.
8. **Stress-test harness** (autocannon plus Playwright) against the local production build on demo data, and the **adversarial-user agent suite**: forged server-action calls, tampered URLs, script injection in notes and names, double submits, races and oversized uploads. Runs on the demo only.
9. **A version check** for concurrent edits to stage, amounts and consent.

**After your decisions:**
10. The LabOS roster gate (`/me` to `labos_uid`) and the roster fields.
11. The signed bundle export and import endpoint: one-way, idempotent, with conflict flags.
12. The feedback table plus the pull job.
13. A staging app on LabOS with demo data. Run the load tests and attack suite there, then walk the go/no-go checklist (05).
14. A production app. The first deploy is signed off by you; the automatic gate may roll back after that.

**Kit feedback** (collected in each section's last part):
- the JavaScript-readable shared cookie;
- no staging or rollback endpoint;
- no workers, persistent disk or scheduled jobs;
- the 384 MiB runtime and 2 GiB build limits;
- one-hour human deploy tokens;
- analytics that send full paths.
