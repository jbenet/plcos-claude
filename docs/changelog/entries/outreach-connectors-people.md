# Top connectors lists people, says why a score is 0, and plans faster · 7 Oct 2026

JuanMail's Intros screen showed "Amazon Web Services" and PLC Crypto (the fund itself) as introducers, most introducers
scored 0 while reaching 2–11 LPs, and the first call for a vehicle ran out of its 15 s budget after a few dozen LPs.

- **Only people are connectors.** An organisation on a route (a shared employer, the fund) is how two people are
  linked, never someone to ask. It is left out of `top_connectors`, and the first person past it counts as the first
  hop, the one the team emails.
- **A 0 says where it comes from.** A route is never stronger than its weakest hop, and a hop that is affiliation only
  (a shared firm or board, a firm's investment) has warmth 0 of 5, so the route scores 0 while still recommended. Each
  connector now carries `bestWeakestHop` (warmth, kind, label, and whether it is the hop from the team, to the LP or
  between connectors), and each of a connector's targets carries `weakestHop`. The scoring is unchanged.
- **Faster plans.** The plan runs four LPs at a time, and reads the cache revisions, the synced sources, the exposures
  and the blanket restrictions once per plan instead of once per LP: 45 queries per LP became 20 on an invented
  5,418-LP vehicle (`scripts/connectors-perf.ts`). Cached routes are kept per day, so they all went cold at midnight;
  the server now runs the route warm-up when the day changes (`lib/route-day-warm.ts`, `ROUTE_WARM=0` turns it off).
  On invented data a plan with warm routes covers about 45 LPs a second against 15 cold.

**Later the same day (09:40Z):** with imports moving the revision, several background plans ran at once, one per vehicle
and caller, and took the server from pages and pushes (connectors 35 s, a sync push cancelled). Plans now run one at a
time, at the route warm-up's background database priority, and give way to requests between batches.

**Evening:** each connector row carries `intros` — the intro asks made through them, which of those LPs are now
Committed, and the last one with the days to a first meeting — and `POST /contacts` takes a `pursuitId` in place of the
`entityId` (JuanMail).
