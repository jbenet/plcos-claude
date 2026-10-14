# The Astra runner, run from Developer → Astra · 10 Oct 2026

Juan, 10 Oct 2026: "should not go through claude, should be able to have a UI and trigger astra automatically."

- **Developer → Astra**: queue W1, W5 or W1+W5 runs for tonight or now, turn on Every night, pause, cancel, and
  watch each run's status and counts. The server stores workflows and counts, never names.
- **`npm run astra`** on the Mac (or `npm run astra:install` as a login item): polls the page every minute, cuts a
  batch, fills a fixed brief, runs ChatGPT's codex, records the ledger run, pushes what passes the checks, reports
  counts back. No Claude session in the loop. See `docs/30-astra-runner.md`.
- **`enrich-batch.ts --max <n>`** writes only the first n batches.
