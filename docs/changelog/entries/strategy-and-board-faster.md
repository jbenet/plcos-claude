# The strategy page, the visualizations board and touchpoints, faster · 8 Oct 2026

Fourth round of the performance pass Juan asked for on 8 Oct 2026. Measured on the same invented copy at the live
scale, on a production build.

- **The strategy page reuses the plan the list already built.** It built the vehicle's whole plan again on every view
  (about 0.47 s on a 3,000-LP vehicle); it now shares the list's cached plan for the same revision. Warm page,
  about 0.6 s → 0.35 s. The plan's route summaries read only the fields shown, built more cheaply in the database
  (161 ms → 47 ms; same summaries on every vehicle compared).
- **The visualizations board counts each LP's ties the cheap way.** It resolved every one of about 5,400 records
  through the merged-identity lookup before counting their ties; now only merged records walk their chain
  (354 ms → 53 ms, same counts). The board step, 0.44 s → 0.1 s.
- **Touchpoints for a list of LPs:** the same change in the query behind the list, the plan and the overview's
  "Lately" (172 ms → 94 ms, same rows). "Lately" also reads each vehicle's touchpoints from the cache the list fills.

Checks: tsc, the properties on PGlite and Postgres. Each rewritten query was compared with the old one on the
invented copy, merged records included: same rows.

## Later the same day

- **After a move, the plan rebuilds sooner.** The route summaries waited for the network's contact signature, which
  every write rebuilds, before reading the stored searches; they now read both side by side and decide afterwards
  which searches are current. A cold plan build, about 0.4 s → 0.32 s; same summaries.
- **The every-vehicle list** reads each vehicle's touchpoints from the cache the vehicle's own list fills, instead of
  reading them all again. Same rows.
- **The stats page** finds each firm's people through the firm's aliases (0.43 s → 0.03 s for that step; same stats
  for every vehicle and for Neurotech).
- **A status move no longer recomputes the network's contact signature.** It was rebuilt over every organisation
  (about 25,000 on the invented copy, about 0.25 s) after every person's write, and every plan waited for it. It now
  checks first whether anything it reads changed: records, aliases and affiliations (the route revision) and pursuit
  contacts with their pursuits (a fingerprint). A list rebuild after a move: about 0.5 s → 0.42 s.
