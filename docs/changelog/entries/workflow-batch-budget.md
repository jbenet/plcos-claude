# Leaner batch workflows, and a spend report · 9 Oct 2026

Juan, 9 Oct 2026: "We have to change the workflows or something. we consumed close to half my weekly limit in
one night." The 7–8 Oct W1/W5 night ran 393 runs, about 216M input tokens, 98% of them cache reads. W5 wrote
2,616 strategies for 998 LPs, and 122 LPs were rewritten 7 or more times.

- **Batch budget rules** in `docs/agent-rules/operations.md`. Bulk batches go to ChatGPT (Astra) first, with no
  Claude in the watch loop. Mechanical passes are scripts. Each LP gets one write per change, with keys taken
  from the checker's stale lists and never a whole vehicle list. Batches are small (W1 3–5, W5 5–8, W1c up to
  10). Each night has a Claude cap. The overnight rule no longer asks for 2–4 Claude sub-agents at all times.
- **`scripts/workflow-spend.ts`** reads the ledger and prints, per UTC day, the Claude share of the weekly
  limit (weighted as measured on 25 Sep) and the biggest batch families with cost per LP. It also shows how
  many times each W5 key was written. It exits 2 over `--cap` (default 15%), so a launcher can stop. It prints
  counts only.
- **`docs/codex-headless.md`**: `--skip-git-repo-check` is needed when Codex runs in a plain folder.

Checks: tsc, boundaries and the properties. A new property covers the weighting, the family grouping, the
Claude-only share and the rewrite histogram.
