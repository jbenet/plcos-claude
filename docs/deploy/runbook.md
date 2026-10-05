# Deploy runbook: rev 3, first deploy (for 29 Sep 2026)

For Juan and Claude. It follows [rev3.md](rev3.md) and uses the timings from the real-volume rehearsal on
the Mac (28 Sep, [06-measurements.md](06-measurements.md), "Real-volume rehearsal"). The rehearsal restored
a copy of `plcos_live` into a scratch database, served it with `next start` behind a stand-in LabOS `/me`,
and ran the export and findings imports. It found five problems that stop a deploy; fix them first.

## 0. Before the day: fixes the rehearsal says are required

**Status, 28 Sep 06:40 UTC: F1–F5 are fixed and merged (89dc9f3); gate green on both databases.**
F1: the Dockerfile sets `NEXT_DIST_DIR=.next`. F2: with `LABOS_ME_URL` set, the real profile accepts
PL's database over verified TLS (RDS CA bundle in the image). F3: one live-server helper treats the
LabOS container as live. F4: sign-in reads first and never writes for a known uid. F5: viewer data
3.4 s → 0.3 s on invented real-scale data (verify on the first real deploy). Still unverified end to
end: a Docker build (no Docker on the Mac; PL's Kaniko is the first real build) and the Dakota strip
against a real copy — rehearse both once before cutover (§2, §3).

**Status, 28 Sep 07:47 UTC (rehearsal 3 on a fresh real copy, [06-measurements.md](06-measurements.md)
"Rehearsal 3"): the Dakota strip PASSES with the fix merged (`a2c7768`, `claude/main`).** `strip-dakota.ts`,
run exactly as `cutover.sh` step 6 invokes it against a frozen target, committed in 510 s with no FK error —
the same 17-re-point, 3-batch shape that failed in rehearsal 2 resolved through the retry-after-blocked loop.
Every Dakota-sourced row removed (dump-verified per table), an independent key-scoped scan of every
source-type and JSON column found 0 residue, and org/person counts matched exactly before/after (99,130
people, 18,626 orgs, unchanged). Cutover's sanitize step is confirmed against real data; not yet run on RDS.

**Status, 28 Sep (rehearsal 2 on a real copy, [06-measurements.md](06-measurements.md) "Rehearsal 2"):
the Dakota strip FAILED before the fix — cutover stopped before the flip.** `strip-dakota.ts` hit an FK
violation on `strategy.pursuit_contact` while undoing LP re-points: the 17 Dakota re-points share 3
`created_at` values, so "newest first" is random within a batch and a re-point's created org pursuit is
deleted before a same-batch re-point's contact on it. With a local retry the rest committed in 479 s
(one transaction, target frozen throughout), removed every Dakota-sourced row and kept all names. F3, F4 and
F5 held on real data: 0 errors in two 10-way walks, viewer pages ~0.5 s, peak RSS 1.63 GiB.


| # | Problem found | Fix |
|---|---|---|
| F1 | The image builds with `DATA_PROFILE=demo` into `.next`. With `DATA_PROFILE=real`, `next start` looks in `.next-real` and exits: "Could not find a production build". | Set `NEXT_DIST_DIR=.next` in the app's env (the rehearsal did), or build with `DATA_PROFILE=real`. |
| F2 | `config/deployment.ts` refuses any non-loopback `DATABASE_URL` in the real profile, so the server can't reach RDS. | Allow the deployed host explicitly, for example with an env var naming the one allowed host. |
| F3 | Every real-data write is refused (HTTP 403, "Nothing was changed: this server is not the live one …", `NOT_LIVE_REFUSAL`) unless the checkout's folder has the live row in `.ports.json`. `/app` has none. The same check turns off the Linear and Dakota jobs and the recovery of queued jobs. | Give the container an explicit "this is the live server" setting (env var) that these checks accept. |
| F4 | LabOS sign-in runs an `insert … on conflict do nothing` into `platform.app_user` on every request. Its statement trigger bumps `network.read_revision` each time, so the page caches keep invalidating themselves. Under 10-way load, 25% of requests returned 500 (`DbBusyError`), and `/developer/enrich` failed every time. During an import, the insert waits on the row lock and times out after 20 s. | Read first, and insert only when the uid is unknown. With that patch applied locally: 0 errors, including during an import. |
| F5 | Viewer pages take about 13 s each: `scopedReadData` (`lib/authz/read/scoped-data.ts`, the Affinity-note metadata query) runs on every page. | Anyone LabOS signs in who isn't mapped is a viewer. Fix the query, or map the whole team to GP/admin before opening the app. |

**Dakota (rev 3 decision 3)** stays on the Mac. `cutover.sh` now strips the verified target
by default, before making it writable; `--keep-dakota` explicitly skips this step. It empties
the seven Dakota tables and removes source-owned and derived evidence outside that schema,
retaining names. It also fails copied queued/running import jobs with `stopped at cutover`.
See [the provenance inventory](strip-dakota-provenance.md). Ambiguous mixed prose, conflicting
journal reversals or unknown provenance stop cutover with the target still read-only.
The rehearsal's 19,571 schema rows and 14,353 source records are pre-strip counts, not a
measurement of this script against real data.

## 1. Settings in LabOS (secrets page), entered once

`DATA_PROFILE=real` · `NEXT_DIST_DIR=.next` (F1) · `DATABASE_URL=postgres://<kit user>@<rds host>:5432/<db>`
with the password in the kit's own variable, never in the URL in a log · `LABOS_ME_URL` (the kit's `/me`) ·
the live-server setting from F3 · `AFFINITY_API_KEY`, `LINEAR_API_KEY`, and `ANTHROPIC_API_KEY` when wired.
Leave `SCHEDULE_DAILY_AT` unset for the first day. Turn it on once a manual Affinity sync has worked
from the container. The persistent volume mounts at `/app/data`, and the working files go in
`/app/data/real/`. Memory: 6 GiB asked, 4 GiB the floor (see §5). Every variable, with what it's for, is in
[service.env.example](service.env.example); `bash scripts/preflight.sh` checks them and the machine (30 Sep).

## 2. Deploy approval and first boot (demo first)

1. Claude runs the gate on the Mac (types, boundaries, properties on both databases) and
   `bash scripts/image-build.sh`, using the `git archive` context and its three guards.
2. Claude starts the connect session. Juan opens the link, signs in to LabOS and clicks **Approve**. The
   token lasts about an hour, so do this in the same sitting as the deploy.
3. Do the first boot with `DATA_PROFILE=demo` against an empty database. Expect `/health` 200 in about 1 s.
   `/` without a cookie should show "Open Capital OS from LabOS → AI Apps". Juan's cookie should create a viewer. Map
   Juan's uid to the admin row: `update platform.app_user set labos_uid='<uid>' where access='admin'`.
   The rehearsal confirmed an admin row with a uid gets admin, and an unknown uid gets a new viewer.

## 3. Cutover (one evening, about 20 minutes of work at today's volume)

| Step | What | Rehearsal time |
|---|---|---|
| a | Wait until no import job is `queued`/`running` on live, or fail it. A copied `running` row blocks that job kind on the target, and the rehearsal had to fail one by hand. Then stop the live server (`npm run dev:stop` stops Postgres too; stop only the Next server). Take `npm run backup -- event "pre-cutover"`. | backup: minutes |
| b | `scripts/cutover.sh run --from plcos_live --to <RDS>`: freeze, `pg_dump -Fc`, restore `--no-owner --no-acl --single-transaction`, verify, strip Dakota, stop copied jobs, flip. | dump 15 s (190 MiB file, 1.45 GB database); restore 40 s locally, longer over the network (GUESS 1–3 min); verify 38 s |
| c | Copy the working files to the volume: everything under `plcos-data/real` except `postgres/`, `database/` (6.9 GB of old PGlite), `database.lock`, `postgres.url`, `dakota/`, `logs/`, `rehearsal/`, and the hidden `.real-copy-*` snapshots (14 GB). What's left is **2.1 GB, 33,132 files**, not the 1.0 GB rev 3 assumed. Since 30 Sep: `bash scripts/cutover-files.sh pack <real root> <out.tar.gz>`, which also leaves out the research export files (regenerated on the service) and checks the archive. | tar + upload: GUESS 2–5 min |
| d | Point the app at RDS (settings above) and deploy (Approve). | about 1 min |

Verify: `pg-verify` must say MATCH **before** target sanitation. The subsequent counts report intentional removals; do not expect source/target equality after stripping. In the rehearsal the three tables that differed (`route_cache`,
`route_warmup`, `import_job`) differed only because live kept writing, and the freeze prevents that. Then
walk `/today`, each vehicle's overview/pipeline/selection/strategy, `/orgs/g/lps` and `/developer/enrich`
as admin. All should return 200. On the Mac at real volume, with F4 applied, a 10-way walk gave 0 errors,
p50 65 ms–1.2 s and p95 up to 1.5 s. The slowest was the largest vehicle's strategy/pipeline/selection, and
`/developer/enrich` had p50 0.8 s. Make one reversible write (a note) to prove F3 is fixed. Run one
**Export the research set**: it took 149 s with a 603 MiB child in the rehearsal.

## 4. Rollback

Before any write lands on RDS: `scripts/cutover.sh unfreeze --db plcos_live` and restart the Mac live
server. After writes: `scripts/cutover-reverse.sh` into a new empty Mac database, then restart. Keep the
frozen Mac database and the pre-cutover backup for 14 days. A bad deploy is redeployed from the previous
commit (Approve again).

## 5. Known risks, measured

- **Memory.** The server idles at 75–170 MiB, and its peak was 1.25 GiB under a 10-way, 3-minute walk. The export
  child peaked at 603 MiB and the findings child at 2.43 GiB, so server plus findings import comes to about 3.7 GiB.
  4 GiB leaves almost no headroom: ask for 6 GiB if PL allows, and never run two heavy jobs at once. The kit
  default (384 MiB) will not work.
- **Build.** `next build` took 73–81 s and peaked at 2.1–3.5 GiB summed RSS on 16 cores. Kaniko's default is
  2 GiB and 1 CPU, so ask for 4 GiB for the build too.
- **The findings import's last step (`buildNetwork`) is still slow at real volume.** It spends about 13 minutes of
  paced identity resolution, which is mostly sleep, then precomputes routes for 5,418 targets. That projects to 1.7–3.3 h at
  100% CPU, nearly all in `pathsFromSnapshot`. See "buildNetwork profile (real volume)" in 06-measurements.
  Don't start a findings import on the first day.
