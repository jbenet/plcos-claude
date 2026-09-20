# Capital OS — Local-First Bootstrap

**An L-series you can run with `npm install && npm run dev`, no services, no deployment. Then a D-series that goes live without a rewrite.**

*Prepared 20 September 2026. Supersedes the v0–v15 ordering in the build plan for the first six weeks; the D-series picks that plan back up.*

---

## One substitution before the phasing

You said SQLite locally, Postgres live. I'd push back on that specific pair and propose **PGlite** instead — Postgres compiled to WASM, running embedded in the Node process, backed by a file on disk. `npm install`, no Docker, no service, no daemon.

**Why it's a better fit for exactly what you asked for.** SQLite → Postgres has real divergences, and they sit precisely where this system's logic lives:

| SQLite | Postgres | Where it bites |
|---|---|---|
| No `jsonb` | `jsonb` with operators and indexes | `audit_event.before/after`, `signal.payload`, dossier evidence |
| No `CREATE SCHEMA` | Schema-per-module | The module boundary, which is a core architectural commitment |
| No `gen_random_uuid()` | Native | Every primary key |
| Type affinity, not types | Strict types | Numerics on amounts and probabilities |
| No `ILIKE`, no arrays | Both | Entity search, alias matching |
| Different upsert syntax | `ON CONFLICT` | Every connector's idempotent write |
| No RLS | RLS | The research/confidential plane |

You'd write the ask-frequency guard against SQLite, test it, and then discover it behaves differently in production — which is the one query in the system where a silent behavioural difference actually costs you something.

PGlite gives you identical SQL, identical types, identical everything. The dev/prod delta collapses to a connection string.

**The caveats, honestly:** it's single-connection and embedded, so it's a development and test target, never a production one — which is fine, because that's all we're asking of it. It's an ElectricSQL project, actively developed, and worth 20 minutes of verification against your Node version before committing.

**If PGlite disappoints, the fallback order is:** (1) `docker compose up` with real Postgres — one command, still no deployment; (2) SQLite behind the repository interface below, accepting the divergence list and writing the guard query twice.

Either way, **the data layer sits behind a thin repository interface**, so this is a swap and not a rewrite.

---

## The seams — what gets stubbed now, swapped later

"Defer the open questions, make them easy to change later" translates into five seams. Each has a real interface and a local implementation from L0, so the later version is a new class rather than a refactor.

| Seam | Interface | Local implementation (L-series) | Later (D-series) |
|---|---|---|---|
| **Storage** | `Db` (repository per module) | PGlite, file on disk | Managed Postgres via `DATABASE_URL` |
| **Connectors** | `Connector<TRaw>` — `backfill` / `poll` / `onWebhook` / `normalize` | `FixtureConnector` reading local JSON/CSV | EDGAR, Affinity, Linear, Drive |
| **Auth** | `AuthProvider` — `currentUser()`, `listUsers()` | `LocalAuth` — a user-switcher dropdown in the header | PL Labos kit |
| **Issues** | `IssueSink` — `create(issue)` | `FileIssueSink` — appends to `./local/issues.jsonl` | `LinearIssueSink` |
| **LLM** | `Agent` — `run(task): Result` | `StubAgent` returning fixtures, or a real key if you set one | Budgeted worker fleet with Langfuse |

**The decisions you're deferring become config, not assumptions.** All of them live in one file:

```ts
// config/deployment.ts — every deferred decision, in one place
export const config = {
  affinity: {
    // unanswered: Scale → poll-first; Advanced/Enterprise → Data Share
    tier: null as 'scale' | 'advanced' | 'enterprise' | null,
    syncMode: 'deferred' as 'deferred' | 'poll' | 'dataShare',
  },
  warehouse: {
    // unanswered: own schema with write access for canon tables?
    enabled: false,
    canonMode: 'inProcess' as 'inProcess' | 'warehouse',
  },
  issues: { provider: 'file' as 'file' | 'linear' },
  auth:   { provider: 'local' as 'local' | 'labos' },
  guard:  { asksPerRelationshipPerQuarter: 1 },   // tune by feel, not by spec
  scoring:{ weights: { capacity: .25, affinity: .30, propensity: .25, timeToDecision: .20 } },
};
```

Nothing in the L-series reads a value that isn't in this file or the database. When the Affinity tier answer arrives, you change one string.

---

## The L-series — runs on your laptop, no deployment

Each version ends with `npm run dev` working and something new you can feel. The **feel test** is the acceptance criterion: not "does it work" but "does using it change what you'd do."

### L0 — It runs

**Ships:** repo, TypeScript, Next.js, PGlite with the DB file at `./local/capital.db`, migrations auto-applied on boot, seed script, the five seams above with their local implementations, a header with a **user switcher** (Juan / Maya / Ines / Tomas), and one page that says how many entities are loaded.

**Why the user switcher at L0:** you cannot feel an ask collision as one person. Being able to flip identity in the header is what makes L1 demonstrable, and retrofitting it later means touching every query.

```
npm install
npm run db:reset     # drop, migrate, seed
npm run dev          # http://localhost:3000
```

**Feel test:** it starts in under 15 seconds from a clean clone and you never installed a database.

**Size:** 2 days.

---

### L1 — Ask log and the guard

**Ships:** `identity.entity` (minimal), `coordination.ask`, `platform.audit_event`. The ask log page. The frequency guard as a synchronous check in the write path — refuse over the cap, return the conflicting ask, allow an override that requires a reason and writes an audit row. Audit rows in the same transaction as every state change.

**Feel test — the one that matters most in the whole L-series:** switch to Maya, try to log an ask against a relationship where Juan logged one twelve days ago. You get blocked, you see whose ask it is and when, and the override costs you a sentence. **If that moment doesn't feel right, the rest of the system is built on sand** — tune the cap, the message, and the override friction here before building anything else.

**Size:** 3 days.

---

### L2 — Entities, import, search

**Ships:** full entity model with `merged_into` redirects, `source_record`, `assertion` (human same-as / not-same-as as hard constraints). CSV import. Deterministic resolution only — normalized email, domain, exact name. Merge/split UI. Fast search. Entity detail page showing asks and history.

**Feel test:** import your real census CSV, merge three duplicates by hand, re-import the same file, and confirm your merges survived.

**Size:** 4 days.

---

### L3 — Vehicles, exposure, coverage

**Ships:** `vehicle`, `exposure` (entity × vehicle × instrument, one owner, stage, amount, probability). Stage model with the research's probability weights, including the deliberate non-monotonicity where a soft circle scores below active diligence. Coverage ratio per vehicle and aggregate. Cross-vehicle conflict view.

**Feel test:** enter Neurotech I, Crypto/Rails and the live SPVs with real numbers. The coverage figure matches your own arithmetic, and the conflict view names every relationship sitting in two vehicles at once.

**Size:** 4 days.

---

### L4 — Close room

**Ships:** per-LP close tracking — verification status, sub docs sent/signed, side letter, wire. Funded / docs-signed / docs-out / gap breakdown. Blocking reason per row. MFN cascade calculator. Median signature-to-wire.

**Feel test:** for every LP in documents you can answer "what's blocking this, and who owns it" without asking anyone.

**Size:** 3 days.

---

### L5 — Signals, on fixtures

**Ships:** the connector runtime for real — the four-method interface, landing tables holding raw JSON, normalization as a separate replayable step, idempotency on `(source, source_id, source_updated_at)`. One implementation: `FixtureConnector`, reading `./fixtures/edgar-form4.json` and friends. `intel.signal` with priority, claim, and five-day decay back to the pool. Signal desk page.

**Why fixtures rather than live EDGAR:** the runtime is the hard part and the fixtures exercise all of it. Swapping in the real EDGAR poller at D3 is one class implementing an interface you've already proven. It also means the signal desk is demoable on a plane.

**Feel test:** run `npm run signals:load`, and a liquidity event appears as a claimable signal with the filing linked. Claim it as Maya; it leaves the pool.

**Size:** 4 days.

---

### L6 — Scoring

**Ships:** four components stored separately, each with `last_refreshed` and evidence. Propensity decays on a configurable half-life. Hard gates that exclude with a visible reason. Two ranked views over the same data — "EOY close" weighting time-to-decision heavily, "2027 pipeline" not. Full decomposition on every score. Weights read from `config/deployment.ts`.

**Feel test:** you disagree with a ranking, open the decomposition, and can name exactly which component is wrong — then change a weight in the config, reload, and watch the order move.

**Size:** 4 days.

---

### L7 — Feedback capture

**Ships:** the feedback box on every page, capturing text, URL, and current user. Writes `platform.feedback` + audit. LLM triage into `{bug | request | question | spam}` with confidence, behind the `Agent` seam — `StubAgent` by default, real if you set a key. `FileIssueSink` appends to `./local/issues.jsonl`.

**Why the capture UX now and the Linear loop later:** the thing worth getting right early is whether people actually use the box, and whether triage classifies your real complaints correctly. Both are testable on a laptop. The GitHub Action half needs a repo, CI, and branch protection — that's D-series.

**Feel test:** use the app for a day, file six pieces of feedback as different users, and check whether the triage got them right.

**Size:** 3 days.

---

**L-series total: roughly 27 engineer-days.** At half-time that's five to six weeks, and at the end you have something the team can genuinely use for the December close with manual data entry — no cloud account, no connector credentials, no deployment.

---

## The D-series — going live

These pick up the earlier build plan, reordered around what the L-series already proved.

| | Ships | Unblocks |
|---|---|---|
| **D0** | Provisioning: managed Postgres, CI/CD, preview envs with DB branching, secrets per workload, Sentry. `DATABASE_URL` swap — no application code changes. | Everything |
| **D1** | Real auth via PL Labos kit, replacing `LocalAuth`. Multi-user for real. | The team actually using it |
| **D2** | Linear connector + `LinearIssueSink` + Claude Code GitHub Action + `agent-ready` gate + branch protection. The full feedback loop. | Every later version gets cheaper |
| **D3** | EDGAR connector replacing `FixtureConnector`. Job boards, 990-PF. | Live signals |
| **D4** | Affinity — Data Share or poll-first, per the tier answer. Splink resolution. | The graph |
| **D5** | Graph + route planner | Intro routing |
| **D6** | Agent runtime: isolated worker, two data planes, Langfuse, eval set | Research leverage |
| **D7+** | Meetings, materials, compliance registry, grants, learning loop | Q1 |

**The migration at D0 is a connection string**, provided nothing in the L-series reached past the repository interface. That's the constraint to hold: no raw `pglite` import outside `lib/db/`.

---

## Repo shape

```
capital-os/
  config/deployment.ts        # every deferred decision, one file
  lib/
    db/
      index.ts                # Db interface + factory from DATABASE_URL
      pglite.ts               # local
      postgres.ts             # live (D0)
      migrate.ts
    auth/                     # AuthProvider: local.ts | labos.ts
    connectors/
      types.ts                # Connector<TRaw>
      fixture.ts              # L5
      edgar.ts                # D3
      affinity.ts             # D4
    issues/                   # IssueSink: file.ts | linear.ts
    agent/                    # Agent: stub.ts | claude.ts
  modules/
    identity/  coordination/  pipeline/  intel/  scoring/  content/
      ...each: schema.sql · repo.ts · service.ts · index.ts (public interface)
  app/                        # Next.js routes
  migrations/
  fixtures/                   # edgar-form4.json, entities.csv, …
  local/                      # gitignored: capital.db, issues.jsonl
  scripts/
    reset.ts  seed.ts  demo.ts  signals-load.ts
```

Module boundaries are enforced from L0 by two cheap things: **schema-per-module in Postgres** (a cross-module join fails rather than being frowned upon), and a **lint rule forbidding imports of anything but a module's `index.ts`**. Both cost an afternoon and both are annoying to retrofit.

---

## Seed data

The L-series is only as convincing as its fixtures, so budget half a day on these rather than treating them as throwaway:

- **`entities.csv`** — your real census if you're comfortable putting it on a laptop, otherwise 60–80 synthetic entities with realistic name variants so the dedup UI has something to chew on.
- **`asks.json`** — pre-seeded so the guard fires on first use. The collision should be waiting for you, not something you have to construct.
- **`edgar-form4.json`** — half a dozen liquidity events, two matching seeded entities and four not, so resolution has both cases.
- **`scenario-december.ts`** — a `npm run demo` that loads a coherent snapshot: mid-raise, one conflict pending, three signals unclaimed, two LPs blocked in the close room. This is what you show the team.

**A note on real data:** if you seed with the actual census, `./local/` stays gitignored and the laptop is the only copy. Real LP names and amounts shouldn't reach a shared repo or a lower-trust environment — that's the same rule as "never seed staging with production data," applied early.

---

## What this defers, explicitly

So nothing is quietly lost:

- Affinity, Linear, Drive, DocSend, Fireflies — all D-series, all behind interfaces that exist from L0
- The GitHub Action half of the feedback loop — D2
- Entity resolution beyond deterministic rules — D4 (the review queue UI ships at L2 and sits mostly empty until then)
- The warehouse and canon contract — D4, and only if the access answer is yes
- Agents doing real work — D6. `StubAgent` until then, which is enough to prove the UX.
- The two data planes — schemas exist from L0, the grant separation lands at D6 with the first real agent

---

## The honest risk

**The L-series is seductive.** It works, it's fast, nobody's waiting on a cloud account, and there's no pager. The failure mode is spending eight weeks polishing a laptop app while the close needs coordination across seven people who can't all run `npm run dev`.

**The forcing function: D0 and D1 start the day L4 ships**, in parallel with L5–L7. Provisioning is three days of work that doesn't compete with feature building, and the moment more than one person needs to log an ask, the local version is a demo rather than a tool.

---

## Next

I can build **L0 + L1** — migrations, the three tables, the guard with its override path, the ask log page, the user switcher, seed data with a collision pre-loaded — and hand you a folder you can run. That's the smallest thing that answers the question you actually asked, which is whether the guard *feels* right. Say the word and I'll start.
