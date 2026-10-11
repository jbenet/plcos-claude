# Astra shortens the long strategies, Committed back to Selected · 11 Oct 2026

Juan, 11 Oct 2026: "have a workflow go through and summarize strategies / make them fit with new model for the top
LPs in each vehicle ... start further down the pipeline and work way back to selected ones", then "Astra workflow".

- **Shorten strategies (W5)** is a new workflow on Developer → Astra. Each run takes the next LPs whose strategy was
  written before W5 1.13, Committed first, then Discussing, Connecting and Selected, in every vehicle, and rewrites
  them to the 1.13 limits: same plan and facts, fewer words. Colleagues at one firm come together.
- Two Astra runs no longer take the same LPs for strategy work, and strategies written for a second vehicle are
  pushed too.
- The runner tells the server which workflows it knows, so an older copy is never handed this one. Run by the login
  item or the Astra app, an idle runner now updates the live checkout from master by itself and restarts on it.

Notes: `docs/30-astra-runner.md`, `scripts/astra/templates/w5t.md`, `enrich-batch.ts --tighten`.
