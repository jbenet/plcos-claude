# 04 — Workflows, connectors and data sync between local and deployed

Planning section, 28 Sep 2026. Nothing here is built. Counts only; no real records.

## What runs today

**Research workflows.** W1 profiles, W1c fact checks, W3 connect, W5 strategies and W5c critic,
W9d reply drafts, W12 event tags, W13/W14 identity and LP-unit reviews, and sourcing rounds. Claude
sub-agents (`lp-researcher`, `fact-checker`, `strategy-writer`, `event-tagger`) and Codex workers run
them on this Mac, under Juan's accounts with training off. They read frozen batches and write files
under `plcos-data/real/enrich/` (1.9 GB; about 2,800 findings and 1,450 strategies). The
ledger `plcos-data/real/workflows/runs.jsonl` holds about 580 recorded runs, mostly Codex. W3, W8, W9
and the warehouse graph are deterministic scripts. `docs/agent-rules/real-data.md` says a research
sub-agent "never runs remotely".

**Imports.** Files reach the database only through `lib/import-jobs`. A human clicks, a
`platform.import_job` row is queued, and a separate process runs the job with its own pool and a
per-kind advisory lock. It heartbeats, and a stale job is marked failed but never replayed. There
are twelve kinds: findings, prospects, duplicates, pursuits, lp-units, spv-stance, dakota,
strategy-moves, affinity, network, export and linear. Every one reads its inputs from the
**server's filesystem** (`config.data.root`). The code has pieces of idempotency: strategy
suggestions are keyed by `file_hash`, the Dakota checkpoint pins input hashes and refuses a changed
file, and prospects are keyed by file, line and status.

**Connector syncs** all run on the Mac, with keys in the macOS Keychain:
- **Affinity** is pulled and then translated. Its Keychain item is trusted to no app, so every read
  asks Juan. The key can write.
- **Dakota** is pulled by `scripts/dakota-sync.ts` and translated by a job. Its raw replica stays in
  `real/dakota/`, and its data "never leaves our system".
- **Linear** takes about 12 s and 44 requests for a full pull. Its key can write.
- **The warehouse (Polaris)** is read with SELECT-only queries under Juan's gcloud credentials. The
  graph goes into `enrich/warehouse/`.

**Backups.** `npm run backup` runs `pg_dump -Fc` as `plcos_ro`, encrypts the dump with GPG and
thins old copies. The dump is 624 MB. There is no off-machine copy yet: Dakota blocks it until Juan
decides (docs/22).

## 1. What the kit / LabOS provides for this topic

- **Database.** The kit offers a PLN-provisioned Postgres, injected as `DATABASE_URL`, with TLS
  required (`deploy-to-labs/SKILL.md` "Apps that want a provisioned database"). Any other database
  is a runtime secret.
- **Secrets.** Secrets are entered in the LabOS settings page, never in the zip or the chat
  (`AGENTS.md` "Apps that need secrets").
- **Runtime limits.** The runtime is capped at 384Mi of memory and 300m of CPU. `AGENTS.md`
  "Resource limits" says: "Don't spawn extra worker threads/processes for background work". Our
  imports do exactly that.
- **Moving an existing database.** `db-migration/SKILL.md` step 6b copies the old database at
  first boot, from inside the container. That assumes our database is reachable from PL's cluster.
  Ours listens on loopback only.
- **What the kit does not cover.** It has nothing on scheduled jobs, workers, persistent disk,
  reaching the provisioned database from outside the cluster, or backups and restore of the
  provisioned database. Those gaps drive this plan.

## 2. Options for where workflows and syncs run

**(a) Keep workflows and syncs on the Mac and push their results to the deployed database.**
- Cost: almost no new infrastructure. Agent tokens stay on the existing subscriptions.
- Risk: the Mac must be online for imports and syncs, and it becomes a second place that writes.
- Fit: good. Keys, the "never runs remotely" rule and the Dakota raw replica all stay where they
  are now.

**(b) Move workflows to the cloud, on a job runner such as Trigger.dev or Inngest.**
- AGENTS.md defers this to the D-series, and it would break the "never runs remotely" rule.
- The agents would need API keys billed per token. A night like 26 Sep (about 226M tokens, mostly
  cache reads) would cost somewhere in the hundreds to low thousands of dollars at API rates. That
  is a guess, sensitive to model and cache share.
- The cloud would need write-capable Affinity and Linear keys, a place for the Dakota raw replica,
  and a scheduler the kit does not offer.
- Fit: poor now.

**(c) A hybrid: syncs in the cloud, research on the Mac.**
- This removes the Mac from the Linear, Affinity and Dakota path.
- Cost: those keys move into LabOS secrets. The Affinity and Linear keys cannot be scoped and can
  write. Affinity loses Juan's per-read approval.
- It still needs a scheduler and memory the kit does not provide.
- Fit: later, one connector at a time. Linear would move first: it is small and cheap, and
  read-only is enforced in its client.

## 3. Recommendation

**Choose (a) now, built so each connector can later move to (c) on its own. The deployed database
becomes the single source of truth.**

The one-writer rule ("only the live server writes the real database") becomes: **the deployed
database is the only real primary, and every write to it goes through the job queue, the app's own
actions, or the audit log.**

**The Mac runner.** The deployed app keeps the `platform.import_job` queue. A kind that needs local
files or keys is marked `runner: local`. A human queues the job from the deployed UI, and his user
id is captured as the actor, as today. A **Mac runner** then takes over:
- It claims the job with `FOR UPDATE SKIP LOCKED` and holds the same per-kind advisory lock.
- It runs today's `runImportOperation` against the deployed database over TLS, as a dedicated
  `plcos_import` role.
- It writes progress and heartbeats to the same row. The UI and the stale-job recovery keep
  working, because advisory locks work across hosts.

This reuses the existing worker almost unchanged. It keeps the heavy imports, such as the findings
import and the network rebuild, off the 384Mi container, and it needs only outbound connections
from the Mac.

**Fallback if the provisioned database can't be reached from outside.** Upload hashed bundles to
an authenticated `/api/import-bundles` endpoint and let the server run the job. This depends on the
memory limit.

**Conflict rules.**
1. **Human-owned fields change only through user actions** in the deployed app. These are status,
   consent rungs, notes, approvals and tickets, amounts, owners and restrictions. Imports write
   proposals instead, as `strategy.suggestion` and the reconcile ladder proposals already do.
2. **Imports that move pursuits carry a `basedOn` snapshot time.** These are prospects, duplicates,
   pursuits and lp-units. If a pursuit was edited by a person after that time, the import skips it
   and records a conflict for review. The prospects import's `inProgress` guard is a precedent.
3. **Source-owned tables are written only by their own import.** These are `affinity`, `dakota`,
   `linear` and the research claims. Within a source, the newer `as_of` wins, as the Dakota import
   already enforces. A person's tag or override sits over the source and is never overwritten.
4. **Every job pins a manifest of its input files' SHA-256 hashes.** Replaying the same bundle is a
   visible no-op. The runner refuses to run if its migration ledger differs from the deployed
   database's, so schema versions must match.

**Direction and frequency.**

| Moves | Direction | How often |
|---|---|---|
| Research imports (findings, strategies, tags, prospects, lp-units) | up | On demand, after each checked batch (several times a night at the current pace) |
| Affinity translation | up | Daily, with Juan approving the Keychain read |
| Linear | up | Hourly or on demand (cheap) |
| Dakota translation | up | On a change, if decision 3 allows it |
| Warehouse graph | up (by way of W3) | Weekly or on demand |
| Ledger lines | up | With each import, keyed by run id and event |
| Nightly dump of the deployed database (read-only role) | down | Daily. It is the backup, the **mirror** workflows export from, and the preview source |
| Feedback issues | down | See the feedback section |

**Keeping velocity.**
- The Mac's own Postgres stops being a primary. It becomes a restored **mirror** of the nightly
  dump.
- Dev worktrees preview on clones of that mirror, as they do today, so local code can run ahead of
  master against copies.
- **Rehearse on a copy, then apply the same bundle to production.** A new import kind or a bulk
  operation first runs against a fresh mirror restore, and the counts are compared. Then an event
  backup is taken and the identical bundle, with the same hash, is queued for production.
- The runner runs from the live folder, pinned to the deployed commit, never from a dev worktree.

## 4. Decisions for Juan

1. **Once the team uses the deployed app, is the deployed database the only real primary, with the
   Mac's database a read-only nightly mirror?** *Yes. Two writable primaries would need
   bidirectional replication. That does not merge human edits safely. A read-only deployed replica
   of a Mac primary would stop users from writing, so it doesn't work either.*
2. **How do local results reach the deployed database?** *Through the Mac runner claiming queued
   jobs over TLS as a `plcos_import` role, if PL allows access from outside the cluster.
   Otherwise, through hashed bundles uploaded to an authenticated endpoint.*
3. **Does the PLN-provisioned database count as "our system" for Dakota?** *Yes, but only if the
   app is restricted to named team members (not open to all of PL Infra) and PL confirms who can
   administer the database. The warehouse already holds some Dakota data. Otherwise, Dakota stays
   Mac-only: no Dakota claims or Dakota-sourced prospects go up, and backups use `--no-dakota`.*
4. **Do research agents stay on the Mac, with no cloud agents before the D-series?** *Yes. This
   keeps "never runs remotely", the subscriptions and the training-off accounts.*
5. **Do connector keys stay in the Mac Keychain, with none in LabOS secrets for now?** *Yes.
   Revisit Linear first.*
6. **Can an import ever overwrite a human edit?** *No. Human-owned fields change only by user
   action. An import that conflicts skips the record and flags it for review.*
7. **Backups: is our own encrypted nightly dump of the deployed database, pulled to the Mac,
   enough?** *Yes. Also ask PL what backups and point-in-time recovery the provisioned database
   has.*

## 5. Build list

The items marked **tonight** can be built and tested on invented data in the dev cluster, with no
decision needed.

| # | Item | Size | When |
|---|---|---|---|
| 1 | Inventory which import kinds write human-owned columns, then add property tests that an import never overwrites an edit made after its `basedOn` | M | tonight |
| 2 | Migration adding `runner`, `based_on` and `input_manifest` to `platform.import_job`. The server skips `runner: local` kinds in `launchImportJob` | S | tonight |
| 3 | `scripts/import-runner.ts`: claim with SKIP LOCKED, take the advisory lock, heartbeat, and refuse on a migration ledger mismatch | M | tonight |
| 4 | Skip-and-flag conflict handling in the prospects, duplicates, pursuits and lp-units imports | M | tonight |
| 5 | `npm run mirror`: dump through a read-only URL, encrypt, and restore into a local mirror cluster; `previewSource` can point at it | M | tonight |
| 6 | `--no-dakota` for dumps and pushes (docs/22 needs it either way) | S | tonight |
| 7 | The upload-bundle endpoint (the fallback for decision 2) | M | after decision 2 and PL's answer |
| 8 | Cutover runbook: final event backup, stop Mac writes, `pg_restore` into the deployed database, verify counts, then turn on the runner | M | after decisions 1 and 3 and hosting |
| 9 | Move Linear sync to the cloud | L | later, needs a scheduler |

## 6. Feedback for the kit devs

- Say whether a provisioned database accepts TLS connections from an allowlisted outside machine,
  with a second role, and whether `pg_dump` is allowed. Many apps keep data work off the container.
- Say what backups and point-in-time recovery the provisioned database has, where it lives, and
  which PL staff can read it. Data-residency promises such as ours to Dakota depend on this.
- Offer a primitive for scheduled jobs and workers, or a larger memory tier. "Don't spawn
  workers" at 384Mi rules out long imports.
- State whether apps have any persistent disk.
- Step 6b's in-container copy fails for a database that listens on loopback only. Document a
  `pg_restore` or upload path.
