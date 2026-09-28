# Capital OS as a deployed service: the plan, rev 2 (for Juan's review, 28 Sep 2026)

> **Superseded by [rev 3](../rev3.md)** (28 Sep 2026): one machine, far fewer parts. Kept for the record.

This merges four inputs in this folder: A (service and infrastructure), B (cloud workflows) and C (users
and the dev cycle), written by Claude planners, and Astra's independent plan. It replaces rev 1
(`../00-plan.md`) wherever the two conflict. Rev 1's premise, that the Mac keeps the connectors and
pushes bundles up, is gone. Numbers come from the inputs and were spot-checked against the code
(`claude/main` at `f6fc062`), the kit (v1.13) and `../06-measurements.md`. **GUESS** marks anything
unmeasured. No real records appear here.

## 1. The shape

**The service is the system of record.** Its Postgres is the only primary. Every user acts in it as
themselves, and every write carries its actor. The Mac is a development machine: switching it off stops
nothing.

We ask PL for an **extended LabOS app**, keeping the same front door (os.pl.xyz, LabOS sign-in, the
iframe). Behind it runs **one image with four commands**, so every process runs the same commit:

| Process | Does | Holds | Size at launch (request / limit) |
|---|---|---|---|
| **web** (`next start`) | Pages, server actions, the queue UI. Enqueues jobs and never runs them. No child processes. | DB role `plcos_app`. No connector or model keys. | 1 GiB, 1 vCPU / 2 GiB, 2 vCPU. 1 replica, 2 later |
| **worker** | Claims jobs from Postgres: the 13 import kinds, the connector syncs, W3, network and SPV derivation | `plcos_worker`; the four connector credentials | 2 GiB, 2 vCPU / 4 GiB, 4 vCPU. 1 replica |
| **agents** | Server-side W1, W1c, W5, W12, W13 and W14 on API models. Reads only its assigned inputs through tools. Writes only staged proposal rows, through the worker's API. | Model API keys only. No DB password, no connector keys. | 1 GiB, 0.5 vCPU / 2 GiB, 1 vCPU. 4 concurrent runs (GUESS) |
| **cron** | Every minute, one tick that enqueues due rows from `platform.schedule`. Idempotent by `(job, window)`. | `plcos_worker` (to enqueue) | Seconds, 256 MiB |

*Chosen over Astra's 2 replicas of each (21 GiB): the database is 640 MB and runtime memory is still
unmeasured, so we start with 1 replica each and scale by configuration. Rate limits and the `/me` cache
live in Postgres from the start, so a second web replica needs no code change.*

**The agents' web tools are the provider's server tools** (`web_search`, `web_fetch`, with `max_uses`
and `blocked_domains`). *Chosen over A's logging egress proxy (B): the pages are fetched on the
provider's side, so no process of ours needs open internet egress.* The agents process therefore
reaches only the model API hosts.

**Storage:**
- **Postgres 17 on RDS**, 2 vCPU / 8 GiB, 20 GB gp3 autoscaling to 100 GB, PITR. It holds 26 schemas,
  with separate owner, app, worker, agent and read-only roles.
- **A shared encrypted volume** (ReadWriteMany, 50 GB) at `config.data.root` for about 1.0 GB of hot
  files. About 24 readers use `readFile` against that root today. *Chosen over B's "every import stops
  reading files first" as the launch path: the volume works with unchanged code. New agent output is
  written as rows from day one, and the other readers move to rows one at a time. Astra's object-store-only
  design is the long-run shape.*
- **An S3 bucket** per environment (SSE-KMS, versioned) for encrypted nightly dumps and the 652 MB
  research-log cold archive.
- **Everything is under an app-dedicated KMS key.** The key policy is what limits which PL operators
  can decrypt.

**The service's own connectors**, all read-only, use new service credentials. Juan's Keychain keys are
not copied. The worker is the only process that holds them.

| | Credential (ask for) | Read-only enforced by | Cadence at launch (GUESS) |
|---|---|---|---|
| **Linear** | OAuth app, `read` scope | Scope, plus the allowlisted queries | Incremental every 15 min (≤36 requests an hour); full resync weekly |
| **Affinity** | Dedicated user or OAuth `api.read` | GET-only path allowlist, plus the scope if granted | Lists and deltas hourly; notes every 4 h; within 25% of the 100,000-a-month quota; merge sweep monthly |
| **Warehouse** | GCP service account, `dataViewer` + `jobUser`; workload identity preferred | SELECT-only guard; `maximumBytesBilled` 10 GB (about $0.06 a query) | Daily; the graph is rebuilt when its hash changes |
| **Dakota** | A second licensed login, if the licence allows | List/count request builder only (reads use POST, so a method filter is not enough); every request logged without its body | Daily changed-since pull, **only after decision 6**. Until then the sync is off. |

Egress is default-deny with a hostname allowlist for each process. Dakota's host is on Heroku, so IP
rules cannot work. A `fetch` wrapper enforces the same allowlist in code.

## 2. Migration and cutover from the Mac

**Moves** (measured with `du`, no contents read):
- the database, a 624 MB dump, to RDS by `pg_restore`;
- about 1.0 GB of hot files to the volume;
- `enrich/log` (652 MB) to the encrypted cold archive;
- the Dakota replica (50 MB) only after decision 6.

**Doesn't move:**
- the warehouse cache (369 MB), which the first extract rebuilds;
- the stale PGlite folder (6.9 GB).

**Steps:**
1. **Rehearse at T−3 days** in the real prod environment: the full move, verification, a smoke test
   with one reversible write, then wipe. Time every step.
2. **Freeze.** Stop Mac writes, connectors, scripts and agents. Record the final audit sequence and the
   source cursors. Target under 1 h (GUESS; the rehearsal sets it).
3. **Transfer.** Take `pg_dump -Fc` as `plcos_ro` and a `tar` with a per-file SHA-256 manifest. Encrypt
   both with `age`, upload them over a presigned multipart URL, and restore them in-cluster with a
   one-shot job. The kit's copy step cannot reach the Mac's loopback.
4. **Verify** with docs/21's `pg-copy` checker: per-table counts, ordered-row checksums, file hashes,
   per-vehicle hard and soft totals, and open tickets. The report holds counts, never rows. Any
   unexplained mismatch blocks the cutover. Queued jobs that were migrated become historical and are
   never auto-dispatched (Astra).
5. **Fence and switch.** Revoke the Mac's write path and disable its keys. Open cloud writes. Enable the
   schedules one connector at a time: Linear, then Affinity, the warehouse, and Dakota. Cursors travel
   in the database, so the first syncs are incremental.
6. **Keep the frozen Mac database** encrypted and untouched for 14 days. **Rollback before the first
   team write:** reopen the Mac. **After it:** a reverse cutover, meaning a new freeze plus the same
   verified transfer in reverse. There is no bidirectional sync and no silent failback. (A and Astra
   agree once it is put this way.)

## 3. Workflows

**The rule:** anything that only reads sources or derives labels runs unattended. Anything that changes
the pipeline, identities, consent or money is a human click. Agent output is a proposal until something
other than the agent accepts it.

| Unattended (scheduled or chained) | Human-triggered in the service | Developer-run (Mac, on copies) |
|---|---|---|
| The four syncs (read-only); W3 connect, network rebuild and SPV derivation after each sync or import; W1c fact-check sampling of every research batch; W12 tags (a person's tag wins); W13/W14 **proposals**; nightly encrypted dump; audit-chain verify | W1 research and sourcing rounds (estimate shown first); W5 strategy per LP, vehicle or list; W9d reply drafts; applying merges and re-points; imports of prospects, duplicates, pursuits and lp-units; full re-pulls and purges (Admin) | Protocol and prompt changes, new import kinds and tactic trials, all against a restored copy, never prod. Each is proven on the copy, then shipped as code. |

- **Phase 2**, after two weeks of passing gates: W1 for newly added prospects, and W5 re-runs when an
  LP's inputs change and nobody has edited it since.
- **Findings** may import automatically under a standing policy ticket (scope, caps, 30-day expiry,
  revocable by the circuit breaker). Strategies stay one click each. (Decision 8.)
- *B's emergency bundle upload from the Mac is dropped. It keeps a second write site alive, which is
  the tether Juan rejected. If the worker is down, fix the worker.*

**The job runner:** extend `platform.import_job` into a general Postgres queue with `runner`,
`scheduled_for`, `attempts`, `based_on`, `input_manifest` and `envelope`.
- Jobs are claimed `FOR UPDATE SKIP LOCKED` under the per-kind advisory locks and heartbeats.
- **A lease with a fencing token** is added (Astra): a stale worker cannot commit after a newer lease
  exists.
- Retries are bounded (3, GUESS) and apply only to idempotent reads. Merges and ambiguous effects go to
  review.
- A worker whose migration ledger differs from the database refuses to start.
- *Trigger.dev and Inngest stay deferred: their step payloads would put LP data in a vendor cloud.*

**The agent execution model:**
- Our own runner in `lib/agents/`, built on the Anthropic SDK tool runner behind a provider adapter.
  There is no shell and no filesystem.
- Tools: the provider's `web_search` and `web_fetch`, plus `read_item(key)` inside the envelope and
  `write_output(key, json)`, which is schema-validated into a staged row.
- The AGENTS.md work envelope becomes a row, and every tool call is checked against it. A child
  envelope is computed by code and can only narrow.
- Each run pins its protocol hash, input-manifest hash, model and resolved config.
- The ledger moves to `workflow.run_event` (append-only) with **measured** usage. The 578 existing
  lines are imported once.
- Transcripts are not kept, except one run at a time when debugging (encrypted, 7 days).
- **Which data reaches the models:** W1, W1c, W13 and W14 get research-safe fields only. W5, W9d and W12
  read internal records and start only after ZDR is confirmed in writing. Dakota's private fields never
  reach any prompt, log or trace. "A file path in a prompt is not a privacy shield" (Astra): once a
  model reads the bytes, they have left PL.
- **Models:** Sonnet 5 for W1, W1c, W13 and W14; an Opus tier for W5; Haiku 4.5 for W12. Fable is
  excluded because it is not offered under ZDR. Before committing, run a 50-LP bake-off against GPT-6
  on the protected set (Decision 5).

**Cost, from the ledger** (list prices checked 28 Sep: Sonnet 5 $2 / $0.20 cache read / $10 per M
tokens; Opus 5.5 $4 / $0.20 / $20):
- **27 Sep, the heavy night:** 74M fresh input, 2,410M cache reads (97% of input) and 8.7M output. At
  API rates that is about **$1,000 on Sonnet 5** ($1,280 on Opus 5.5), including about $250 of web
  search (GUESS). Most of it is long sessions re-reading context; a fresh short context per LP should
  bring such a night to **$300–500** (GUESS).
- **Steady state:** about **$600 a month on Sonnet 5** (GUESS volumes). A burst week like this one
  costs $3,000–5,000. *Astra's $55/day model uses older rates ($3/$15 and $15/$75) and an invented
  workload; B's comes from our own ledger.*
- **Caps (decision 9):** **$50 a day** for unattended runs; **$300 a day and $2,000 a month** for all
  model spend. A human round over the cap shows its estimate and needs an Admin click. Alerts fire at
  50% and 80%, and new runs are refused at 100%. Each run is capped too (W1 $2, W5 $5, GUESS). Add a
  kill switch and the AGENTS.md circuit breaker.
- **Infrastructure:** about $250–400 a month at AWS list prices (A, GUESS). Astra's larger envelope
  would be $1,000–2,500.

**Quality gates:**
- **Validators run as job steps.** A failing item is quarantined; the batch continues.
- **W1c samples 10% of every batch** (at least 5, on a different model). From a baseline of 559
  checked findings (88.5% of facts supported, 5.9% partly, 0.1% not), a batch passes at ≤ 1% not
  supported, ≤ 10% partly and ≤ 15% identity doubt (GUESS).
- **Strategies** pass the W5c critic and `checkStrategy`, and stay proposals.
- **Prompt and model changes** run against the protected set, which agents cannot edit. A weekly spot
  check of 10 auto-accepted findings feeds the circuit breaker.
- **Before the first cloud run,** fix the W5 protocol conflicts Astra found (live rereads, older C/D
  wording).

**Human edits against workflow writes:**
- A registry of human-owned fields: status, stage, rungs, owners, notes, amounts, approvals,
  restrictions, person-set tags and accepted strategy text. An import that writes one fails a property.
- Jobs pin `based_on` and skip any record a person has edited since. Each skip writes a
  `platform.import_conflict` row to an Admin queue.
- Source tables are written only by their own sync, and within a source the newer `as_of` wins.

## 4. Users, roles and guardrails

**Identity** (the biggest open risk). The kit's `/me` is "personalization only, not authentication".
The LabOS `authToken` is readable by JavaScript and shared across every PL app subdomain, so a
script-injection bug in any sibling app can replay a member's token.
- Astra would not launch until PL provides a signed, app-scoped identity.
- C would launch on `/me` plus our own session, with a passkey step-up for high-harm actions.
- **Chosen: C, strengthened.**
  - `/me` identifies the member, and the LabOS uid binds to `app_user.labos_uid`.
  - **A passkey is required to open our `__Host-` session** (HttpOnly, SameSite=Strict, 12 h), not only
    for Admin actions. A replayed token alone then gets nothing, reads included.
  - Passkeys are enrolled once per person from an Admin-issued one-time link at onboarding.
  - A fresh 15-minute step-up covers merges, re-points, imports, syncs, roster changes, restore,
    MONEY and ALLOCATION_EXCEPTION approvals, and recording a wire.
  - Ask PL for signed identity too; when it lands, it can replace the passkey session.
- **Why:** it closes the read-exposure gap Astra identified without blocking launch on PL's roadmap.
- **To verify:** WebAuthn inside the LabOS iframe needs the parent frame's
  `allow="publickey-credentials-get"`. That goes on the wishlist. The fallback is a top-level
  sign-in window. Test it on iPad Safari.

**Access:**
- The app is PRIVATE in LabOS, and our roster gate refuses directory admins who are not on the team.
- Roles are `admin | gp | viewer`, with `vehicles` (null means all) and `approves` (ticket kinds).
  *Chosen over Astra's five capability roles: at about ten users, Astra's "steward" folds into Admin.*
- Enforcement is `lib/authz` `can()`, layered on the existing `requireServerActionMutation`. A
  property calls every Admin action as a GP and as a Viewer and expects a refusal with no row changed.
- Restricted fields R1–R4 (money, note bodies, Dakota fields, restriction reasons) are redacted in the
  loaders. Vehicle scope never hides that a collision or restriction exists.

**What each role can do:**
- **GPs**, within their vehicles:
  - move LPs through the pipeline directly, with no STAGE ticket (status is separate from the rungs);
  - record touchpoints and notes;
  - edit strategies;
  - propose sends;
  - start W1 and W5 within the daily per-user caps (10 W1 and 5 W5, GUESS).
- **Admin only:** imports, merges, re-points, syncs, the roster, flags and restore.
- **Developer and operations pages stay in the service** (they run the connectors now). They are
  Admin-only, and others get a 404.
- **Still removed from the build:** the user switcher, `reloadInit`, repo-file writers and local-disk
  screenshot routes.

**Approvals:**
- Self-approval of SEND, INTRO_ASK, MONEY and ALLOCATION_EXCEPTION is already refused (`d7ab0ad`).
- STAGE may be self-approved only by the pursuit's owner. Astra would remove that too (decision 10).
- MONEY and ALLOCATION_EXCEPTION need Admin or the vehicle's named approver, with step-up.

**Guardrails:**
- **Audit:** every write records the actor and `via` (ui, workflow, agent or import). Workflows write
  as a system principal, with `requested_by` recorded separately. A hash chain closes the gap that the
  table owner can drop the append-only trigger.
- **Concurrent edits:** version checks on status, stage, amounts, rungs, strategy, SPV stance and
  **notes** (Astra: rev 1's last-writer-wins lost text). A mismatch returns 409 with a "theirs / yours"
  choice. Every request carries an id, so a double submit is a no-op.
- **Undo:** a 30-second toast, then Revert from history. Evidence is retracted, never deleted. Bulk
  actions and imports revert by job.
- **Limits and brakes** (GUESS): 60 writes a minute per user, 200-row bulk actions for GPs, 8 MB
  feedback. `READ_ONLY_MODE` and per-workflow kill switches sit in a table, so neither needs a
  redeploy. Kit analytics send route templates only.

## 5. Dev cycle and channels

- **Channels:**

  | Channel | Data | Deploys |
  |---|---|---|
  | Local | Demo, or a sandbox copy | Unbounded; local may run hours ahead |
  | Staging (PRIVATE, own DB) | Invented, at production volume | CI, on every green `master` |
  | Production | Real | CI, after a human LabOS Approve |
  | Preview pool (2 apps, optional) | Demo | CI, on request |

  - Juan runs ahead in production through `lib/features.ts` flags per user. There is no second live
    writer.
- **The repo and CI:**
  - agents push their own branches with a repo-scoped deploy key: Claude to `claude/*` and `master`,
    Codex to `codex/*`; no force pushes;
  - `master` is protected by GitHub Actions: tsc, boundaries, props on PGlite and on Postgres 17, a
    Linux `next build`, the tracing audit, gitleaks and dependency scans;
  - CI holds no secrets and no data;
  - this replaces "Juan pushes" (decision 15);
  - about $100 a month of CI minutes (GUESS).
- **Deploys:**
  1. CI starts the kit's LabOS connect flow and posts the Approve link to Admin → Releases.
  2. A human approves, from the iPad if need be. The token lives only in the runner's memory, for its
     one-hour window.
  3. CI deploys, smoke-tests `/health`, `/ready` and a self-test 3 times, and rolls back to the
     previous artifact on failure.
  - Production deploys at most hourly, plus hotfixes. *Chosen over rev 1's two fixed trains: flags carry
    the risk, and Juan wants speed.*
  - Migrations run as a pre-deploy job, or at boot under the advisory lock. They stay expand/contract,
    enforced by a `contract-after:` gate.
  - Agents never approve a deploy.
- **Feedback:**
  - reports are filed and numbered in the service (`platform.feedback`, with attachments as rows);
  - the 114+ existing issues are imported with their numbers;
  - triage runs in the service under no-training terms, using the four classes A–D unchanged;
  - the C check cites the `docs/decisions/` index (21 repo-sourced entries today) and says "no
    recorded decision found" rather than "no contradiction";
  - reporters see Filed → Triaged → Fixed → In staging → Live.
  - **Dev agents get the issues two ways:**
    - the Mac pulls full issues with a scoped service token;
    - cloud agents receive only an invented-data repro brief, which passes a name check before release.

## 6. Testing and launch gates

**Before the team gets access** (all on staging, with invented data):
1. **Authorization:** every action refuses GPs and Viewers as it should; step-up bypass,
   vehicle-scope escape, self-approval and expired-ticket attempts all fail; token replay without
   our session is refused; a removed user loses access within 5 minutes.
2. **Load:** 10, 20 and 30 Playwright personas writing to overlapping LPs, while a sync, a W1, a W5
   (stubbed model) and an import run alongside. Pass (GUESS): lists p95 < 1.5 s, heavy pages < 4 s,
   0 5xx, 0 silent lost updates, totals conserved, RSS < 80% of the limit. Then an 8-hour soak at 10
   users.
3. **Workflow recovery:** kill the worker before and after a commit, expire a lease, fire the tick
   twice, hit a 429 from a source, time out the model, exhaust the budget. There must be no
   stale-fence commit and no lost accepted output.
4. **Privacy canaries:** planted Dakota and health strings never appear in prompts, logs, analytics,
   dev briefs or CI artifacts.
5. **Restore drill:** a full database and file restore within 60 min, and RPO ≤ 5 min shown.
6. **Capacity:** the connection budget is 34 steady and 62 during a rolling deploy (Astra), so ask for
   ≥ 100 connections.

**Launch in waves:**
1. Juan and the backup admin.
2. Two GPs.
3. Everyone, after 48 h clean (GUESS).

Enable workflows one type at a time. Success means the whole chain runs with Juan's Mac switched off.

## 7. Decisions for Juan (suggested answers in italics; most blocking first)

1. **Is PL's AWS "our system" for real LP data?** *Yes, if it has an app-dedicated KMS key, named
   operators for the DB, snapshots, keys and logs, a stated region, and a written no-training statement.*
2. **Ask PL for the extended app (web, worker, agents, cron, volume, bucket, RDS with roles and PITR),
   and send the wishlist tomorrow?** *Yes. Fallback: a PL-owned AWS namespace we operate behind LabOS
   sign-in.*
3. **Identity: `/me` plus a passkey-backed HttpOnly session and a 15-minute step-up, while asking PL
   for signed identity?** *Yes. Don't block launch on PL; don't launch on `/me` alone.*
4. **May agents run server-side on API accounts with ZDR and no training, amending "never runs
   remotely"?** *Yes. W1, W1c, W13 and W14 first (research-safe inputs); W5, W9d and W12 once ZDR is in
   writing. No transcripts kept.*
5. **Provider?** *Anthropic first (Sonnet 5, an Opus tier for W5, Haiku 4.5 for W12), after a 50-LP
   bake-off against GPT-6.*
6. **Dakota in the service?** *Only after Dakota confirms PL hosting in writing. Until then the sync is
   off, its private fields are excluded, and derived claims are filtered by lineage, not only by schema.*
7. **New read-scoped service credentials; the Mac's keys disabled at cutover and deleted after 14
   days?** *Yes.*
8. **Unattended scope (§3), plus a standing 30-day acceptance policy for findings only?** *Yes. Phase 2
   after two weeks of passing gates.*
9. **Budget caps?** *$50 a day unattended; $300 a day and $2,000 a month in total; per-run caps; you and
   the backup admin can pause.*
10. **Roles and approvers:** Admin, GP per vehicle (all by default) and Viewer; a backup admin named
    this week; a named approver per vehicle for MONEY and ALLOCATION_EXCEPTION; keep the owner's STAGE
    self-approval? *Yes to all. Name the people.*
11. **Developer and operations pages in the service, Admin-only (404)?** *Yes.*
12. **Cutover:** rehearsal at T−3 days, a freeze under 1 h, the Mac database kept 14 days, and a reverse
    cutover as the rollback? *Yes.*
13. **Recovery:** PITR 14 days with RPO ≤ 5 min and RTO ≤ 60 min; dumps `age`-encrypted to you and the
    backup admin; Multi-AZ at about $120 a month (GUESS)? *Yes.*
14. **Real data for development:** an encrypted real copy on the Mac, pulled by an Admin with step-up
    and audited; cloud agents get invented data only; C's scrubbed copy deferred? *Yes. Scrubbing can
    re-identify through graph shape, so it waits until it is needed.*
15. **Agents push branches with a deploy key; GitHub Actions CI with no secrets or data?** *Yes. You add
    the public key once.*
16. **Releases:** production on your (or the backup's) Approve, at most hourly plus hotfixes; staging
    automatic once PL gives a CI token? *Yes.*
17. **Feedback in the service with in-service triage, attachments deleted 90 days after done, and kit
    analytics limited to route templates?** *Yes.*
18. **Extend `docs/decisions/` from code comments, triage notes and memory files** (the README excludes
    memory today)? *Yes, each entry reviewed, with no record names.*

## 8. Build order

**Tonight, with no decisions needed** (invented data only; about two nights of parallel builders,
GUESS):
1. **S.** Run the Postgres props and the HTTP smoke that `security-fixes` and `feedback-reporter` could
   not; integrate both. **Finish 06:** production `next start` RSS, idle and under a 10-way walk,
   plus the import child's RSS. This fills in the wishlist's memory numbers.
2. **M.** `RUNTIME=service` with `PROCESS_ROLE` (web, worker, agents or cron). Each role reads only its
   own env vars. PGlite is refused, TLS is verified with the bundled RDS CA, and `/health` and `/ready`
   are split.
3. **M.** The general job table, `scripts/worker.ts` (SKIP LOCKED, lease with fencing token,
   heartbeat, ledger check), `platform.schedule` and `scripts/cron.ts`, with double-fire properties.
4. **M.** Role-split migrations (owner, app with INSERT-only audit, worker, agent views without
   `dakota`, ro), with grant properties.
5. **M.** `lib/authz` and the roster fields (`labos_uid`, `access`, `vehicles`, `approves`), plus
   approver authority in `decideTicket`.
6. **S.** The audit hash chain, and a required actor and `via` on every write.
7. **M.** Version columns with 409 handling, request ids, the human-owned field registry, `based_on`
   skips and `import_conflict`.
8. **M.** Undo and Revert, retraction, and revert-by-job.
9. **S.** Rate limits in Postgres, `READ_ONLY_MODE`, kill switches, and `lib/features.ts` with Admin →
   Flags.
10. **M.** The ledger in Postgres (`workflow.run_event`) and the one-time import.
11. **L.** `lib/agents/` with a **fake provider**: the envelope check, budget stop, staged outputs,
    validators as steps, and the W1c sampler and gate.
12. **M.** Connector credential adapters (env in the service, Keychain on the Mac), the BigQuery client
    library in place of the `bq` shell-out, and the per-role egress `fetch` wrapper.
13. **M.** The Dockerfile (one image, four commands, built from `git archive`, with the tracing guard);
    the backup job (`pg_dump` → `age` → S3); the cutover and reverse-cutover tooling, rehearsed between
    two local clusters.
14. **M.** CI workflow files (written, but not run until decision 15), `ship.sh --target`, and the
    `contract-after:` gate.

**After the decisions and PL's answers:**
1. **S.** Send the wishlist with the measured numbers.
2. **M.** Stand up staging on the extended shape with fixture connectors.
3. **M.** `labosAuth` with passkey sessions and step-up (decision 3); the Admin gating (decision 11).
4. **M.** Feedback, numbering and triage in the service (decision 17).
5. **M.** The deploy flow and Admin → Releases (decisions 15 and 16).
6. **M.** Service credentials, with dry-run syncs on staging (counts only) (decision 7).
7. **M.** The provider account with ZDR, and the bake-off (decisions 4 and 5).
8. **M.** Human-triggered W1 and W5 in the UI.
9. **M.** The staging gates (§6), then prod, then the rehearsal, then the cutover (decision 12).
10. **S.** Launch in waves, and enable workflows one at a time.
11. **Later:** Dakota after decision 6; phase 2 automation; moving the file readers into rows or S3.

After the decisions, that is about 3–4 nights of work (GUESS). Astra's 2–3 calendar weeks is the
honest figure for the soak, the drills and the pilot.
