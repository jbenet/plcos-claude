{{common}}

Task: W5 1.13 tightening pass. Shorten the strategies of the LPs in {{data}}/enrich/batches/{{batch}}.txt (one key a
line) so each fits the caps in "Tight (1.12, enforced from 1.13)" of {{repo}}/docs/workflows/w5-strategy.md, and
follow that protocol for everything else. Juan, 11 Oct 2026: "summarize strategies / make them fit with new model".

For each key, rewrite every strategy file of that LP written before version 1.13, in either layout:
{{data}}/enrich/strategy/<key>.json and {{data}}/enrich/strategy/<vehicle-slug>/<key>.json. Leave files already at
1.13 or later alone.

- Keep the plan: the same vehicle, ask, route, next step, list and facts, unless the LP's current records (re-read
  per the protocol's Inputs) show it is out of date; then rewrite it from those records as the protocol says.
- Cut words, not substance. One sentence of angle; one action in next.what; risks and open questions as short chips,
  the one that matters most first. Say each fact once, in the field it belongs to. Never add a claim the record
  doesn't carry.
- Set made.version to "1.13" and made.at to now; re-pin made.inputs to what you read; add
  { at, by: "astra", rule: "1.13 tighten" } to made.revised. Keep firstMessage unless it repeats the analysis; if
  you keep it, it must still match the strategy.
- A firm's colleagues come together in the batch: rewrite the lead first, then its colleagues against it.

Examples of finished strategies for shape and tone: {{strategyExamples}}.

Done when every listed strategy is at 1.13 and enrich-check accepts it (no `too long:` problems for your keys).
Final message: counts only (LPs, strategy files rewritten, left alone and why, checker problems).
