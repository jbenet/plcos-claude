# 15 — Affinity, read-only

**Status:** decided 22 Sep 2026, building from N38. Supersedes "no connectors before L13" for
Affinity only, and only for reading. Linear, Drive and DocSend still wait for L13.

The first real data in the tool comes from Affinity. For a while it is **read-only**: we use
what is there and write nothing back, until the wiring has been checked against the real
records. This document is the plan, the decisions Juan made about it, and the rules that
shape both.

---

## 1. The rules

1. **Read-only is enforced in code, not by convention.** Affinity keys are not scoped. The
   key Juan created can write, and Affinity offers no way to limit it. So read-only lives on
   our side: one HTTP client, GET only, to a fixed list of paths, refusing anything else
   before a request leaves the machine. A property test proves a write throws.
2. **Keep a local copy; never read Affinity live from a page.** See §4.
3. **Affinity fields are claims, not evidence.**
   - A stage field is not a consent-ladder rung.
   - An amount field is not a hard commitment.
   - A relationship-strength score is not a tier-A edge.

   Mapping any of these straight across is how the tool would start quietly lying (CLAUDE.md
   rules 1, 2 and 6).
4. **Real data never leaves this machine through our own tooling.** It stays out of git, the
   changelog, the published build log, screenshots, `issues/`, web searches and sub-agent
   prompts. Claude may read real records while working; that is Juan's call (below), and it
   does not extend to any of those places.

---

## 2. Decisions

| Question | Decision (Juan, 22 Sep) |
|---|---|
| Where real data lives | Inside this repository, under `data/real/`, gitignored — not in `~/Library`, so other tools on the machine don't poke at it. All data lives under `data/<demo\|real>/`. |
| The API key | 1Password, item **"Affinity API - App: plcos-claude"**, injected with `op run`. Never printed, never written to disk. Deployment secrets wait until the infrastructure is chosen. |
| Plan tier | Unknown. The connection test finds out from the API's own answers. |
| Lists | Juan named the list that probably tracks Neurotech, and a second that may. Both are in `data/real/init.jsonc`, not here: list names describe the real pipeline, so they stay with the real data. Rails' list is unknown; ask someone later. Several SPV lists exist, each with "SPV" in the name. |
| A view-only key | Not possible — the key is read-write and cannot be changed. Hence rule 1. |
| Notes | Import note **text** for Neurotech only, so the strategy side has something to reason with. Health detail about a person or their family is flagged and never copied into a derived record (Report 4 §6.2). |
| What Claude may see | "I'm ok with you seeing the info, just keep it confidential and don't send it anywhere." |

---

## 3. Two profiles (N38)

| | Demo | Real |
|---|---|---|
| What it is | fictional people, firms and amounts | the raise |
| Started with | `npm run dev` | `npm run dev:real` |
| Served at | port 3000, reachable on the LAN | `127.0.0.1:3100`, this machine only |
| Kept in | `data/demo/` | `data/real/` |
| Starts from | `fixtures/` | `data/real/init.jsonc` |
| Reset | `npm run demo` | refused |
| Screenshots | `npm run shots` | refused |
| Feedback goes to | `issues/` (committed) | `data/real/issues/` (never committed) |

`DATA_PROFILE` decides the profile, read once in `config/deployment.ts`. A typo throws rather
than falling back to the demo. The two servers use separate build directories (`.next`,
`.next-real`) and separate cookies, so both can run at once.

**Guards,** each in the file that owns the behaviour:

- git ignores `data/*` except `data/README.md`
- `seed()` refuses the real profile, so no caller can get it wrong
- `db:reset`, `db:seed` and `npm run demo` refuse the real profile
- `npm run shots` asks the server (`/api/profile`) and stops unless it says demo
- in the real profile, `DATABASE_URL` is refused and `PGLITE_DIR` is ignored
- a lock beside each PGlite directory stops a second process opening it, since two handles
  corrupt the database rather than fail
- `npm run props` always runs demo, on a scratch copy

**All writes to the real database happen inside the real server's process.** Scripts that
need it either stop the server first (the lock insists) or ask the server over HTTP.

**The init file** is JSON with comments, because the questions are the comments. The real
profile copies `config/init.real.template.jsonc` to `data/real/init.jsonc` on first start and
loads it on every start and on demand from Developer → Data. Loading adds and updates, never
deletes, and a file with any problem loads nothing. Every null in it is listed as an open
question on the Data page.

---

## 4. The sync model: a local copy

Three layers:

1. **Raw.** Affinity's responses as they arrived, keyed by `(source, source_id,
   source_updated_at)`, which is the Connector contract's idempotency key.
2. **Translation.** A separate, replayable step from raw into our model. A mapping fix is a
   re-run, not a re-fetch.
3. **The tables the views already read.**

No page ever calls Affinity. The reasons:

- Docs/09 found the binding limit on Scale and Advanced is ~100k requests a month, shared by
  v1 and v2 — about 3,300 a day. The visualizations page alone reads a dozen modules per
  render.
- A local copy can say what changed since the last sync.
- Everything keeps working when Affinity is down or the budget is spent.

**Cadence:** a "Sync now" button and a command first, a background poll later. Each sync
fetches only what changed, using `updatedAt`/`createdAt` as the change clock and never
`sentAt`. A monthly sweep catches deletions and merged records.

**Data Share** (Advanced/Enterprise; Snowflake or Databricks, ~2 h refresh) would be better
for emails and meetings. It needs a warehouse account on our side, which is too big for a
first slice. The connector seam lets it replace polling later without touching the views.

---

## 5. The connector (N39)

- **One client**, `lib/connectors/affinity/`. It sends GET only, to allowlisted paths. It
  tracks the per-minute and monthly budgets from the response headers, backs off when
  limited, and logs each request: path, status, duration, never a body.
- **The key** is read from the environment, which `op run` fills from 1Password. It stays
  server-side and is redacted from every log and error.
- **Test connection** on Developer → Connectors calls `whoami` and reads the rate-limit
  headers. That shows whose key it is, which account, and the real limits, and settles the
  tier question with data instead of memory.
- **List discovery** lists every Affinity list with its size and fields, so the init file's
  list names can be checked and the SPV lists found.

---

## 6. First slice (N40)

- The Neurotech lists' entries, their organizations and people, and the fields on each list.
- Meeting and email metadata only: dates, participants, counts. No bodies.
- Relationship strengths to our team.
- Notes: text for Neurotech (Juan's decision), metadata elsewhere.
- The SPV lists, without notes.

Before running, estimate the request cost from list sizes and show it.

---

## 7. Inventory and gaps (N41)

A generated report in `data/real/reports/`, plus a page:

- counts, and how often each field is filled in
- how pursuits spread across stages, and how many have an owner
- how recent the last interaction is
- duplicates
- a table of Affinity field → our concept, and what does not map

The report is where the second round of questions comes from — which field is stage, which
is amount, whether anything means *signed*.

---

## 8. Translation into our model (N42)

The claims-not-evidence rule, applied:

- Affinity's stage is shown as a labelled claim ("Affinity: Diligence, as of …"). Ladder rungs
  still need evidence. A meeting logged in Affinity becomes *proposed* evidence for "meeting
  held", which a person confirms.
- Amounts come in as soft, unless the init file names a field that means signed. Hard stays
  with the close room.
- Relationship strengths become tier-C edges, which need a person before routing trusts them.
- Every Affinity-sourced field carries the provenance tuple (`source, as_of, confidence,
  last_verified_by`) and links back to the Affinity record.
- A note that mentions health detail is flagged, and the detail is never copied out.

---

## 9. Sources and freshness in the views (N43), then a tour (N44)

The "Seed data · no connector" line becomes a real last-sync time, and every view that shows
an Affinity-sourced figure says where it came from and when.

Then a pass through every view on real data, written up as what breaks, what is useful and
what is missing. Juan files feedback as usual; from the real profile it lands in
`data/real/issues/`.

---

## Out of scope

- **Writing to Affinity.** When it comes, it goes through approval tickets the way SEND and
  STAGE do, with the same fail-closed rule.
- Webhooks. Affinity's are unsigned and carry no interaction events (docs/09), so they would
  only ever be invalidations.
- Data Share, until a warehouse exists.
- Deployment and its secret store.
