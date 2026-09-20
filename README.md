# Capital OS

Fundraising strategy and operations across PLC Neurotech I, PLC Crypto/Rails, the SPVs and
the grants rail.

**L1 through L13 are built**, plus the compliance registry and the answer library that the
plan left as later work. It runs locally with no cloud, no SaaS account and no services:
`npm run dev` migrates, seeds and serves.

```bash
npm install && npm run dev     # :3000
```

## Where to start

| | |
|---|---|
| **`CLAUDE.md`** | The handoff. Stack, the five seams, the twelve non-negotiable domain rules, the frontend contract, and an explicit do-not-build list. Read this first. |
| **`CHANGELOG.md`** | What landed at each stage, with screenshots, and where I disagreed with the plan. |
| **`docs/13-synthesis-r3.md`** | The plan. Module map, build sequence, and what was deliberately refused. |
| **`/system`** in the running app | Which seam is running which implementation, and every constant that is still a guess. |
| **`design/index.html`** | The visual spec. `S1`–`S3` are the direction the shell follows. |

## Commands

```bash
npm run dev          # migrate, seed if empty, serve
npm run build        # production build — 32 routes
npm run check        # tsc --noEmit
npm run props        # the properties harness: 34 domain rules and perturbations
npm run boundaries   # no db driver outside lib/db; modules imported through index.ts
npm run db:reset     # drop local/, rebuild, reseed. Issues are files and survive it.
npm run shots -- L7  # changelog screenshots against a running dev server
npm run changelog:page out/       # the build log as a standalone page + resized screenshots
```

The changelog is also readable inside the app at **Developer → Changelog**, rendered from
`CHANGELOG.md` with its screenshots so it cannot drift from the repository. Both renderings
show **newest first**; the file itself stays chronological and append-only, so a new entry
is a clean append rather than an insert.

`npm run props` is the one to run after any change. It asserts the rules this system exists
to keep — soft never blends into hard, a tier-D edge nobody reviewed cannot carry a route,
the consent ladder has no gaps, a self-certified subscriber cannot harden under 506(c) —
and it runs four perturbations that check the rules still hold when the world changes.

## The five seams

Every external dependency sits behind one of these, each with a local implementation and a
second implementation that refuses with a sentence rather than falling back silently.

| Seam | Now | Later |
|---|---|---|
| `Db` | PGlite on disk | Postgres — the swap is a connection string |
| `AuthProvider` | local user switcher | PL LabOS kit (D1) |
| `IssueSink` | `issues/NNNN-slug.md` | `GitHubIssueSink` (D2) |
| `Connector<T>` | fixture, used by the signals ingest | Affinity, Linear, Drive, DocSend |
| `Agent` | stub that refuses by name | the L13 runtime with a live model |

`npm run boundaries` enforces that no database driver is imported outside `lib/db/`, and
that modules are imported through their `index.ts` — or `client.ts`, which carries types
and constants only, so a `'use client'` component cannot drag `node:fs` into the browser.

## What is in here

Sixteen Postgres schemas, one per module, migrated in manifest order:

```
platform      users, vehicles, feedback, audit log, sync state
identity      entities, source records, match assertions
research      claims with the provenance tuple, source docs, notes, cache vs snapshot
governance    approval tickets — the gate in front of five families of mutation
coordination  the ask log, four guards, conflict cases, restrictions
network       relationship edges with A–D evidence tiers
strategy      pursuits and the six-rung consent ladder
pipeline      exposure on two tracks, the conserved capital pool
calendar      sprints, holidays, the December dead zone
close         fund close room and SPV war room
scoring       the four-dimension rubric with editable weights
signals       external change detection, on fixtures
meetings      meetings, objections, diligence questions
content       canonical assets, audience variants, the wrong-wrap matrix
grants        the no-unsolicited gate
agents        work envelopes, pinned runs, the protected eval set
compliance    accreditation, public claims, solicitation log, side letters
library       approved answers with their own versioning
```

## Layout

```
CLAUDE.md          the handoff — decisions, rules, what not to build
CHANGELOG.md       what landed at each stage, with screenshots
config/            deployment.ts — every deferred decision and every labelled guess
lib/               the five seams, plus seed, session, money and time helpers
modules/           schema-per-module: migrations, types, repo, service, index, client
app/               Next.js routes
components/        shell, and the components that carry a discipline
fixtures/          seed data, including the S01–S11 source corpus
issues/            markdown issues; the in-app feedback box writes here
scripts/           reset · seed · props · shots · boundaries
docs/              13 research and design documents, plus changelog screenshots
design/            33 UI boards; S1–S3 are the direction
```

## Open questions, unchanged

1. **Affinity plan tier** — Data Share versus poll-first. Changes the connector design.
2. **Warehouse access** — own schema with write permission for canon tables?
3. **Linear custom fields** — UNVERIFIED in all three design packages.
4. **Integration risk** — one 506(b) SPV among four 506(c) vehicles. A conversation for
   counsel. The compliance registry now models the difference; it does not resolve it.

And one the build added: `guard.asksPerRelationshipPerQuarter` is under-specified as well
as unverified. One ask per relationship per quarter *across all four vehicles* makes the
conflict case nearly redundant. It is probably meant per vehicle.
