# Development details and deferred decisions

Rules moved from AGENTS.md. Read this file when its scope applies; all rules still hold.

## The five seams

Every external dependency sits behind one of these, each with a local implementation from
L1. This is what makes the whole product runnable with no cloud and no SaaS account.

```ts
Db            // PGlite locally, Postgres in the live version
Connector<T>  // backfill / poll / onWebhook / normalize — all stubbed locally
AuthProvider  // local user switcher now, PL LabOS kit later
IssueSink     // markdown files now, GitHub issues later
Agent         // no-op locally unless an API key is present
```

## Deferred decisions live in one file

```ts
// config/deployment.ts
export const config = {
  affinity:  { tier: null as 'scale'|'advanced'|'enterprise'|null,
               syncMode: 'deferred' as 'deferred'|'poll'|'dataShare' },
  warehouse: { enabled: false, canonMode: 'inProcess' as 'inProcess'|'warehouse' },
  issues:    { provider: 'file' as 'file'|'linear'|'github' },
  auth:      { provider: 'local' as 'local'|'labos' },
  guard:     { asksPerRelationshipPerQuarter: 1,
               asksPerConnectorPerQuarter: 3,        // GUESS — replace with real data
               conflictWindowDays: 14 },             // GUESS
  scoring:   { weights: { capacity: .25, affinity: .30,
                          propensity: .25, timeToDecision: .20 } },
  agents:    { correctionBudgetHoursPerWeek: 12 },   // GUESS — circuit breaker threshold
};
```

Every constant marked GUESS came from an unverified source. None should survive two weeks
of real data. Do not scatter these values through the codebase.

---

## Build sequence

L1 through L13, ~53 engineer-days. **`docs/13-synthesis-r3.md` §4 has the full table with
what lands at each stage.** Core is L1–L8 (34d), Depth is L9–L13 (19d).

**L1 is the first build:** console shell, PGlite, user switcher, feedback box, markdown
issues, the issues page, seed data. Nothing else. ~4 days.

If time gets short, trim in this order: L10 signals, then L9 scoring, then L13 to a stub.
**Do not trim L3 or L4** — two independent design reviews both found the plan thinnest
there.

---

## Open questions — get answers before the code depends on them

1. **Affinity plan tier.** Data Share (Enterprise) versus poll-first. This one changes the
   connector design, not just the schedule. Measured 23 Sep 2026 by the connection test: the
   account has the 100,000-a-month cap, so it is Scale or Advanced — the API can't tell which,
   and only Advanced has Data Share. Poll-first until someone checks the plan.
2. **Warehouse access.** Own schema with write permission for canon tables?
3. **Linear custom fields.** UNVERIFIED in all three design packages. Check the live
   GraphQL schema before anything depends on it. The integration points the product
   already assumes are written down in `docs/14-linear-integration-points.md`, including
   the outbox (`plays.handoff`) that records what would be sent, and the proposal for a
   dedicated board for observable agent runs.
4. **Integration risk.** One 506(b) SPV among four 506(c) vehicles — a conversation for
   counsel, not a data model.

Sydecar and AngelList API access is gated with a long lead time. Nothing depends on it.

---
