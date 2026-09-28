# Capital OS as a team service: rev 3, one machine (28 Sep 2026)

Rev 3 replaces rev 2. The rule: make it exist and work first, then scale only when something forces it.
It runs what works on the Mac today, on one machine, with LabOS sign-in in front of it. Rev 2's other
mechanisms are removed; the last table lists each one and what would bring it back.

## The shape

| Part | What it is | New code? |
|---|---|---|
| **One container** | One LabOS app, PRIVATE, with the whole team as members. The kit Dockerfile runs `next start`. It's the same server as the Mac's, including the import child process it already starts for heavy jobs. | A Dockerfile |
| **One database** | PL's provisioned Postgres (RDS), which the kit sets up with one flag. It holds the only copy of the real data after cutover. | None; `DATABASE_URL` already works |
| **One disk** | A persistent volume at `config.data.root` for the ~1.0 GB of working files (research, prospects, feedback journal, ledger). The code reads them as it does today. | None |
| **Sign-in** | LabOS. The server forwards the LabOS cookie to `/me` and gets a `uid` and name. A small table maps the team's `uid`s to their app users; anyone else signed in is a viewer. The roles already shipped (admin, GP, viewer) stay. | ~1 file |
| **Scheduled work** | A timer in the server process (the instrumentation hook already starts background work) runs the daily syncs: Affinity, Linear, Dakota if allowed, the SPV derivation, and the backup. It uses the same job table and import child process as the buttons. | ~1 file |
| **Workflows** | Research (W1), fact-check (W1c) and strategy (W5) become one job kind that calls the Anthropic API with the existing protocol doc as the prompt, the provider's web search and fetch, and our existing validators. It writes the same files, and the existing importers take them from there. A person starts a run from a button; scheduled runs come later. | ~1 module |
| **Keys** | Affinity, Linear, Dakota and Anthropic keys become env vars entered once through LabOS's secrets page. The code reads the env var, falling back to the Keychain on the Mac. | A few lines per connector |
| **Spend cap** | A monthly limit on the Anthropic workspace, set in Anthropic's console. We add no cap code. | None |

**The Mac** becomes the development machine, using the demo database. It stops being the live server after cutover.

## Size (ask PL for one app with these limits)

| Resource | Ask | Why |
|---|---|---|
| Memory | 4 GiB | Measured (`06-measurements.md`): the production server peaks at 0.74 GiB with 10 concurrent users on demo data (p95 under 230 ms, 0 errors in 40k requests). The real data and one running import child add perhaps 2 GiB (GUESS: real imports have not been measured on Postgres). The kit default is 384 MiB |
| CPU | 2 vCPU | Page rendering plus one import job at a time |
| Disk | A 20 GB persistent volume | 1.0 GB of working files today, plus growth |
| Database | Postgres 17 (16 works), 20 GB, daily snapshots | 640 MB today |
| Processes | Permission to spawn one child process | Heavy imports already run in one, so pages keep answering |
| Egress | HTTPS to the Affinity, Linear, Dakota and Anthropic APIs | The syncs and workflows |

## Moving over (one evening, rehearsed first)

1. Freeze: stop the Mac live server and take the usual encrypted backup.
2. Run `pg_dump` from the Mac, then `pg_restore` into PL's Postgres. Copy the working files onto the volume.
3. `scripts/pg-verify.ts` compares row counts and checksums, table by table. The same script is already rehearsed locally on 1M invented rows; it took 10 s.
4. Deploy, sign in and walk the main pages. The team starts the next morning.
5. Rollback: the Mac copy stays untouched for a week. Going back is the same steps in reverse.

## Every day after

- **Deploys:** Claude builds on the Mac, runs the gate (types, boundaries, the property suite on both
  databases) and a smoke test on the local production build. Then you click Approve on the LabOS deploy,
  as the kit requires, once or twice a day. A bad deploy is redeployed from the previous commit.
  Migrations only add; applied migrations never change, as today.
- **Feedback:** it works as now, through the journal on disk and then the issues list. The one change is a
  read-only feedback export with a single token, so the Mac dev session can pull new issues.
- **Backups:** PL's daily database snapshots, plus our existing daily `pg_dump`, encrypted, onto the volume
  and copied off it (to S3 or Drive, your pick).

## What rev 3 removes (and what would bring each back)

| Removed | Instead | Bring back when |
|---|---|---|
| Separate web, worker, agents and cron processes, and replicas | One server plus its import child | Pages slow down during jobs, measurably |
| Five database roles | The one user the kit gives | An agent needs its own direct database access |
| Audit hash chain | The existing append-only audit log | Someone needs tamper evidence |
| Rate limits, kill switches, a flags page, read-only mode | An env var and a redeploy | A runaway job or abuse happens |
| Version checks (409), undo, field registry, import-conflict rows | Last write wins, recorded in the audit log | A real clobbered edit is reported |
| Ledger in Postgres | The JSONL ledger on the volume | We need to query runs across machines |
| Agent runtime with envelopes, a fake provider and a sampler | One API job per workflow, using the existing protocols and validators | Agents run unattended at volume |
| Egress proxy and wrappers | None | PL requires it |
| A staging app | The local production build on demo data | A bad deploy reaches the team |
| CI on GitHub Actions | The local gate | More than one person deploys |
| Passkeys, step-up checks, roster gates | LabOS sign-in (you're reporting the cookie bug) | PL says the fix won't land |

## Decisions (Juan, 28 Sep 2026: all four yes)

Answers: (1) yes, with the VM fallback; (2) yes, an Anthropic key may already exist, to be wired later; (3) yes; (4) an S3 bucket, backups encrypted. Keys: backups use an `age` public key on the machine, with the private key offline; ask PL whether a secrets store (for example Infisical) exists. The ask sent to PL Infra: https://claude.ai/artifact/SoKAVeZ94nFxUt6Y9V2kCb


1. **Ask PL for one app with the limits above?** *Yes. Fallback, if PL won't raise limits: one VM running the same thing, the way the Mac does.*
2. **The Anthropic API key** for server-side research, and the monthly cap? *Yes, capped at $1,500 a month (GUESS; last night's runs would have cost more, but steady state is lower).*
3. **Dakota data on PL's database?** *Only once Dakota's terms allow it. Until then Dakota stays on the Mac and syncs nothing up.*
4. **Where the off-machine backup copy goes:** S3 or Drive? *S3, if PL gives a bucket.*

## Build order

**Tonight (no decisions needed; demo data only):**
1. ~~Measure a production `next start`~~ Done: 0.74 GiB peak on demo data.
2. LabOS sign-in: `/me` lookup (cached a few minutes), the `uid` mapping, viewer by default. The local user switcher stays for the Mac.
3. Env-var keys with Keychain fallback, in each connector.
4. The in-process daily timer for the syncs and the backup.
5. A plain Dockerfile (`next start`, built from a `git archive` so no real data can get in) and `/health`.
6. The cutover script and `pg-verify`, already rehearsed. Trim them to this plan.
7. The feedback export endpoint.

**After decisions 1–2:** send PL the ask, deploy the demo build to confirm it runs in the container, rehearse the cutover once against PL's database, then cut over. Then the workflow job (W1, W1c, W5 from a button).
