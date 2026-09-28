# 05 — Testing and hardening before deploy

Plan, 28 Sep 2026. Scope: what has to be true, and proven by a test, before people other than
Juan reach the app on shared PL infrastructure. Numbers marked **GUESS** are starting budgets,
not measurements; replace them after the first staging run.

## 1. What the kit and LabOS give us for this topic

Very little testing, some hard limits we must test against.

- **Runtime envelope: 384Mi memory (hard, OOM-kill), 300m CPU (throttle). Build: 2Gi, 1 CPU**
  (kit `CLAUDE.md`, "Resource limits"). The kit also says not to spawn worker processes.
  We run Next, a `pg` pool of 8 (`lib/db/postgres.ts`) and an import child process. No load test
  means anything until we know which envelope we get.
- **`GET /health` must return 200** (kit `CLAUDE.md`, "Building the app"; `app/server.js`). We
  serve `/api/health`, which is database-free, so `/health` needs an alias.
- **Sign-in:** every path requires LabOS sign-in unless listed in `publicPaths`. LabOS does not
  authenticate public paths; the app must protect them itself, including rate limits
  (deploy-to-labs `SKILL.md`, "Public endpoints").
- **Identity:** the `authToken` cookie is scoped to the shared apps domain and read by browser
  JavaScript (pln-member-context `SKILL.md`). The skill says to use it for **personalisation only,
  never to gate sensitive actions**. That means LabOS gives us no authorisation.
- **Framing:** the app runs in an iframe from `https://os.pl.xyz` on its own `<appId>.os.pl.xyz`
  origin. The rules: no `X-Frame-Options`, and any CSP needs `frame-ancestors 'self' https://os.pl.xyz`
  (kit `CLAUDE.md`).
- **Analytics are on by default.** `initRouteSync()` posts the pathname and query string to the
  dashboard, and baseline events go to PL (kit `CLAUDE.md`, "Product analytics").
- **Logs:** stdout and stderr go to CloudWatch, which anyone with a deploy token for the app can
  read (app-logs `SKILL.md`).
- **Database:** Postgres is provisioned through `DATABASE_URL`. The kit says nothing about
  backups, PITR, failover, `max_connections` or a staging copy (db-migration `SKILL.md`).
- **No staging environment, load tooling, security scan or rate limiter.** Each deploy replaces
  the app.

What we already have (repo `plcos-claude-live`):

| Asset | What it proves | Gap for a deployment |
|---|---|---|
| `npm run props` (~1,000 properties, PGlite and `DATABASE_URL` Postgres) | Domain rules, import idempotency (`import-robustness-properties.ts`), feedback journal dedupe, pool/worker behaviour (`properties/postgres.ts`, `pglite-worker.ts`) | Single user, in-process; nothing over HTTP; no authorisation tests (there is no authorisation) |
| `scripts/boundaries.ts` | Static rules: DB drivers only in `lib/db`, connector hosts and keys only in their connector, no `crypto.randomUUID` in the browser | No rule for "every server action checks the actor" |
| `ship.sh` (session scratchpad, **not in the repo**) | Gate, then ff-merge, then curl 3 real pages; rolls back on non-200 or a build error | Not committed; hard-coded to `localhost:3000`; no deploy target |
| `scripts/time-pages.ts` | Sequential cold/warm page timings (budget 10 s / 3 s); refuses live ports | Sequential only, with no concurrency |
| `lib/responsiveness.ts` | Event-loop p99/max written to `data/.../activity/*.jsonl` | Local file; nothing alerts on it |
| `npm run demo`, `perf4:seed` (invented, refuses real paths and `DATABASE_URL`) | Fictional data at scale | Not yet loadable into a deployed Postgres |
| `docs/22-backups.md` | Encrypted tar backups, a weekly restore drill written down | Mac-local; no drill against Postgres or LabOS |

## 2. Options

**A. Test on the Mac, then deploy.** Run load and break-it tests against `npm run build:real`
or a demo production build on this Mac, then ship.
Cost: S. Risk: high. The Mac has no 384Mi limit, no LabOS proxy, no iframe and no managed
Postgres, so the tests pass on something we don't run.

**B. A staging app on LabOS with invented data. Agents attack it; a gate blocks production.**
Deploy a second LabOS app (e.g. `plcos-staging`, private to Juan and the builders) from the same
build, with `DATA_PROFILE=demo`, the perf4 invented fixture, and its own provisioned Postgres.
Load tests, Playwright flows and an adversarial agent suite run against it. Every production deploy
first passes the same gate on staging.
Cost: M to set up, then minutes per deploy. Risk: low. Staging tests the real envelope, proxy,
iframe and database, and no real data leaves our system.

**C. Option B, plus a real-volume shadow on our own hardware.** Also restore a real backup into
an isolated Postgres on this Mac and run `time-pages` and load tests there to catch performance
problems that only real data shapes show.
Cost: M+. Risk: low, and the real data stays local. Fit: this is what we already do with
`time-pages` on a copy. Keep it as the performance check for real data, not the security check.

## 3. Recommendation: B for the gate, C for real-data performance

Invented data on staging can be attacked freely, published in reports and screenshotted. Real
data is never used as test data off this Mac. The concrete plan:

### 3.1 Stress testing (staging, production build, Postgres)

Tools: **autocannon** (npm dev dependency) for per-route HTTP load, and **Playwright** (already a
dev dependency) for concurrent browser flows. Both are Node, and our agents already run them.
Use **k6** only if we later want load from outside the Mac. It is a separate binary and its
thresholds DSL is nice but not needed at 30 users.

| Scenario | How | Pass (GUESS until first run) |
|---|---|---|
| Concurrent users | 10, 20, then 30 Playwright contexts, each a persona script (browse pipeline, open LP, edit stage, filter, open routes), 2–5 s think time, 30 min | List pages p95 < 1.5 s, heavy pages p95 < 4 s, p99 < 8 s; **0 5xx, 0 "server is busy"**; event-loop p99 < 200 ms |
| Heavy pages | autocannon on `/[vehicle]/visualizations`, routes, LP stats, strategy tables, at 5 and 15 connections for 2 min | No errors; p95 within 2× the single-user `time-pages` warm time; memory returns to baseline within 60 s |
| Import while browsing | Start the fixture import (child process) during the 20-user run | Browse p95 rises < 50%; 0 lock or statement timeouts on foreground; import completes; job row ends `done` |
| Memory over hours | 8 h overnight soak at 10 users; sample RSS every 30 s (`process.memoryUsage` via a dev-only probe) | After warm-up, RSS slope < 5 MB/h; peak < 80% of the container limit; **0 OOM restarts** (checked in runtime logs) |
| Connection pool | Replicas × `max 8` + worker pool + migration role ≤ provider `max_connections` − 5; then 30 users plus an import | 0 "timeout acquiring client"; the pool's waiting count returns to 0; `select count(*) from pg_stat_activity` bounded |
| Burst / overload | 60 connections on one heavy page for 60 s | Controlled busy answers only (existing 20 s statement timeout), no crash; recovery < 60 s |

The 384Mi envelope is the first thing this will test. My expectation, not yet measured, is that
Next plus the import child does not fit. The build list therefore measures it first (B1).

### 3.2 Break-it testing from user space

Start with an **inventory**. Today there are 19 `'use server'` files with about 61 exported
actions, plus 10 route handlers (`app/api/*`, the two `shot` routes). In Next every exported server
action is a public POST endpoint whose ID can be found in the client bundle. `boundaries.ts` gets a
rule: every exported action and every non-GET route handler calls one guard,
`requireActor(capability, vehicle?)`, before it does anything else. A property then calls each one
directly and checks it.

| Attack | Test | Pass |
|---|---|---|
| Malformed input | For each action: wrong types, missing fields, 1 MB strings, null bytes, RTL/zero-width Unicode, NaN/negative/1e308 money, SQL metacharacters, unknown and other-vehicle UUIDs | 4xx or a controlled error, no stack in the response, **no row changed** (compare the audit log and table counts before and after) |
| Double submit | Fire each write twice concurrently, once with the same request key and once with different keys; double-click in Playwright | One effect per key (AGENTS.md: acceptance is idempotent); duplicates refused, not merged silently |
| Races | Two personas change one LP's stage, amount or consent rung in the same 50 ms, in both orders | No lost update without a record. Either a version check refuses the second write, or both land in the audit log with the final state explained. **Hard/soft totals conserved** (invariant 10) |
| Authorisation bypass | Raw `fetch` with a `Next-Action` header as a viewer, as another vehicle's member, signed out, and with a forged `plcos_*user` cookie | Refused. Identity comes only from the verified LabOS token; the user switcher is compiled out (`auth.switchable = false`) |
| URL and header tampering | Swap vehicle slugs and IDs in paths; send `x-routed: 1` + `x-vehicle: <other>` directly | Refused or 404. **Known bug today:** `proxy.ts` passes any request that carries `x-routed` through untouched, and `lib/session.ts` trusts `x-vehicle` from it. Harmless while vehicles are only presentation state, but a bypass once they gate access. Fix: the proxy deletes both headers from incoming requests |
| Oversized uploads | Feedback box with 12 MB images × N, 40 MB total, slow uploads, 100 in parallel | `lib/feedback-inbox.ts` allows 40 MB of base64 per report. JSON parsing multiplies that in memory, so under 384Mi it can OOM. Lower the cap (e.g. 8 MB total, GUESS), reject by `Content-Length` before parsing, and test 20 parallel posts with no restart |
| XSS | Invented names, notes and issue text containing `<script>`, `<img onerror>`, `javascript:` links and markdown/HTML, entered in tiptap notes, imports and feedback | Nothing runs (a CSP report counts as a failure), and links are sanitised. This matters more than usual: XSS in our origin can read the LabOS `authToken` cookie, which is readable by JavaScript |
| CSRF | Cross-site and **sibling-subdomain** (`evil.os.pl.xyz`) form posts and fetches to every route handler and action | Server actions: Next's Origin/Host check has to pass behind the LabOS proxy (set `serverActions.allowedOrigins` exactly). Route handlers (`/api/session`, `/api/feedback`, `/api/identity/*`, `/api/connection-feedback`) have no Origin check today, and `SameSite=Lax` does not stop same-site sibling apps. Add an Origin allowlist for non-GET requests in `proxy.ts` |
| Rate limits | 50 writes/s per member, feedback floods, search floods | In-process token bucket per member (single replica), e.g. 10 writes/s and 5 feedback/min (GUESS). Returns 429 with a plain message and no data loss |

**Adversarial user agent suite.** Our agents can run this as a workflow, with a work envelope
(AGENTS.md) that has these limits:

- **Target allowlist:** the staging host only. The suite refuses to start unless `/health` on the
  target reports `profile: demo`, the same way `time-pages` refuses ports 3000/3001 and perf4
  refuses real paths.
- **Personas:** admin, a vehicle editor, a viewer on a different vehicle, signed-out, and a
  sibling-origin page. The personas are invented LabOS test members, or a staging-only header
  auth that production refuses to build with.
- **Agents:** one per attack family above (inputs, idempotency, races, authz/tampering, uploads,
  XSS, CSRF, rate). Each gets the action inventory and the fixture's canary strings and writes
  findings as `{action, request, expected, observed, severity, repro}`. A reproducible finding
  becomes an issue in the staging feedback path, never in real issues. A fixed regression set
  grows from every real failure (AGENTS.md: "a fixed set overfits"), and agents cannot edit their
  pass criteria.
- **Canaries:** the invented fixture plants unique strings in names, notes and emails. After every
  run, a grep of runtime logs, analytics payloads and outbound requests for any canary is a failure.
- **Cadence:** the full suite runs nightly on staging, and a 10-minute subset runs in the deploy gate.

### 3.3 Security review

- **Dependencies:** `npm audit --omit=dev` and `osv-scanner` on `package-lock.json`, in the gate,
  failing on high or critical. Pin Next to a patched release. Proxy/middleware bypasses have
  shipped in Next before (e.g. the 2025 `x-middleware-subrequest` CVE), so **authorisation lives in
  the action guard, never only in `proxy.ts`**.
- **Secrets:** `gitleaks` on the full history and on the exact ZIP before upload. Build the ZIP
  from an **allowlist** (`app/`, `components/`, `lib/`, `modules/`, `config/`, package files), not
  a denylist, so `data/real`, `.env`, the Keychain helper scripts and `.next-real*` can't be
  included. Grep `.next` output for `NEXT_PUBLIC_` values and keys. Production source maps off.
- **Headers** (checked by a property on the built server): CSP with nonces for the two inline boot
  scripts in `app/layout.tsx` and `frame-ancestors 'self' https://os.pl.xyz`; no `X-Frame-Options`;
  `X-Content-Type-Options: nosniff`; `Referrer-Policy: same-origin`; `Permissions-Policy` empty;
  `poweredByHeader: false`; our cookies `Secure` + `HttpOnly`.
- **Server actions exposure:** the inventory and guard rule above. `/developer/*` (Affinity sync,
  init reload, enrichment, data) is either left out of the production build or requires the admin
  capability. Which of the two is user-proofing's decision; the test checks whichever is chosen.
- **Public endpoints:** none (`publicPaths` empty). If a webhook comes later, it gets HMAC
  verification, a size cap and a rate limit before it is listed.
- **Logs and telemetry:** stdout goes to CloudWatch, which PL can read. Log only IDs, counts and
  timings. Scrub `pg` error `detail`, which echoes key values. Keep route handlers from returning
  `err.message` verbatim (the feedback route does today). **Analytics:** `initRouteSync()` sends
  path and query to PL, and our paths and filters can carry LP slugs. Send only route templates, or
  turn it off. This is a real-data boundary.

### 3.4 Resilience

- **Restore drill:** before launch and then monthly, restore the latest production backup into an
  empty database and run the smoke checks. Measure RTO (target < 1 h, GUESS) and RPO. The kit says
  nothing about backups of provisioned Postgres, so until PL confirms PITR we run our own nightly
  encrypted `pg_dump` (docs/22). Where that dump is stored is a real-data decision.
- **Database failover:** on staging, `pg_terminate_backend` every app connection mid-load, then
  restart or block Postgres for 2 min. Pass: `/health` stays 200, pages show a controlled error,
  the pool reconnects without a restart, no half-written multi-step change (each is one transaction).
- **Job crash recovery:** `kill -9` the import child mid-batch, and trigger a container OOM kill
  during an import. Pass: the job is marked failed or resumable, a re-run is idempotent (0 duplicate
  rows, per the existing import-robustness properties), and a stale job lock is released.
- **Connector down:** Affinity, Dakota, Linear and Polaris answer by timing out, 429, 500 or
  malformed JSON, via fault injection in each connector's own config (boundaries rule intact).
  Pass: pages render from the database with "as of" staleness shown; no page request waits on a
  connector; retries are bounded. Some connectors may be unreachable from LabOS entirely, and the
  test settles which ones.
- **Rollback:** commit `ship.sh`, generalised to a target. A failed staging or production smoke
  check redeploys the previous ZIP. A migration that has been applied cannot be rolled back
  (migrations are immutable), so migrations must be backward compatible for one release.

### 3.5 Pre-deploy go/no-go checklist

Automated (the gate blocks a deploy on any failure):

1. `tsc`, `boundaries` (including the action-guard rule), and `props` on PGlite and Postgres.
2. Production build within 2Gi; ZIP built from the allowlist; gitleaks clean; no `data/real` path
   in the ZIP.
3. `npm audit` / `osv-scanner`: 0 high or critical in production dependencies.
4. Staging deploy: `/health` 200, smoke pages 200, embeds in an `os.pl.xyz` iframe, header
   property passes.
5. 10-minute adversarial subset: 0 findings at severity ≥ medium; 0 canary hits in logs or analytics.
6. 10-user, 10-minute load: within the p95 budgets, 0 5xx, RSS < 80% of the limit.

Once before the first production deploy (Juan signs off):

7. 8 h soak and 30-user run passed on staging.
8. Restore drill done, RTO measured, backup location decided.
9. Failover, job-crash and connector-down drills passed.
10. Local user switcher compiled out; LabOS identity verified server-side; access groups mapped.
11. `/developer/*` stripped or admin-gated; `publicPaths` empty; analytics route sync decided.
12. Rollback tested: deploy a broken build to staging and watch it roll back.

## 4. Decisions for Juan

1. **Is staging a second LabOS app with invented data only, and is it the only target for agent
   attacks and load?** Suggested: yes. No real data on staging, ever.
2. **Is real data ever used as test data off this Mac?** Suggested: no. Real-volume performance
   stays on a local restored copy (option C).
3. **Container memory:** do we ask PL for more than 384Mi (suggested 1–2Gi), or move imports out
   of the request container? Suggested: ask first, and measure (B1) before designing around it.
   The pass criteria are relative to whatever limit we get.
4. **Concurrent edits to one LP:** refuse the second write with a version check, or last writer
   wins with both writes audited? Suggested: a version check on stage, amounts and consent;
   last-writer-wins for notes.
5. **Analytics route sync sends paths to PL:** templates only, or off? Suggested: templates only
   (`/[vehicle]/lp/[id]`), no query string.
6. **Where does the nightly encrypted Postgres dump live** if PL can't confirm backups? Suggested:
   pulled to this Mac, as today (docs/22), until PL answers.
7. **Gate authority:** may the automated gate block and roll back production without asking?
   Suggested: yes. Juan signs only the first production deploy (checklist 7–12).

## 5. Build list

| # | Item | Size | Tonight? |
|---|---|---|---|
| B1 | Measure RSS of the demo production build (`next start` + pg pool + one import) under `--max-old-space-size` and a 384Mi cgroup-like cap; report | S | Tonight |
| B2 | Fix `proxy.ts` header injection (strip incoming `x-routed`, `x-vehicle`, `x-asked-path`) + property | S | Tonight |
| B3 | Origin allowlist for non-GET requests in `proxy.ts`; the feedback route stops echoing `err.message`; feedback size check by `Content-Length` and a lower cap | S | Tonight |
| B4 | Server-action and route-handler inventory script + `boundaries.ts` rule "calls `requireActor`" (report mode first, enforce once guards exist) | M | Tonight (report mode) |
| B5 | Commit `ship.sh` as `scripts/ship.ts` with a `--target` option, smoke pages and a build-error grep | S | Tonight |
| B6 | Canary strings in the perf4 invented fixture + a log/analytics canary scanner | S | Tonight |
| B7 | Security headers + CSP nonces + header property; source maps off; `/health` alias | S | Tonight |
| B8 | Load harness: autocannon per route + Playwright personas + p95/RSS report, refusing any non-demo target | M | Tonight, locally against a demo prod build |
| B9 | `requireActor` guard wired into all ~61 actions and 10 handlers; user switcher compiled out | L | Needs the auth/access-group decisions (other sections) |
| B10 | Staging LabOS app + provisioned Postgres + fixture load | M | Needs decisions 1 and 3 |
| B11 | Adversarial agent suite (8 agent roles, regression set, nightly) | M | Harness tonight; runs after B10 |
| B12 | Resilience drills (restore, failover, job kill, connector faults) scripted on staging | M | After B10 |
| B13 | Version checks on LP stage/amount/consent writes + race properties | M | Needs decision 4 |
| B14 | Deploy gate wiring (checklist 1–6) around the deploy skill | M | After B10 |

## 6. Feedback for the kit devs

- **Give us a staging slot.** Let one app have a second, private deploy target with its own
  database. A deploy with no pre-production step pushes every app to test in production.
- **Document provisioned-Postgres backups, PITR, `max_connections` and failover.** Also a way to
  take a dump. Nothing in `db-migration` covers this.
- **384Mi is tight for Next.js with a database pool.** Publish a way to request more, or the real
  per-app ceiling.
- **The `authToken` cookie is readable by JavaScript and shared across every app subdomain.** XSS
  in any vibe-coded app can steal a member's LabOS token, and all apps are same-site to each other,
  so `SameSite` gives no CSRF protection between them. Suggest an `HttpOnly` cookie with a
  per-app, audience-scoped token (or a verified identity header injected by the proxy), and say
  plainly in the kit that sibling apps are hostile origins.
- **There is no server-verifiable identity.** "Personalisation only, never gate on it" leaves any
  app with access groups inside it on its own. A signed identity header from the LabOS proxy would
  fix this.
- **`initRouteSync()` sends full paths and queries to PL by default.** Apps with confidential
  identifiers in URLs need a documented templates-only mode.
- **Runtime logs are readable with a deploy token.** Say who else (platform staff) can read them,
  and for how long, so apps can decide what may be logged.
