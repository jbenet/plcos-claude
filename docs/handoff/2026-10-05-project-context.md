# Capital OS: context for the "PLC OS" project · 5 Oct 2026

A starting brief for any Claude session in the PLC OS project, cloud or local. It has no real data and is safe
in git. Read AGENTS.md first: it and docs/agent-rules/* are the rules. This file is the state of things on
5 Oct 2026 and what is next.

## What it is

Capital OS ("PLC Raise Tools") is the fundraising system for PLC's vehicles: PLC Neurotech I, PLC Crypto/Rails,
the SPVs and the grants rail. It is a Next.js 16 app with Postgres 17, a modular monolith with schema-per-module,
in the repo jbenet/plcos-claude. The plan is docs/13-synthesis-r3.md; the design is docs/09.

## Where it runs (since 5 Oct 2026)

- **Production is on Railway**: project `plcos`, service `plcos-app`, Postgres 17, Pro plan,
  https://plcos-production.up.railway.app. It runs DATA_PROFILE=real on database `plcos_live`, with Google
  sign-in and settings held in the app (/setup is done).
- **Deploys:** Railway builds the `deploy` branch on GitHub. A push to `deploy` starts a build, and the app
  restarts. `/api/health` returns `{ok, commit}`, which is how to tell what is served. Roll back in Railway:
  Deployments → the previous one → Redeploy.
- **The move happened on 5 Oct.**
  - Every table and row matched: 135 tables, about 1.6M rows.
  - The Mac's live server is off for good (`data/real/moved-to-cloud`).
  - The frozen Mac DB is kept until 19 Oct, for rollback.
  - The Mac pulls a read-only copy daily: `scripts/cloud-pull.sh`, into a copy cluster on :57434.
  - The cloud is the only writer.
- **The Mac pushes research results up** through `POST /api/sync/push`, with a per-person token of scope
  sync:push. It accepts W1, W1c, W5 and, since 5 Oct, `prospects` bundles. See docs/deploy/railway.md §6–7.
- **Other clients use MCP and REST.** MCP is at /api/mcp; the outreach REST API is at /api/outreach/*.
  Tokens are per person, minted in Settings → Preferences → MCP access. See docs/26-mcp.md and
  docs/27-outreach-api.md. JuanMail, Juan's mail desk, also on Railway, is the main client.

## Hard rules (the short version; AGENTS.md wins)

- **Real data never leaves the real data plane.** It stays out of git, commits, changelogs, screenshots,
  artifacts, issues, web searches and sub-agent prompts. No training on it, by anyone. Cloud sessions have
  **no** real data, and must not try to get any.
- **Read-only connectors:** Affinity, Polaris and Linear. Gmail only through MailGuard, and drafts only.
  Capital OS sends nothing; JuanMail sends.
- **Never print, log or commit a secret.** Tokens live in the app's settings, the Mac Keychain, or Railway
  variables, never in chat.
- **Applied migrations are immutable;** a new change gets the next number in its module. The last applied
  are platform 021 and email 021 (email 021 is on master but not yet deployed: see below).
- **Gate before shipping:** `bash scripts/gate.sh`, which runs tsc, boundaries, and properties on PGlite and on
  Postgres. It must print both "N of N properties hold" lines.
- **Ship flow** (integrator only): claude/main → `scripts/ship.sh [--deploy]` → master → `deploy`.
  - With the moved-to-cloud marker, ship.sh skips the Mac restart.
  - A git push from a background shell fails on the Mac (the 1Password SSH agent needs Juan), so the push is
    run in a terminal tab.
  - Railway auto-deploys `deploy` (the source branch was set to `deploy` on 5 Oct).

## Sessions and roles

- **plcos Main Dev Session (integrator).** Merges branches into claude/main, gates, ships, deploys, and
  coordinates the other threads. Sub-agents build on `claude/<topic>` branches in worktrees.
- **"Finish the Railway setup for plcos" and "Plan the Railway deploy and data sync".** The deploy and move
  threads. The move is done; they send small docs and ops branches to the integrator.
- **JuanMail sessions** (repo jbenet/juanmail). They consume the outreach API and send feedback rounds.
  Rounds 1–2 are built.

## State at hand-off (5 Oct 2026, ~05:00 PDT)

- **Railway serves 0b3715e.** That build has the scheduler deadlock fix, cloud page warm-up, Settings →
  Vehicles (admins add a vehicle in the app), the prospects push, JuanMail round 1 (outreach-desk-v2), backup
  no-prune, and the proxy-hops default of 2 on Railway.
- **master = fa1f67b, not yet deployed.** It adds JuanMail round 2 (outreach-desk-v3) and the docs:
  - `askFirst` on routes, first-hop connectors and per-connector targets;
  - asksThisQuarter and lastAsk;
  - one message linked to several LPs (migration email 021);
  - closeTrack signedCount.
  The push to `deploy` failed on 1Password and needs Juan.
- **SPV - Science** (vehicle slug `spv-science`, a 506(c) SPV for Science Corp, science.xyz). Juan asked to
  create it and fill it with potential LPs.
  - The potential-LP file is ready on the Mac only, as real data: 271 rows, checked.
  - Waiting on Juan: (1) add the vehicle in Settings → Vehicles; (2) mint a sync:push token into the Mac
    Keychain (plcos-railway / push-token). Then the integrator pushes the file with
    `scripts/cloud-push.sh prospects <file>`.
- **JuanMail.** Juan mints its outreach token in Settings → Preferences → MCP access; JuanMail stores it as
  `plcosToken`.

## Open work a cloud session can do (code only, no real data)

1. **Workflows in the cloud.** Today W1 (profiles), W1c (fact checks), W5 (strategies) and prospect sourcing
   run as agents on the Mac and push results up. Design, then build, how the Railway app runs them itself:
   a job runner in the app, the Claude API (zero data retention, approved for drafting context on 4 Oct)
   with web search for public pages, the same validation and import paths as the push API, run records and
   pinned inputs (AGENTS.md "Agent rules"), and the work envelope and policy checks. Start with W1c (it is
   mechanical) and prospect sourcing for a vehicle. Write the design as docs/28-cloud-workflows.md, then
   build behind a setting that is off by default. Test on demo data only.
2. **The run ledger after the move.** `scripts/workflow-run.ts` records runs in the local DB, which on the
   Mac is now frozen. Runs need to be recorded in the cloud, for example via the push API or MCP.
3. **Cleanups found on 5 Oct:**
   - the MCP tool-name rule that blocks "connector" names;
   - pg's "concurrent client.query" deprecation in lp-units `gather`, to fix before pg@9;
   - lib/page-warm.ts still opens pages one at a time behind sign-in, which is fine.

## Where to look

- **History:** docs/changelog/index.md. Today's entries are railway-move, ship-cloud, cloud-vehicle-prospects,
  warm-session, outreach-desk-v2 and outreach-desk-v3.
- **Deploy runbook:** docs/deploy/railway.md.
- **Domain rules:** docs/agent-rules/domain.md.
