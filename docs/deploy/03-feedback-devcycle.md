# 03 — Feedback, the dev cycle and fast iteration

Plan for Juan's review, 28 Sep 2026. Planning only; nothing here is built. It depends on the
deployment section (where the app and its database run) and the workflows/data-sync section (which
database is the writer for what). Where those are undecided, this section says what it assumes.

## 0. Where we are today (measured, 28 Sep)

- **Volume.** 114 real issues from 23 Sep 23:47 to 28 Sep 00:00 UTC, 50 of them on 27 Sep. 97 carry a
  "Done" note. 94 have a screenshot. The real issues folder is 48 MB, mostly attachments.
- **Path.** Feedback box → `/api/feedback` journals to `data/real/issues/inbox/<clientId>.json` and answers
  202 (`lib/feedback-inbox.ts`) → the ingest loop files `NNNN-slug.md` every 10 s
  (`lib/feedback-ingest.ts`) → a best-effort `platform.feedback` row and audit entry. The browser keeps an
  outbox and resends on failure (`lib/feedback-outbox.ts`, `lib/feedback-journal.ts`). `IssueSink` has a
  GitHub/Linear seam that refuses today (`lib/issues/github.ts`).
- **Who files.** In practice, only Juan. Issues 0064–0114 say `reporter: unknown`, with the context noting
  "unverified local cookie; database lookup pending". The triage policy below depends on who the reporter
  is, so this is a bug to fix before anyone else files.
- **Defaults carry no signal.** Almost every issue is `kind: bug, priority: P2`. Triage cannot use them.
- **Issues contain real data.** Titles and bodies name LPs (0105 lists eleven). Screenshots show whatever
  was on the page. Context blocks carry entity UUIDs.
- **Ship path.** `ship.sh` runs the gate (conflict markers, tsc, boundaries, props), fast-forwards
  `claude/main` into master in the live folder, curls `/today`, `/neurotech/pipeline` and
  `/developer/enrich` for a 200 with no build error, and `git reset --hard`s back and restarts if they
  fail. It was added after live served 500s for about 12 minutes on 27 Sep. **It lives in a session
  scratchpad, not in the repo.** It has to move into `scripts/` before anything below builds on it.
- **Decisions are scattered.** There are 123 dated "Juan, NN Sep" quotes across 90 files (code comments,
  docs, changelog). There are also memory files and triage notes (10 issues have a "## Triage" section).
  None of this is in one place an agent can check against.

## 1. What the kit / LabOS provides

- **Deploys are ZIP uploads with a token a person has to approve.** A connect session gives a link. A
  member with `ai_apps.write` signs in to LabOS and clicks Approve. The token lasts about an hour, is held
  in memory only, and each new session needs approval again (`deploy-to-labs/SKILL.md` step 3;
  `README.md`, "How deploy authorization works"). **No unattended deploys.**
- **One `appId` per app.** It is global across PL, and `deploymentId` is unique per upload
  (`deploy-to-labs/SKILL.md`, Notes). The kit has no staging environment, no list of deployments, and no
  rollback endpoint. **A second environment means a second app.**
- **Health.** `GET /health` must return 200. The skill polls it after upload (`AGENTS.md`, "Building the
  app"; `deploy-to-labs/SKILL.md`).
- **Logs.** Build and runtime logs sit in CloudWatch and are fetched by time window with the deploy token.
  Each event carries its `deploymentId`, so a redeploy does not hide the previous pods' output
  (`app-logs/SKILL.md`).
- **Database.** An optional PL-provisioned Postgres (managed RDS). Its connection is injected as env vars.
  "You never touch a password or connection string" (`README.md`; `deploy-to-labs/SKILL.md`). Migrations
  follow the `_pln_migrations` ledger pattern, run in filename order, idempotent, and fail loudly
  (`db-migration/SKILL.md` §6a). Data copies resume by table (§6b). **Our Mac cannot connect to that
  database directly. Anything going up or down has to pass through the app.**
- **Public paths.** `publicPaths` (e.g. `/api/*`) skip LabOS sign-in, "so the app must protect them
  itself" (`README.md`; `deploy-to-labs/SKILL.md`, "Public endpoints").
- **Identity.** The LabOS `authToken` cookie reaches the app's origin. `GET …/v1/ai-apps/me` returns the
  member's uid, name and teams (`pln-member-context/SKILL.md`). **This is how a reporter gets verified.**
- **Analytics.** Baseline `opened`/`error`/`closed` events are mandatory. Error events send up to 300
  characters of the error message to PL's PostHog. Route sync posts path and title to the dashboard
  (`app-analytics/SKILL.md`). This leaves our system; see §3.9.
- **Runtime budget.** 384 Mi memory (a hard OOM kill), 300m CPU, and "don't spawn extra worker
  threads/processes" (`AGENTS.md`, "Resource limits").
- **Not documented anywhere in the kit:** a persistent disk or volume. We assume the container filesystem
  is lost on redeploy.

## 2. Options

### 2a. Getting feedback from the deployed app to the agents

| | Cost | Risk | Fit |
|---|---|---|---|
| **A. Keep issue files on the deployed server and sync them down** | S | High: no documented persistent disk, so a redeploy can lose unsynced reports. Two servers would number issues independently. | Poor as described. Works only if the files are written to the database anyway, which is option C. |
| **B. GitHub issues in a private repo** | M (the `IssueSink` seam exists) | **High, confidentiality.** Titles, bodies and screenshots carry LP names. Automatic redaction can't be trusted: names show up as first names, firm names and in screenshots, and one miss puts real LP data in a third-party service. A redacted issue (number, route template, class) is too thin to act on. | Poor. GitHub is good for code review, not for this content. |
| **C. A feedback table in the deployed database, pulled down locally** | M | Medium: the real feedback lives in PL's database, the same boundary as deploying at all. The pull runs through a public path protected by our own secret. | **Good.** `platform.feedback` already exists. The local inbox → ingest → file path stays exactly as it is, and agents keep reading markdown where it is. |

### 2b. Where development runs

| | Cost | Risk | Fit |
|---|---|---|---|
| **A. Stay on Juan's Mac** (Claude and Codex worktrees; deploys pushed up from there) | none now | The Mac is a single point of failure and has to be awake. Juan has to approve a LabOS token for each deploy session. | **Good now.** Real data, Keychain secrets, the Max plan and the ChatGPT workers are all already here. |
| **B. Move dev to the cloud** (Claude Code/Codex cloud sandboxes or a VM) | L | **Confidentiality:** real data and connector keys move into agent cloud environments. Dakota data "never leaves our system". The no-training rule would have to hold for each provider. | Poor until PL offers a dev host under the same boundary as the deployed database. |
| **C. Hybrid later:** dev stays local, demo-data CI runs in the cloud | M | Low: demo data only. | Good once the repo section pushes code somewhere CI can see it. |

### 2c. Release path

| | Cost | Risk | Fit |
|---|---|---|---|
| **A. Ship local live straight to production** | S | Every local merge lands on the team. The 27 Sep outage would have hit ~10 people. | Poor. |
| **B. Three channels** (local live → staging → production) with promotion rules and flags | M | A little lag for the team, none for Juan. | **Good.** Juan keeps his speed, and the team gets tested builds. |

## 3. Recommendation

Options **2a-C**, **2b-A** and **2c-B**. Feedback lands in the deployed database and is pulled to the Mac
within about a minute, then filed through the existing inbox. Development stays local. Releases move
forward through three channels, each promotion taking only a commit already proven on the channel before
it. The reason: this keeps real data where it already is, reuses the working feedback path, and lets
Juan run far ahead of the team without the team paying for it.

### 3.1 Feedback pipeline

1. **Deployed side.** `/api/feedback` writes a `platform.feedback` row plus a
   `platform.feedback_attachment` row (bytea, streamed, never buffered whole under 384 Mi). It keys on
   `clientId` and answers 202, the same contract as today. The reporter is the LabOS member uid, checked
   server-side with `/v1/ai-apps/me`, never a cookie handle. **No issue number is assigned on the deployed
   side**, so numbering keeps one authority (COLLAB.md: "file issues only from the live app").
2. **Pull.** A launchd job on the Mac, `scripts/feedback-pull.ts`, runs every 60 s (GUESS). It calls
   `GET /api/sync/feedback?since=<cursor>` on production and staging. That path is declared in
   `publicPaths` and protected by an HMAC over a timestamp. The key is kept in the Keychain and in LabOS
   secrets. The job writes each report as `inbox/<clientId>.json`, the same shape as today, and the
   existing ingest loop files it. Numbers stay local and sequential; a report from staging gets the label
   `channel:staging`.
3. **Push back.** `POST /api/sync/issues` sends up each issue's number, status, `closed_at`, a closing note
   with no real data, and `fixed_in` (the commit). The deployed Issues page shows the reporter their
   issue's number and state.
4. **"Fixed" is not "live for you".** The deployed page shows three states: *Fixed, not yet released*
   (`fixed_in` is on master only), *In staging*, and *Live*. The last two are true once the channel's
   release tag contains `fixed_in`. This follows the domain rule that agent success and acceptance are
   separate states.
5. **Triage trigger.** A new file triggers the triage agent on the next 10–15 minute heartbeat
   (operations.md). A P0 (production down, data wrong on screen, a confidentiality leak) triggers it at
   once and raises a notification on the Mac.

Target latency, all GUESSes to measure: report → local file under 2 minutes; triaged under 15 minutes; a
no-brainer fixed in local live within the hour; live for the team at the next production promotion
(§3.4).

### 3.2 Triage policy: who triggers what

**Classes.** Four, not three: the real issues show a fourth, data corrections.

| Class | Test | Examples (issue numbers only) |
|---|---|---|
| **A. No-brainer** | Something is broken against its own spec, or it is copy, small UX (order, alignment, hide or show, scroll, a default), or performance. No change to what a record means. No new page. | 0014, 0018, 0019, 0029, 0056, 0059, 0072, 0080, 0081, 0106, 0114 |
| **B. Data correction** | A first-person fact about a record ("I know them", "is on our team", "these are duplicates", wrong type). Evidence, not code. | 0039, 0046, 0063, 0094, 0095, 0105 |
| **C. Contradiction** | Reverses or conflicts with a recorded decision of Juan's: design boards S1–S3, the AGENTS.md invariants, a dated "Juan, NN Sep" decision, an earlier triage or closing note. | Filed by anyone but Juan, these would be C: 0010 (theme default), 0102 and 0110 (navigation order). 0083 is the reverse case: an agent's redesign contradicted Juan's design, and he caught it. |
| **D. Big change** | A model (scoring, routing, confidence, identity); a new page or a page redesign; data semantics (statuses, entity types, soft/hard, what counts); anything touching confidentiality, access, connectors, or outward actions (SEND, INTRO_ASK, MONEY, STAGE, ALLOCATION_EXCEPTION); a contracting migration. | 0036, 0042, 0044, 0048, 0077, 0078, 0087 |

**Who triggers what.**

| | Juan | Team member | Agent-filed |
|---|---|---|---|
| **A** | Do it. | Do it. If it changes a page everyone uses, put it behind a flag for a day. | Do it, within that agent's own work envelope. |
| **B** | Apply as a reviewed fact, noted as "on Juan's word" (memory: routing model). | Record as the reporter's first-person evidence and weight it in the confidence model. It never overrides a fact Juan gave. | Evidence at the agent's confidence. |
| **C** | It is his new decision. Do it, and record it as superseding the old one in the decision log. | **Route to Juan**, citing the conflicting decision. Tell the reporter "this conflicts with decision X; asked Juan". Don't build it. | Route to Juan. |
| **D** | Build now behind a flag, and he reviews after (his 26 Sep instruction: "don't wait for my review"). Two exceptions still need his explicit yes before building: confidentiality/access and outward actions. | **Review first.** Claude writes a spec ending in "Done when", Juan approves, then it is built. Page designs stay with Claude (memory, 27 Sep). | Review first. |

**How the agent classifies, and what it cites.** Claude runs triage. It reads the issue file where it is;
the content never goes into a sub-agent prompt. It writes a `## Triage` block containing:
- `class: A|B|C|D`;
- `reporter_verified: yes|no` (an unverified reporter is treated as a team member);
- `evidence:`, a list of the decisions checked, each with its path and date. The candidates are the
  **decision log**, AGENTS.md invariants and "Do not build", `docs/agent-rules/*.md`, the design-board
  page, and earlier issues on the same route (the context block's `route` finds them). For B, the
  evidence is the record's current facts and their sources;
- `why:`, one sentence. For C it names the decision contradicted. For D it names which trigger fired.

The classifier is conservative:
- If both "A" and "D" are plausible, it is D.
- A diff that touches `modules/*/migrations`, `lib/connectors`, auth, the ticket gate or `config/deployment.ts`
  is D, whatever the text says. This is checked mechanically against the fix's diff before merge, so a
  "copy fix" that grew into a model change gets caught.
- Any route to Juan carries the quoted decision, so he can answer in one line.

**The decision log is the missing piece.** Build `docs/decisions/` as one short file per decision (date,
decision, quote, source path, scope: pages, modules, fields). Seed it by harvesting the 123 dated quotes,
the memory files and the triage notes. After that, every Juan answer to a C or D route appends one. The
contradiction check greps this log by scope, so it doesn't reason from memory.

### 3.3 The dev cycle

Development stays on the Mac: master in `plcos-claude-live`, and the Claude and Codex worktrees as in
COLLAB.md. Deployed feedback reaches the agents as ordinary issue files (§3.1), so nothing downstream
changes. Two additions:
- **Production and staging runtime logs** are pulled by the same heartbeat whenever a deploy token is
  live. They are scanned for 5xx and OOM, and a hit files a P0/P1 issue itself (`reporter: monitor`).
- **Reproducing a deployed bug** happens on a preview copy (COLLAB.md), never against the deployed
  database.

Cloud dev (2b-B) is revisited only if PL offers a host under the same boundary as the deployed database.

### 3.4 Release channels and promotion

| Channel | Runs | Data | Who | Moves when |
|---|---|---|---|---|
| **Local live** | master on the Mac (`:3000` real, `:3001` demo) | real, local | Juan | `ship.sh`: the gate, a fast-forward, smoke, automatic rollback. Many times a day. |
| **Staging** | a second LabOS app, e.g. `<appId>-staging`, PRIVATE (Juan plus named testers) | demo profile by default (see decision 4) | Juan, testers | A master commit that has run on local live for ≥ 30 min (GUESS) with no rollback. |
| **Production** | the team's app | the team's real data | team | A commit that passed staging (below). Two trains a day, plus hotfixes. |

- **Promotion rules for staging → production.** The staging build has been up at least 30 min (GUESS);
  its smoke and self-test pass (§3.7); no P0/P1 is open against it; its migrations pass the expand/contract
  check (§3.6); memory under the stress script stays below 300 Mi (GUESS, against the 384 Mi limit).
- **Release tags.** Each promotion writes a tag `rel/<channel>/<yyyymmdd>-<n>`. It records the commit,
  the migration inventory, the flag defaults and the ZIP's hash. The ZIP is kept locally (last 10) for
  rollback.
- **Who approves.** Every deploy needs a person to approve a LabOS token (§1). So the morning and evening
  trains are one Approve click each, by Juan or someone he names with `ai_apps.write`. That click is the
  release approval. Claude does everything else. A hotfix is the same click, off-train.
- **Local runs ahead by design.** Production lags local by up to half a day. Flags (§3.5) let Juan turn a
  feature on for himself in production before the team sees it.

### 3.5 Feature flags

Kept deliberately small:
- A typed list in `lib/features.ts`. Each flag has an owner, a creation date, a default per channel
  (local on, staging on, production off), and a removal date 14 days (GUESS) after it reaches everyone.
- Overrides by group (`juan`, `team`, `all`) live in a `platform.feature_override` table. Juan toggles
  them from the Developer page, with an audit entry. **A toggle needs no redeploy**, which matters because
  each redeploy needs a person to approve.
- Flags wrap entry points (a navigation item, a button, a page), not deep logic.
- Costly or risky features (LLM calls, imports) also get a production kill switch.
- Local-only features (imports, workflows, connectors) are not flags: the user-proofing section strips
  them from the deployed build.

### 3.6 Migrations and data migrations across versions

Migrations run at server boot under an advisory lock (docs/21). During a deploy, the old code can
therefore run against the new schema, and a rollback runs old code against it for good. The rule is
**expand/contract**:
- **Release N (expand).** Only additive changes: new tables, nullable columns or columns with defaults,
  new enum values, new indexes (concurrently). The code writes both shapes and reads the new one when it
  is present.
- **Backfill.** A data migration is a resumable, idempotent job, not part of the schema migration. It is
  recorded in `platform.data_migration` (name, cursor, rows, finished), following the kit's §6b
  per-table progress pattern. It runs in small batches on the main event loop within the 20 s statement
  timeout and the 384 Mi limit, and runs once per database (local real, staging, production).
- **Release N+1 (switch).** Reads use only the new shape.
- **Release N+2 (contract).** A migration that drops, renames or narrows something must say
  `-- contract-after: <release tag>`, and the gate refuses it unless that tag is already in production.
  Today 4 of the 79 migration files contain a drop, rename or alter, so this is rare and cheap to enforce.
- Applied migrations stay immutable (AGENTS.md), and there is no schema rollback: fixes go forward.

### 3.7 Smoke tests and rollback on deployed channels

- **Move `ship.sh` and its gate into the repo** (`scripts/ship.sh`, `scripts/gate.sh`) before anything
  else here.
- `/health` returns 200 only when the database answers and the migration ledger matches the build. It
  also returns the commit.
- `/api/sync/selftest` (HMAC-protected) runs the loaders of the key pages (today, pipeline, routes, an LP
  page) server-side. It returns pass/fail and timings, never data. A curl from the Mac can't get past
  LabOS sign-in, which is why this runs on the server.
- **After each deploy:** poll `/health` until it reports the new commit, then run the self-test 3 times
  over 2 minutes. On failure, re-upload the previous release's ZIP. The kit has no rollback endpoint, so
  a rollback is a rebuild and takes minutes, not seconds (measure it). §3.6 makes the old code safe on
  the new schema.

### 3.8 Changelog and communication

- **The developer changelog stays as it is** (`docs/changelog/entries/<version>.md`, demo screenshots,
  Developer → Changelog).
- **Team release notes, new.** Each production promotion writes a short "What's new" entry, shown in the
  deployed app with a dot on the sidebar until it is read. It lists user-visible changes in plain words,
  then "Fixed: 0114, 0106 …" by number with a rewritten title. **No issue title is copied**, because
  titles can name LPs, and no real screenshot is used. A property check refuses a release note
  containing any known entity name.
- **Each reporter** sees their issue move to *Live* on the deployed Issues page (§3.1).
- **Anything posted outside the app** (a Slack or email digest) is drafted, not sent, unless Juan
  approves an internal channel (decision 7).

### 3.9 Confidentiality boundaries this section touches

1. **Feedback text and screenshots are stored in PL's database.** Screenshots capture whatever was on
   screen. Mitigation: purge attachments on the deployed side 30 days (GUESS) after a confirmed pull. The
   local copy stays the record.
2. **A public sync path exposes feedback and status to anyone holding the HMAC key.** Mitigation: a
   timestamped HMAC, rate limits, no data in the self-test, key rotation, and a scope limited to feedback
   and issue status (the data-sync section may widen it; that is its decision).
3. **PL's CloudWatch logs and PostHog error events.** Our server must not log record names, and error
   messages must be stripped of entity text before the analytics hook sends them.
4. **Triage agents read issues where they are**, never in a prompt. This is unchanged from today.
5. **Cloud dev** would move real data into agent sandboxes. It is not recommended now.

## 4. Decisions for Juan

1. **Feedback transport:** a feedback table in the deployed database, pulled to the Mac every minute,
   with no GitHub issues? *Suggested: yes.*
2. **Triage matrix:** four classes (A no-brainer, B data correction, C contradiction, D big change), with
   your D items built now behind a flag and the team's D items spec'd and reviewed by you first?
   *Suggested: yes, with confidentiality/access and outward actions always needing your yes.*
3. **Dev location:** stay on the Mac, and revisit cloud dev only when PL offers a host inside the same
   boundary? *Suggested: yes.*
4. **Staging data:** demo data only (no second real copy in PL infra), with migration rehearsal on a
   local real snapshot? Or a real copy? *Suggested: demo only.*
5. **Production cadence:** two trains a day plus hotfixes, each started by your one LabOS Approve click?
   Or do you name a second approver? *Suggested: two trains, and name one backup approver.*
6. **Attachment retention on the deployed side:** purge 30 days after pull? *Suggested: yes.*
7. **Team comms:** in-app "What's new" only, or also a digest posted to an internal channel?
   *Suggested: in-app only for now; digest drafted for you to send.*
8. **Decision log:** create `docs/decisions/`, seeded from the 123 dated quotes, as the source the
   contradiction check uses? *Suggested: yes.*

## 5. Build list

Tonight, with no decision needed (local only):
1. **S.** Move `ship.sh` and the gate from the scratchpad into `scripts/`; `npm run ship`.
2. **S.** Fix reporter identity on local filing (51 issues say `unknown`).
3. **M.** Seed `docs/decisions/`: harvest the dated quotes, memory and triage notes into one file per
   decision, with a scope. (This makes it the input for decision 8; no data goes anywhere.)
4. **M.** The triage block: class, evidence, why. Add the mechanical D-check on fix diffs (migrations,
   connectors, auth, ticket gate, config) to the gate.
5. **S.** The expand/contract check in `boundaries`: a drop, rename or narrowing needs `contract-after:`.
6. **M.** `lib/features.ts` and `platform.feature_override` (an additive migration), with the Developer
   page toggle and audit.
7. **S.** A `platform.data_migration` ledger and a batch runner.
8. **S.** `/health` with a database check, ledger check and commit; `/api/sync/selftest` on local first.

After decisions 1, 4 and 5 (and the deployment section's choice of host):
9. **M.** The deployed feedback route with verified LabOS reporter, attachments table and no numbering.
10. **M.** `/api/sync/feedback` and `/api/sync/issues` (HMAC, public paths), plus `scripts/feedback-pull.ts`
    under launchd.
11. **M.** `scripts/promote.ts`: tag, ZIP, LabOS upload, health/self-test, rollback to the previous ZIP;
    staging app first, then production.
12. **S.** Fixed / In staging / Live on the deployed Issues page.
13. **S.** The "What's new" page and generator, with the entity-name refusal check.
14. **S.** Runtime-log scan to automatic P0/P1 issues.

## 6. Feedback for the kit devs

- **Unattended deploys.** Give each app a scoped, revocable deploy-only token, or a Git-connected deploy.
  An hourly human Approve blocks automated promotion and automatic rollback.
- **Rollback and history.** Add a list of deployments and a "roll back to deployment X" call that reuses
  the stored image. A rebuild-to-roll-back takes minutes during an outage.
- **Environments.** Add first-class staging per app (its own database and access list) instead of a
  second `appId`.
- **Document whether the container has a persistent disk.** We assumed not.
- **Analytics.** Let an app opt out of sending error messages, or supply a scrubber. Apps holding
  confidential data can't send free-text errors to a shared PostHog.
- **Resources.** 384 Mi is tight for a Next.js SSR app over a real graph. Document how to request more,
  with the evidence expected.
