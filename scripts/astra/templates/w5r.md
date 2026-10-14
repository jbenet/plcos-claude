{{common}}

Task: W5 revision. Each LP in {{data}}/enrich/batches/{{batch}}.txt (one key a line) has a strategy that the critic's
gates flag, that was written before W5 1.3, or whose next step runs over 300 characters, or is a colleague at that
LP's firm. Revise each one, following {{repo}}/docs/workflows/w5-strategy.md exactly; run
`cd {{repo}} && DATA_PROFILE=real npx tsx scripts/enrich-check.ts` first to see which gates each key fails, and fix
those. One file per LP and vehicle: revise the strategy where it is (under an alias that
{{data}}/enrich/entity-keys.json maps to the key, or in a vehicle folder {{data}}/enrich/strategy/<vehicle-slug>/) and
write no second one.
Examples of finished strategies for shape and tone: {{strategyExamples}}.

Done when every LP in the batch has a strategy that enrich-check accepts. Final message: counts only (LPs,
strategies revised, skipped and why, checker problems).
