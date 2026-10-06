# Status: cloud workflows, from the PLC OS project thread · 5 Oct 2026

Branch `claude/project-thread-9pkkb6`, cut from `claude/main` (e9114fe). Code, invented fixtures and docs only:
no real data, no Railway access, nothing pushed to master or deploy. For the integrator to merge and ship.

## Done on this branch

1. **docs/28-cloud-workflows.md**: the design, and the record of slice 1.
2. **W1c in the cloud, slice 1** (`lib/workflows/cloud-w1c.ts`, `lib/workflows/cited-pages.ts`), behind
   Settings → Connections → Cloud workflows (`workflows.cloud`, off by default). Grades only.
3. **The ledger after the move**: `POST /api/sync/runs` (`lib/sync/runs.ts`) and `scripts/cloud-run.sh`. Also a
   fix in `finishRun`, which recorded activity under the Mac's layout even when given a server root.
4. **Cleanups**: lp-units `gather` no longer queues queries on a busy pg client; the MCP tool-name rule names
   connector systems instead of banning "connector".
5. Changelog entry `cloud-w1c`, with its two screenshots (6 Oct; `npm run shots -- cloud-w1c` retakes them on a demo
   started with `PLCOS_CLOUD_WORKFLOWS=on` and an invented key).
6. **Overnight, 6 Oct** (Juan away; choices recorded in docs/28 §8):
   - the first-cut Run W1 / W1c / W5 buttons fenced behind Cloud workflows;
   - W1c corrections (slice 2, `cloud-w1c-correct.ts`), on a tick;
   - W1 in the cloud (`cloud-w1.ts`): web search with checked queries, the server's page reader, minimal LP rows;
   - W5 in the cloud (`cloud-w5.ts`): no tools, server-written pins, the importer's layout rules.

## How it was checked here

The cloud container has Node 22; the Dockerfile builds on Node 26, and `npm run props` fails to load under 22
(a `registerHooks` load hook returns null). Everything below ran under Node 26.10, downloaded for the session.
`npm install` on Linux rewrites package-lock.json (platform optional packages), so deps-sync refuses to stamp; the
lockfile was restored and `npm ci` used instead.

- `bash scripts/gate.sh`: tsc, boundaries and **1637 of 1637 properties hold** on PGlite (the unchanged base: 1627 of
  1627; the ten new ones are cloud-w1c and sync-runs).
- Postgres: a throwaway Postgres 16 cluster on 127.0.0.1:5434 (production is 17). The suite stops in
  routes-perf on its 20 s statement timeout, while inserting the perf fixture; the unchanged base stops at the same
  place, so it is this container's speed, not the branch. **Postgres props did not complete here**; run them on the Mac.
- Not run: e2e, screenshots, any real Anthropic call or real page fetch.

## Waiting on Juan

- Merge, gate on the Mac, ship. The screenshots are taken.
- Then, to try it: turn on Cloud workflows on Railway and run a five-finding W1c batch, comparing its grades with
  the Mac's fact-checker on the same findings. That sends those findings and their pages' text to Anthropic.
