## perf3 — Bounded reads and an available feedback box

Everyone now pages through 100 records at a time. Routes load affiliations for their pipeline and selected target; network previews disclose their bounds. Indexed queries and aggregate counts replace repeated broad scans. Pending page loads share work, database jobs expire after 20 seconds in the queue, and feedback writes its issue file before optional database context.

All 55 measured pages pass the 10-second cold and 3-second warm budgets on an isolated copy. Everyone and targeted routes also pass the stricter 2-second warm target. Type checking, boundaries, and all 376 properties pass. See [the measurements and limitations](docs/perf/2026-09-26-perf3.md).

Demo HTTP smoke checks passed. Screenshots were unavailable because the sandbox refused browser launch; no real-data images were captured.
