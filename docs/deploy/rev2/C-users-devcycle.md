# C: Users in the live database, and the dev cycle around it (rev 2)

This is a plan for Juan's review, written 28 Sep 2026. Nothing in it is built yet unless it says so.

Rev 2 assumes the following:
- The deployed service is the system of record.
- Users act in its database as themselves.
- The service runs its own read-only connectors and cloud workflows.
- The Mac is a development machine, not a dependency.

This section replaces rev 1's sections 02, 03 and 05 wherever they conflict. Where rev 1 still holds, it is cited rather than repeated.

The kit is `plcos-data/intake/ai-app-starter-kit-v1.13/`. Code is cited from `claude/main` in `plcos-claude-dev`, at `bc536aa`.

**What changed from rev 1:**

| Topic | Rev 1 | Rev 2 |
|---|---|---|
| Developer and operations pages | Compiled out of the deployed build; run on the Mac | Present in the service for Admin only |
| Primary database | The Mac, propagating up | The service. The Mac holds copies. |
| Where feedback lives | Pulled to the Mac and numbered there | Filed and numbered in the service. Triage runs in the service. |
| Where deploys come from | Pushed from the Mac | Run by CI in the repo. Humans approve production. |

## 0. Where we start (already on `claude/main`)

**The security fixes in `d7ab0ad` (codex/security-fixes)** do the following:
- **`lib/mutation-guard.ts`**
  - Every mutation requires an explicit, active `app_user`. The first-user fallback is gone.
  - It requires a same-origin `Origin` plus Fetch Metadata, and ignores `x-forwarded-host`.
  - Real-profile writes happen only on the live checkout. A copy with `copyTakenAt` refuses them.
  - All 60 mutating server actions in 19 files, and the 5 POST routes, call it. An inventory property fails any new export that doesn't.
- **`decideTicket`** (`modules/governance/service.ts`)
  - It refuses self-approval of SEND, INTRO_ASK, MONEY and ALLOCATION_EXCEPTION.
  - It allows STAGE self-approval only when the actor owns that pursuit on that vehicle.
  - It locks the ticket row, so a double click decides once.
- **The audit log is append-only.** Migration `platform/010_audit_append_only.sql` adds a statement trigger that refuses UPDATE, DELETE and TRUNCATE, and it revokes those grants. **Gap:** the table owner can still drop the trigger. The provisioned database has one user, so that user is the owner.
- **Proxy headers.** The proxy strips client `x-routed`, `x-vehicle` and `x-asked-path` headers. Internal routing context is now signed.
- **Four GET handlers no longer write.**
- **What it does not claim.** It is not authentication. Whoever supplies a known handle is that user. That's acceptable on the Mac and not in a service.

**Other groundwork already in place:**
- **Feedback reporter** (`dac3615`): the reporter is resolved from the roster before filing, so `reporter: unknown` stops.
- **The decision log.** `docs/decisions/` holds **21 decisions from repo sources** (AGENTS.md, `docs/*.md`, agent rules, the changelog), dated 23–27 Sep.
  - It has a validating index, `scripts/decisions-index.ts --json`.
  - It is *not* the 123 quotes rev 1 counted; its README says so. Code comments, memory and issue triage notes are not yet in it.
- **Ship scripts.** `scripts/ship.sh` and `scripts/gate.sh` are in the repo. `ship.sh` is still hard-wired to `localhost:3000`, the live folder and `git reset --hard`.
- **Not present:** `lib/authz`, `lib/features.ts`, version columns for concurrent edits, rate limits, and CI (there is no `.github/`). `lib/auth/labos.ts` is still a stub that refuses every call.
- **Size of the code:** 83 migration files and 1,038 properties on PGlite. The Postgres suite has not been run on these branches, because the sandbox refused the connection with EPERM. It must run before integrating.

**Measured (`docs/deploy/06-measurements.md`, build log):**
- A clean demo `next build` peaks at 1.84 GiB child RSS, and 2.32 GiB peak footprint for the whole process tree (2,494,670,016 B).
- The build output is 305 MiB.
- An invented PGlite import of 1,100 people peaks at 1.17 GiB.
- Runtime HTTP memory and latency are **still unmeasured**, because the sandbox refused to listen (EPERM).

## 1. What the kit and LabOS give us here

- **Identity.**
  - The `authToken` cookie reaches every app on the shared domain.
  - The server may forward it as a Bearer token to `GET https://api-directory.os.pl.xyz/v1/ai-apps/me`. The answer is `uid, name, image, location, skills, teams[]`, with no email.
  - The kit says this is for "personalization only, not authentication" and to never store or log the token (`pln-member-context/SKILL.md`).
  - We go against that on purpose (§2.1), because nothing better is offered.
- **Access to the app.**
  - `PRIVATE` apps admit the owner, the directory admins and the members listed under Manage access (AGENTS.md "Who can open the app").
  - There are no roles inside an app, no approvals and no audit.
- **Deploys** (`deploy-to-labs/SKILL.md` step 3 and Notes).
  - A connect session returns a `userCode` and a `connectUrl`. A member with `ai_apps.write` clicks Approve in LabOS, and the poller receives a `plndeploy_…` token.
  - The token lasts about an hour, is tied to the member who approved it, and must be held in memory only.
  - There is one app per `appId`. There is no staging, no preview, no deployment list and no rollback call.
- **Logs.** Runtime logs are in CloudWatch, readable with a deploy token (`app-logs/SKILL.md`).
- **Database.** A provisioned Postgres, with one user and no `CREATE ROLE`. Migrations use the `_pln_migrations` ledger pattern (`db-migration/SKILL.md`).
- **Limits.** 384 MiB and 300m CPU at runtime; 2 GiB to build. Rev 2 treats these as negotiable (see the wishlist in §8).

---

## 2. Accounts

### 2.1 Each person acts as themselves, through LabOS

`labosAuth().currentUser()` replaces the local provider in the service. It uses the same seam as `lib/auth/index.ts`.

1. **Read the token.** Read `authToken` from the request cookies, URL-decode it and strip the quotes.
2. **Ask LabOS who it is.** Call `/me` server-side. Cache the answer for 5 minutes, keyed by `sha256(token)`, with at most 500 entries. Never persist or log the token.
3. **Map the member to the roster.** Map `member.uid` to `platform.app_user.labos_uid`, which is unique.
   - **No cookie, or a 401:** show "Open Capital OS from LabOS → AI Apps".
   - **A member not on the roster:** a 403 page showing their name and uid.
4. **Set our own session.** Issue our own session cookie, named `__Host-plcos`: HttpOnly, Secure, SameSite=Strict and host-only. It holds a random id that maps to `(user, labos_uid, sha256(token), expires)`, lasts 12 hours (GUESS), and is re-checked against `/me` every 5 minutes. JavaScript in sibling apps cannot read our cookie. They can still read the LabOS token and replay it, which is why step-up exists (§2.3).
5. **The local user switcher.** It stays in the codebase for demo and local dev. It is refused at boot whenever `DEPLOY_TARGET=labos`. `/api/session` already refuses switching when the provider isn't `switchable`.

**Why a stolen token matters more in rev 2.** In rev 1 the dangerous surfaces were compiled out, so a stolen token could only do GP-level harm. In rev 2 Admin surfaces are in the service. So a LabOS token lifted from Juan, by a script-injection bug in *any* sibling PL app, could run merges or syncs here. §2.3 adds a second factor for exactly those actions.

### 2.2 The roster gate, roles and restricted fields

- **The roster gate is unchanged from rev 1 §2.**
  - Being `PRIVATE` in LabOS is the outer door.
  - Our roster is the inner door. It refuses directory admins who aren't on the team.
  - Binding is by LabOS uid only, never by name.
  - Unbound roster rows, such as Affinity-only owners, remain owners but are not users.
- **Roles are three roster fields** on `platform.app_user`:
  - `access`: `admin | gp | viewer`;
  - `vehicles`: `uuid[]`, where null means all vehicles;
  - `approves`: a list of ticket kinds.
- **Enforcement.**
  - `lib/authz` provides `can(user, action, {vehicleId})`, and `requireCan` wraps it.
  - It extends `requireServerActionMutation`, which already runs first in every action, so the coverage property carries over.
  - The action table is rev 1 §4, with the rev 2 change below.
- **Restricted fields.** Rev 1's classes R1–R4 stand, and redaction happens in the loaders:
  - R1, money;
  - R2, note bodies;
  - R3, Dakota-licensed fields;
  - R4, reasons for restrictions.
- **Dakota fields (R3) now depend on a real connector.** They only exist in the service if Juan's reading of Dakota's terms allows PL hosting (see the workflows section). Until then R3 is Admin-only, or absent.
- **Vehicle scope never hides that a collision or restriction exists** (rules 5, 6, 7 and 8). Lists say "N more on vehicles outside your access", and routing runs over the full graph.

### 2.3 Developer and operations pages: in the service, Admin only

In rev 1 these pages were stripped from the build. Rev 2 keeps them in the service, because the service now runs the connectors and the workflows.

- **Four layers keep them Admin-only:**
  1. `proxy.ts` returns 404, not 403, to non-Admins on `/dev`, `/developer`, `/api/identity/*`, `/api/import-jobs` and `/api/dakota/*`. We don't advertise the pages.
  2. `requireCan('admin.*')` guards every action in `app/dev/**`, `app/api/identity/**` and the rest of the Admin list in §3.
  3. The nav drops the Developer group for non-Admins. That is cosmetic only.
  4. A property calls every Admin action as a GP and as a Viewer, and expects a refusal with no row changed.
- **Step-up for high-harm actions.** An Admin passkey (WebAuthn, bound to our origin, and working on iPad Safari) is required, and lasts 15 minutes (GUESS), for:
  - merges, re-points and their bulk forms;
  - imports;
  - connector syncs and purges;
  - roster and role changes;
  - restore;
  - MONEY and ALLOCATION_EXCEPTION approvals;
  - recording a wire.

  A replayed LabOS token alone cannot do any of these. It is size M. The kit says not to build auth on top; we do it here because the kit offers no alternative. This is Decision 3.
- **What still leaves the build:**
  - the user switcher;
  - `reloadInit`: the roster is edited in Admin → Access, and the init file becomes a first-load seed only;
  - `writeMappingAction` and other writers of repo files: there is no persistent disk (rev 1 03 §1), so mappings move into a table or are made in development;
  - `app/dev/shot` and `app/issues/shot`, which read from local disk. Screenshots move into the attachments table (§4).
- **"View as" for support.** An Admin can render a page as another user, **read-only**. Every use is audited with both identities. It replaces impersonation.

### 2.4 Audit per user

- **Every write records who and how.**
  - The actor: never null.
  - `via`: `ui | workflow:<name>@<run id> | agent:<run id> | import:<job id>`.
  - The LabOS uid, a request id, and before and after values for field changes.
- **Workflows act as themselves.** Workflows and agents in the service write as a named system principal carrying their run record (AGENTS.md work envelope), never as the person who started them.
  - The trigger is recorded separately, as `requested_by`.
  - A workflow's rights are the same as its starter's, or narrower.
- **Tamper evidence**, closing the owner gap left by `010`:
  - Add `prev_hash` and `row_hash` columns, where `row_hash = sha256(prev_hash ‖ canonical row)`, set by trigger.
  - A nightly check re-walks the chain.
  - The chain head is written into each backup's manifest and pulled to the Mac. The owner can still disable the trigger, but can no longer rewrite history undetected.
  - It is size S. Also ask PL for a separate migration-owner role (wishlist).
- **Views.** Admin → Activity filters by person, vehicle and `via`. Each user sees their own history on their profile.

### 2.5 Ticket approvals

- **Self-approval is already refused** (`d7ab0ad`), and agents never decide tickets.
- **Approver authority.** `decideTicket` also checks `can(user, 'ticket.decide', {kind, vehicle})`:

  | Ticket kind | Who may approve |
  |---|---|
  | STAGE, INTRO_ASK, SEND | Admin, or a GP whose `approves` lists the kind, on their vehicles |
  | MONEY, ALLOCATION_EXCEPTION | Admin, or the named approver for that vehicle, with step-up |

- **Tickets stay bounded and unexpired** (invariant 3). A ticket past `expires_at` cannot be approved, only re-requested.
- **Batch STAGE approval** shows the count and refuses tickets outside the approver's vehicles individually. It never refuses the whole batch silently.

---

## 3. User-proofing

### 3.1 What a GP can do, and what needs Admin

**GP, within their vehicles.** Every item below is audited, stamped with the actor, and reversible (§3.2):
- move LPs through the pipeline (status, stage request, met→discussing, withdraw);
- record touchpoints, updates, context notes and readings;
- tag events;
- decide LP units and SPV stance;
- assign and propose plays;
- edit strategies and strategy moves;
- dispose of signals and review edges;
- propose sends;
- request a ladder advance or a hardening;
- bulk status changes, capped at 200 rows per request with a count dialog;
- file feedback and connection notes.

**Admin only:**
- imports: prospects, findings, portfolio, bulk sourcing, Dakota and strategy-move files;
- merges and re-points, including import-duplicate merges, identity separation, entity-type changes and all their reversals;
- syncs: Affinity, Linear, Dakota and the warehouse, plus the Linear purge-and-rebuild;
- the network rebuild, SPV-stance derivation and exporting research sets;
- scoring weights, enrichment method, grant invitations (rule 12) and the roster;
- recording a wire and close-track events;
- pinning today;
- feature flags, the kill switch and restore.

**Viewer:** reads without R1–R4, and files feedback.

**Starting a cloud workflow.** A GP may start W1 research or W5 strategy for their vehicles, subject to the budget in §3.4. Workflows that write in bulk (syncs, imports, W3 connect bulk) are Admin-started or scheduled. Which workflows run unattended is the workflows section's call.

### 3.2 Undo and reversal

The pattern is already in the code. Rev 2 makes it universal.

1. **Every write goes through the journal.** Each single-record write records the inverse operation beside the audit row. A toast offers **Undo** for 30 seconds (GUESS).
2. **After that, Revert from history.** Each record's history lists its changes. The original actor or an Admin can **Revert** one.
   - Revert is a new write. History is never erased, because the audit log is append-only.
   - Revert refuses if the field has changed since, and shows who changed it.
3. **Evidence is retracted, not deleted.** Touchpoints, updates and notes are marked `retracted_by/at/reason`. They drop out of views and scores but stay in the audit log. This keeps invariant 9 (every external claim has its provenance).
4. **Bulk actions and imports revert by job.** Every row they create or change carries the `job_id`.
   - "Revert job" undoes the rows no human has edited since.
   - It lists the ones it skipped.
   - Bulk undo already works this way (`undoBulkLpAction`).
5. **Merges already have reversals:**
   - `reversePursuitMergeAction`;
   - `reverseImportDuplicateAction`;
   - `reverseIdentitySeparationAction`;
   - `reverseLpRepointAction`;
   - entity-type reversal.

   They become Admin-only, with step-up and a dry run that shows counts before running.
6. **Syncs are mirrors.** A bad sync is reverted by re-applying the previous snapshot. Sync writes never overwrite a field a human set: each field records `set_by: human | workflow`, and a conflict creates a review flag, as in rev 1.
7. **Two things are one-way by design:** ticket decisions and Pin today. Both are append-only, and a mistake is corrected by a new entry.

### 3.3 Concurrency

About ten users and several workflows will write to the same records.

- **Version checks** on the fields where a lost update costs money or consent: pursuit status and stage, soft and hard amounts, consent rungs, strategy text and SPV stance.
  - Each such row gets `version int`.
  - A form submits the version it loaded, and the update runs `where version = $n`.
  - On a mismatch, the server answers 409 and the page shows "Changed by ⟨name⟩ at ⟨time⟩: theirs / yours", with *Keep theirs* or *Apply mine*. *Apply mine* is a fresh write at the new version.
- **Append-only records** (touchpoints, notes, updates, feedback, audit) cannot conflict, so they carry no version.
- **Bulk actions skip changed rows** and report "N skipped: changed since you loaded". They never overwrite.
- **Workflows versus humans.** A workflow reads the version when it starts and writes with it. If a human has changed the record since, the workflow's write becomes a *proposal* for that record instead of a change.
- **Idempotency.** Every write carries a client request id, stored unique for 24 hours, so a double submit is a no-op. Ticket decisions are already safe by row lock. Feedback is already keyed by `clientId`.
- **More than one server.** Rate limits, the `/me` cache and step-up state move into Postgres (an unlogged table) if the service ever runs more than one replica. At one replica, memory is fine.

### 3.4 Rate limits

All numbers are GUESSes, to be tuned from staging and the first two weeks of use.

| What | Limit | On excess |
|---|---|---|
| Writes per user | 60 a minute, bursts of 10 a second | 429 with a plain message; the form keeps its input |
| Bulk actions | 1 per 10 seconds per user; 200 rows (GP) or 5,000 (Admin, with a dry run) | Refused before it runs |
| Feedback | 20 an hour per user; 8 MB per report (down from 40 MB); rejected by `Content-Length` before parsing | 429 or 413; the outbox holds it |
| Workflow starts (LLM) | Per user a day: 10 research runs (W1) and 5 strategy runs (W5). Service-wide spend cap per day, set by Juan; the kill switch at 100% | Queued for the next day, or an Admin override |
| Connector syncs | One in flight per connector; Affinity within its published quota | Refused with "running since ⟨time⟩" |
| Unauthenticated service paths (§4.2) | 60 a minute per token | 429 |

Two service-wide brakes:
- `READ_ONLY_MODE` makes everyone a viewer during an incident.
- A per-workflow kill switch sits in the flags table, so neither needs a redeploy.

---

## 4. Feedback in the service

### 4.1 Filing

- **Where it goes.** `/api/feedback` writes to `platform.feedback`, and screenshots go to `platform.feedback_attachment` as bytea, streamed. The browser outbox and `clientId` idempotency keep today's contract.
- **Who filed it.** The reporter is the verified roster user from §2.1, never a cookie handle.
- **Numbering.** **The service assigns issue numbers** from a sequence. It is now the one authority, so the Mac stops numbering.
- **The existing issues.** The 114+ issues in `plcos-data/real/issues` are imported once, keeping their numbers. The sequence starts above the highest one.
- **The Issues page is in the service.** Reporters see *Filed → Triaged (class) → Fixed, not released → In staging → Live*. "Live" is true once the production release tag contains `fixed_in`. Agent success and a live fix are separate states (invariant 4).
- **Retention.** Attachments stay in the real plane. The purge rule is Decision 10.

### 4.2 How dev agents receive it

Issue text and screenshots carry real LP data (rev 1 03 §0: issue 0105 names eleven LPs). So they only go where real data may go.

| Path | Who | What they see | Auth |
|---|---|---|---|
| **A. Triage runs in the service** | A service workflow, on an API model under no-training terms | The full issue | Runs inside the service; nothing leaves |
| **B. The Mac pulls** | Claude and Codex on the Mac (local dev) | The full issue, written to `plcos-data/real/issues` as today | A per-agent service token (below) with scope `feedback:read, issue:status` |
| **C. Cloud dev agents** | Claude Code or Codex cloud sessions | **Only the dev brief**: class, route template, repro steps on demo data, and acceptance criteria. No names, no screenshots, no record ids. | Same token type, with scope `brief:read` |

- **Service tokens.**
  - Issued by an Admin in Admin → Access. Stored hashed, revocable, and each one audited.
  - They reach a small set of `/api/agent/*` routes, listed in `publicPaths` and protected by the token check itself (kit: public paths must protect themselves).
- **The dev brief.**
  - The triage workflow (path A) writes it. It rewrites the repro in terms of the demo fixture.
  - Before a brief is released, a check refuses any brief containing a string that matches an entity name, email or id in the real tables.
  - A refused brief stays Mac-only.
- **Status comes back.**
  - Agents post back `status`, `fixed_in` (a commit) and a closing note, which gets the same name check.
  - Fixed issues go to *done*, not *review* (Juan, 0061).

### 4.3 The four-class triage and the decision log

The classes and the who-triggers-what matrix are rev 1 03 §3.2, unchanged:
- **A, no-brainer**: just do it.
- **B, data correction**: just do it, audited.
- **C, contradicts Juan's decisions**: goes to Juan.
- **D, big change**: Juan's own are built behind a flag and reviewed after; the team's are specced first.

Confidentiality, access and outward actions always need Juan's yes.

Rev 2 changes four things:
- **B moves into the service.** A data correction is the reporter's first-person evidence. It is recorded in the service as a claim by that user, with `via: triage`. It is weighted by the confidence model (memory: model uncertainty, no confirmation gates), and it never overrides a fact Juan gave.
  - It is evidence, not a task, so no agent accepts its own proposal.
  - Often the reporter can simply make the edit themselves, now that users act in the database. The triage reply says so.
- **C is checked against `docs/decisions/`, and it cites what it checked.**
  - The build ships the index as data: `decisions-index.ts --json` runs at build time, so the triage workflow reads it in the service.
  - The log starts with the **21 repo-sourced decisions**. It is too thin to catch most contradictions yet. A C check that finds no matching scope says "no recorded decision found (21 entries, repo sources only)" rather than "no contradiction" (invariant 7).
  - Juan's answers to C and D routes appear in an **Asks for Juan** queue in the service. Each answer is committed as a new decision file by the integrating agent. The quote and scope must contain no record names (README rule).
  - Harvesting the rest (code comments, triage notes and memory) is build item 12. It needs Juan's yes for memory files, because the README excludes them today.
- **The mechanical D check is unchanged.** It runs in CI (§5.4). A fix whose diff touches any of these is class D, whatever the issue said:
  - `modules/*/migrations`;
  - `lib/connectors`;
  - `lib/auth` or `lib/authz`;
  - the ticket gate;
  - `config/deployment.ts`.
- **Latency targets** (GUESS):
  - triaged within 5 minutes of filing, as the service workflow runs on insert;
  - a class-A fix in staging within the hour;
  - in production at the next approved release (§5.3).

Token cost of in-service triage (GUESS): about 15k input and 2k output tokens per issue. At 50 issues a day (27 Sep's peak) that is about 1M tokens a day, a few dollars a day at mid-tier model prices.

---

## 5. Development against a live service

### 5.1 Where development happens

| Option | Data | Where it can run | Risk | Fit |
|---|---|---|---|---|
| **A. Mac, with a recent real copy** | A restore of the latest service backup, pulled encrypted | The Mac only (FileVault, encrypted at rest per docs/22) | Real data on a laptop, as today; each pull is an Admin action with step-up and an audit entry | Good for Juan and for performance work on real shapes |
| **B. Mac or cloud, with a scrubbed copy** | The same backup, scrubbed **inside the service** before it leaves (below) | Anywhere with no-training terms: Mac, Claude Code cloud, Codex cloud | De-identified is not anonymous: graph shape and dates can re-identify, so it is still kept out of git and public artifacts | **Default for agents**, and the only real-shaped data cloud agents get |
| **C. Mac or cloud, with invented demo data** (`npm run demo`, `perf4:seed`) | Invented | Anywhere, including CI and screenshots | None | Tests, previews, staging and changelog shots, as today |
| D. A PL-hosted dev VM inside the service's boundary | Real | PL | As risky as the service itself | Ask PL (wishlist). It would untether Juan's real-data dev from the Mac. |

**The scrubbed copy.** A service job, Admin-started or nightly, restores the latest backup into a scratch schema and scrubs it there:
- names become deterministic invented names, seeded by a hash of the record id;
- emails and phones are dropped;
- note, update and issue bodies become filler of the same length;
- amounts are bucketed and jittered;
- R3 Dakota fields are dropped;
- dates are shifted per record by up to ±14 days (GUESS);
- ids, statuses, graph edges and row counts are kept.

The same name check as the dev brief refuses the dump if any real entity string survives. Only then can a token with `copy:scrubbed` download it. This is size M, and it is the piece that makes cloud agents useful without moving real data.

**Copies never write back.**
- `copyTakenAt` already makes a copy refuse real writes (`mutationProfileAllowed`).
- For development, add a `sandbox` profile. It allows writes to the copy, shows a banner ("Copy of ⟨date⟩: changes here stay here"), and can never be promoted.
- Juan's real work happens in the service. His local copy is for trying features on real shapes.

### 5.2 Fast iteration: local ahead of master

Juan wants very fast velocity. The design keeps local fast and puts the brakes only where other people are affected.

- **Local is unbounded.**
  - Claude integrates `claude/main`, Codex works on `codex/*` in worktrees (COLLAB.md), and Juan runs a sandbox copy.
  - No gate beyond `scripts/gate.sh` (tsc, boundaries, props) applies before a local merge.
  - `ship.sh` becomes `ship.sh --target local`, and the local server stops being "live".
- **Master is what CI has checked.** Local branches may be hours ahead. Master moves only on a green gate.
- **Migrations ahead of master.**
  - A branch's migration may be applied to a sandbox copy. If it changes before merging, the copy is discarded and re-pulled. Applied migrations are immutable only once they reach staging or production.
  - Numbering collisions are resolved at integration by renumbering the unapplied file, as `security-fixes` already asks.
- **Flags let production run ahead for Juan.** `lib/features.ts` plus `platform.feature_override` (by user, group or all) gives each feature a default per channel: local on, staging on, production off.
  - Juan turns a feature on for himself in production from Admin → Flags, which needs no redeploy.
  - Flags wrap entry points only, and are removed 14 days (GUESS) after reaching everyone.

### 5.3 Channels

| Channel | What | Data | Deployed by | When |
|---|---|---|---|---|
| **Preview** | A pool of 2 LabOS apps (`plcos-preview-1`, `-2`), assigned to a branch by CI | Invented, seeded at boot into in-container PGlite, reset each deploy | CI, under an approval window (below) | On request: an agent or Juan asks for a preview of a branch |
| **Staging** | One LabOS app, `plcos-staging`, PRIVATE to Juan and the testers, with its own provisioned Postgres | Invented, at production volume (the perf4 fixture) | CI | Every green master commit, under an approval window |
| **Production** | The team's app | Real (the system of record) | CI, after **a human Approve** | A staging build that has passed the gate (below) |

- **Why a pool of previews instead of one per branch.** Each LabOS app is a separate `appId`, visible in PL's directory. There is no preview API, so per-branch apps would litter it. We ask PL for real previews (wishlist).
- **The staging → production gate** (automated; it blocks on any failure):
  - the staging build has been up at least 20 minutes (GUESS) with a passing self-test;
  - no P0 or P1 is open against it;
  - the expand/contract check passes;
  - the 10-minute adversarial subset and the 10-user load pass (§6).
- **Expand/contract migrations** (rev 1 03 §3.6, unchanged).
  - Release N only adds. The backfill is a resumable job in `platform.data_migration`. N+1 switches reads.
  - N+2 contracts, with `-- contract-after: <release tag>`. The gate refuses that line unless the tag is already in production.
  - Rollback is always a redeploy of the previous artifact against the newer schema, so every release must run on the schema one release ahead of it.
- **Smoke tests and rollback.**
  - `/health` returns the commit and the migration ledger.
  - `/api/agent/selftest` runs the loaders for today, the pipeline, routes and an LP page server-side, and returns pass/fail and timings, never data.
  - After a deploy, CI polls `/health` until the new commit appears, then runs the self-test 3 times over 2 minutes.
  - On failure, it re-uploads the previous artifact **with the same token** (the approval window covers it), and files a P0 issue as `reporter: monitor`.
  - Rollback time is a rebuild, measured on staging (GUESS: 3–6 minutes).

### 5.4 Deploys: CI in the repo, pushes by agents, approvals by people

**The repo and CI.**
- **The repo.** A private GitHub repo, `jbenet/plcos-claude`, later a PL org.
- **Agents push their own branches** with a deploy key scoped to this repo:
  - Claude pushes `claude/*` and `master`;
  - Codex pushes `codex/*`;
  - no force pushes;
  - `master` is protected and requires the CI check.
- **This changes a standing rule** (memory: agents never contact the git remote; Juan pushes). That is Decision 11.
- **CI is GitHub Actions** in `.github/workflows/`. On every push it runs:
  - the gate: conflict markers, `tsc`, `boundaries`, and `props` on PGlite and on a Postgres 17 service container;
  - `next build` on a Linux runner, which fixes the macOS-native-module caveat in 06;
  - the tracing audit (`build:traces`);
  - gitleaks on the diff and on the artifact;
  - `npm audit --omit=dev` and osv-scanner;
  - the artifact, built from an allowlist of paths, stored with its SHA-256.
- **CI has no secrets and no real data.** It has nothing that could leak, and a property fails if a workflow file references a secret other than the LabOS polling step.
- **Cost (GUESS).** Props take roughly 10–15 minutes per run on 2 vCPUs. At about 30 pushes a day that is 9,000–13,500 minutes a month, around $100 a month beyond the plan's included minutes.

**Deploying with LabOS approvals.** The kit's connect flow works from CI without the Mac.
1. A job (`deploy.yml`, run by `workflow_dispatch` or on a green master) starts a LabOS connect session.
2. It posts the `connectUrl` and `userCode` to the job summary and to the service's **Admin → Releases** page. That page shows the commits, migrations and flag changes in the release, and an **Approve in LabOS** link.
3. A person approves in LabOS. Juan can do it from the iPad.
4. The job polls, holds the token only in the runner's memory (masked with `::add-mask::`, never written to disk), and uploads the artifact.
5. It runs the smoke checks, rolls back if they fail, and exits. The runner is discarded.
6. **One approval opens an hour-long window.** During it, the job may deploy the previews and staging repeatedly, but production **once**.

**Who approves:**
- **Previews and staging:** any member with `ai_apps.write` whom Juan names as a builder-approver.
- **Production:** Juan, or the backup approver.
- **Agents never approve.** Agents can prepare, build, test and request a release. The Approve click is the human acceptance ("no tool accepts its own proposed task").

**Open question for PL:** is a token held in an ephemeral CI runner's memory acceptable under "memory only"? If not, the same flow runs from any agent session: a cloud Claude session, or the Mac as a fallback, not a dependency.

**Wishlist to PL:** an app-scoped, revocable CI deploy token for the preview and staging apps, so they deploy unattended. Production keeps the human Approve.

**Cadence.** Production deploys whenever Juan approves. We suggest at most one an hour, plus hotfixes, rather than rev 1's two fixed trains, because Juan wants speed and flags carry the risk. Each release writes a `rel/production/<yyyymmdd>-<n>` tag and a "What's new" entry (rev 1 03 §3.8, with no issue titles copied).

---

## 6. Testing before and after launch

Rev 1 05 holds for method: autocannon plus Playwright personas, and the attack families, the canary strings, the header checks and the go/no-go checklist. Rev 2 adds the following.

**Load with real concurrency (staging, invented data at real volume):**
- **The mix.** 10, 20, then 30 Playwright personas: Juan as Admin, GPs across vehicles, and viewers. Each writes as well as reads: pipeline moves, touchpoints and strategy edits, on overlapping LPs to force version conflicts.
- **Running alongside:** one connector-shaped sync (fixture-backed), one W1 and one W5 run (stubbed model, real queueing), and one import.
- **Pass (GUESS):**
  - list pages p95 < 1.5 s and heavy pages p95 < 4 s;
  - 0 5xx;
  - every version conflict surfaces as a 409, with 0 silent lost updates, checked by replaying the audit log against final state;
  - hard and soft totals conserved (invariant 10);
  - RSS < 80% of the granted limit;
  - pool waiters return to 0.
- **Overnight soak:** 8 hours at 10 users with workflows running.
- **Real-shape performance** runs on a local sandbox copy (Option A), never in staging.

**Adversarial users on staging.** Personas are invented LabOS test members, or a staging-only header identity that the production build refuses at boot. The new attacks, because Admin surfaces now exist in the service:
- As a GP or Viewer: call every Admin action ID found in any client bundle, by raw `Next-Action` POST. Expect refusal and no row changed.
- Step-up bypass: an Admin session without a passkey, a replayed passkey assertion, and a step-up that has expired.
- Vehicle-scope escape: other-vehicle ids in forms and URLs, and bulk lists mixing vehicles.
- Tickets: self-approval in every kind; approving outside `approves`; an expired ticket; a double decide.
- Undo abuse: undo or revert someone else's write, revert after an intervening change, and revert a job twice.
- Token replay: present a LabOS token from a sibling origin without our session cookie; a stale `/me` cache after a user is removed from the roster (expect loss of access within 5 minutes).
- Service tokens: out-of-scope routes, a revoked token, and a flood.
- Name-leak probes: planted canary names in feedback must never appear in a dev brief, a closing note, "What's new", CloudWatch or analytics.
- Rate limits: exhaust each bucket; the form must not lose input.

**Pass:** 0 findings at severity medium or above, and 0 canary hits. Findings go to staging's own Issues, never production's. The regression set grows from every real failure, and agents cannot edit its pass criteria.

**Restore drills:**
- **Before launch:** restore the latest production backup into an isolated real-plane database, either a PL restore slot or a Mac sandbox (Decision 13).
- **Then check:** run the self-test, verify row counts against the backup manifest, and verify the audit hash chain head.
- **Measure RTO (target < 1 h, GUESS) and RPO.** Repeat monthly.
- **Every sandbox-copy pull (§5.1 A) is itself a restore**, checked by the same self-test. Routine development then proves backups continuously.

**After launch:**
- **Monitoring.** Per-route p95, event-loop p99 (`lib/responsiveness.ts`), RSS and 5xx are exported by `/health`, carrying ids and counts only. The logs are scanned every 10 minutes. A breach files a P0/P1 as `reporter: monitor`.
- **The nightly adversarial suite** keeps running on staging.
- **The correction budget** (`config.agents.correctionBudgetHoursPerWeek`) is measured from issue classes B and C against agent-made changes. Crossing it freezes new agent autonomy (AGENTS.md circuit breaker).

---

## 7. Decisions for Juan

1. **LabOS identity checked server-side (`/me`), plus our own HttpOnly session, as authentication**, against the kit's "personalization only"? *Suggested: yes. It is the only identity PL offers. Step-up (3) covers what a replayed token could do.*
2. **Roles Admin / GP per vehicle / Viewer, with GPs defaulting to all vehicles, and a backup Admin named now?** *Suggested: yes. Name the backup Admin, who is also the backup release approver, this week.*
3. **A passkey step-up for Admin actions and for MONEY and ALLOCATION_EXCEPTION approvals?** *Suggested: yes, 15 minutes per step-up.*
4. **Developer and operations pages in the service, Admin-only (404 to others)**, with the switcher, `reloadInit` and repo-file writers still removed? *Suggested: yes.*
5. **The GP/Admin split in §3.1**: GPs start W1 and W5 runs for their vehicles within a daily budget; imports, merges, re-points and syncs are Admin-only? *Suggested: yes.*
6. **Approvers:** you, plus one named approver per vehicle for MONEY and ALLOCATION_EXCEPTION; GPs approve STAGE, INTRO_ASK and SEND only when listed? *Suggested: yes. Tell us the names.*
7. **Concurrency:** version checks on status/stage, amounts, consent, strategy and SPV stance; everything else append-only; workflows turn into proposals when a human changed the record since they started? *Suggested: yes.*
8. **Rate limits and a daily service-wide LLM spend cap:** what cap? *Suggested: start at $50 a day (GUESS), with the kill switch at 100%.*
9. **Where dev agents work:** real copies on the Mac only, pulled by an Admin with step-up; scrubbed copies (scrubbed inside the service) allowed in Claude and Codex cloud sessions; invented data everywhere else? *Suggested: yes. The scrubbed copy is still treated as confidential: no git, no public artifacts.*
10. **Feedback in the service,** numbered there, with triage run in the service, full issues pulled to the Mac, and only name-checked dev briefs going to cloud agents? Delete attachments 90 days after an issue is done? *Suggested: yes to both.*
11. **Agents push to GitHub with a repo-scoped deploy key** (Claude to `claude/*` and `master`, Codex to `codex/*`), and CI runs in GitHub Actions on demo data with no secrets? *Suggested: yes. This replaces "Juan pushes"; you add the public key once.*
12. **Deploy approvals:** builder-approvers for previews and staging; you or the backup for production; each production deploy is one LabOS Approve click, as often as you like? *Suggested: yes, at most hourly plus hotfixes.*
13. **Restore drills against real backups:** in a PL-provided isolated restore slot, or on the Mac? *Suggested: ask PL for a slot; use the Mac until then.*
14. **Decision log:** extend `docs/decisions/` beyond the 21 repo-sourced entries by harvesting code comments, triage notes and **memory files** (the README excludes memory today)? *Suggested: yes, each entry reviewed before committing, with no record names.*
15. **Migrating today's local primary:** at cut-over, the Mac's live database is frozen read-only and becomes the first restore-drill target? *Suggested: yes. The workflows section owns the cut-over itself.*

## 8. For the PL infra wishlist (this section's items)

- An app-scoped, revocable **CI deploy token** for preview and staging apps.
- A **rollback** call and a deployment list.
- **Preview environments** per branch.
- A **second Postgres role**, a migration owner, so the app user cannot disable the audit trigger. Or at least a read-only role.
- **Backups and PITR:** confirmed, with an **isolated restore slot** for drills.
- A clear answer on **who at PL can read the database, CloudWatch logs and PostHog events.**
- A **verifiable identity** for apps: a signed, audience-scoped header or JWT, or an HttpOnly per-app token. This would retire step-up as a workaround.
- A way to **opt out of PostHog error text and full-path route sync.**
- Runtime size to be set after the unmeasured runtime run. The provisional ask stays **2 GiB and 1 CPU** for production and staging, and **≥ 1.5 GiB** for previews, because they run PGlite in-container. We also ask for 4 GiB to build, or acceptance of a prebuilt artifact.

## 9. Build order

**Tonight (no decision needed; local, demo data, tested):**

1. **S.** Run the Postgres property suite and the HTTP smoke that `security-fixes` and `feedback-reporter` could not, then integrate both.
2. **S.** Finish 06: runtime RSS and p95 on a demo production build (Postgres), 10 concurrent requests for 300 s, and one import alongside.
3. **M.** `lib/authz`, `can` and `requireCan` layered on `requireServerActionMutation`, with the §3.1 table, approver authority in `decideTicket`, and a property that every action is covered and every Admin action refuses GP and Viewer. Roles default to today's behaviour locally.
4. **S.** A platform migration: `app_user.labos_uid unique`, `access`, `vehicles`, `approves`, plus the init-file fields.
5. **S.** The audit hash chain (`prev_hash`, `row_hash`, a trigger, and a nightly verify script). The actor and `via` become required.
6. **M.** Version columns and 409 handling on the §3.3 fields; request-id idempotency; bulk "skipped because changed"; race properties.
7. **M.** Undo toast plus Revert from history; retraction for evidence; revert by `job_id` for bulk actions and imports.
8. **S.** Rate limits (in memory, one replica), the 8 MB feedback cap by `Content-Length`, `READ_ONLY_MODE`.
9. **M.** `lib/features.ts` plus `platform.feature_override`, and the Admin → Flags page.
10. **M.** CI: `.github/workflows/gate.yml` (the gate with Postgres 17 as a service container, a Linux build, the tracing audit, gitleaks, audit, and the artifact with its hash). It is written tonight, but it **runs only after Decision 11**, because nothing is pushed until then.
11. **S.** `ship.sh --target` and the expand/contract check (`contract-after:`) in the gate.
12. **S.** `scripts/decisions-index.ts --json` at build time; the triage C check cites what it searched. Harvesting code comments and triage notes into new decision files for review is part of this; memory files wait for Decision 14.

**After decisions 1–4 and PL's answers:**

13. **M.** The `labosAuth` provider: `/me`, the cache, our `__Host-` session, the 401 and 403 pages, and tests against a fake `/me`.
14. **M.** Passkey step-up (Decision 3).
15. **M.** Admin-only gating of the Developer and operations pages (Decision 4), the "view as" read-only mode, and the Admin → Access and Activity pages.
16. **M.** Feedback in the service: the tables, service numbering, the import of existing issues, the Issues page states, and `/api/agent/*` with service tokens (Decision 10).
17. **M.** The in-service triage workflow and the name-checked dev brief.
18. **M.** The scrubbed-copy job and the `sandbox` profile (Decision 9).
19. **M.** `deploy.yml`: the connect flow, the Admin → Releases page, smoke tests and rollback (Decisions 11–12). Staging first, then the preview pool.
20. **M.** The staging load, adversarial and restore drills (§6), then the go/no-go checklist and a production deploy that you sign off.

**Sizes:** items 1–12 are about two nights of parallel builder work (GUESS). Items 13–20 are about three to four nights once decided.

## 10. Feedback for the kit devs

These are in addition to rev 1's list, which stands.

- **The deploy connect flow works from CI.** Please say whether an ephemeral CI runner may hold the token in memory. Better still, offer an app-scoped CI token for non-production apps.
- **Admin surfaces inside apps need a verifiable, audience-scoped identity.** Replaying a JavaScript-readable shared token turns any sibling app's script-injection bug into admin access elsewhere. Until then, the kit should tell apps with privileged actions to add their own step-up.
- **One database user means the app owns its own audit log.** Please offer a migration-owner role.
