# Network speed 2 — reuse hub indexes and remove worker pacing

Identity resolution yields without sleeping on Postgres and in import workers; the PGlite
server keeps its pacing. Routes reuse a snapshot neighbor index and intersect target tails
with hub neighbors, choosing the cheaper traversal direction. UUID order, parallel ties,
source exclusions and the 300-path/source cap stay identical. No authentication changes.
Open-pursuit-only warm-up already existed; new properties prove its scope and on-demand fallback.

Invented fixture: 5,418 targets, 436,278 topology edges, seven team hubs (~5,292 edges each),
a PL hub (18,003), three intermediary hubs and an irrelevant 780-node connector clique.
The full build adds 43,000 people, 69,000 meetings, 100,000 translated emails, 2,800 findings
and 37,926 research paths; **all 5,418 pursuits are open**. Topology choices are stress-test guesses.

Measured full `buildNetwork({awaitBackground:true})`: **300.628 s (5m 0.6s)**, including
identity resolution and all **5,418/5,418** warm-ups; 516,413 final edges. The graph-building
transaction took 15.884 s. Against the branch baseline (`3f628aa`), all-target enumeration
improved **21.564 s → 18.649 s**; every ordered output matched (1,064,016 paths, 286 empty targets).

Original profiled walker (`8e565d0`): **2.902 s → 0.174 s** on the same 24-target sample,
including the new cold index. Its projected all-target time is **655.2 s**, while all 5,418
optimized searches actually finished in **18.1 s**, including hashing; sampled outputs match.
The fixture reproduces wasted hub expansion, not the live 1.15–2.2 s/target (sample: 0.121 s).
This is invented-data evidence, not a completed real-volume findings import.

Reproduce:

```sh
node --import tsx scripts/network-perf.ts --real-shape
node --import tsx scripts/network-speed-2.ts --baseline-targets=5418
node --import tsx scripts/network-speed-2.ts --baseline-ref=8e565d0
```

Checks: `npx tsc --noEmit`, `npm run boundaries`, `npm run props` (**1,173/1,173**) and
`git diff --check` pass. Properties cover the pacing modes, 216 multigraph cases, shared
hubs, warm-up scope, cached/live candidate equality and cold-target fallback.

Local PGlite worker measurements share the Mac with property checks and other work.
No real data, connectors or live server were accessed. Postgres checks run at merge.
Work envelope: tracked code/invented fixtures; local edits, isolated measurements, checks and
branch commit; this implementation session through handoff; unchanged routes and a sub-ten-minute
invented full build; escalation Juan/Claude. No fetch, pull or push.
