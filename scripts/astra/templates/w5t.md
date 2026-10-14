{{common}}

Task: W5 1.13 tightening pass. Shorten the strategies of the LPs in {{data}}/enrich/batches/{{batch}}.txt (one key a
line) so each fits the caps. Juan, 11 Oct 2026: "summarize strategies / make them fit with new model".

This pass works from local files only: no web search, no fetching. Read only what is listed here, which replaces the
read set in the header and in the protocol (Juan, 12 Oct: keep these runs cheap):
- once: the sections "Tight (1.12, enforced from 1.13)" and "The next step" of {{repo}}/docs/workflows/w5-strategy.md
  (open just those sections, e.g. with sed, not the whole protocol);
- per LP: its strategy files, in either layout: {{data}}/enrich/strategy/<key>.json and
  {{data}}/enrich/strategy/<vehicle-slug>/<key>.json; its finding {{data}}/enrich/raw/<key>.json; and its own line of
  {{data}}/enrich/candidates.jsonl, pulled with grep or jq. Never open a whole .jsonl file.
Read nothing else unless a strategy contradicts its finding or candidates line; then read only that LP's lines of
connections.jsonl and triage.jsonl.

For each key, rewrite every strategy file of that LP written before version 1.13. Leave files already at 1.13 or
later alone.

- Keep the plan: the same vehicle, ask, route, next step, list and facts, unless the LP's candidates line shows it is
  out of date (a status, stage or owner that moved); then fix just that, from the record.
- Cut words, not substance. One sentence of angle; one action in next.what; risks and open questions as short chips,
  the one that matters most first. Say each fact once, in the field it belongs to. Never add a claim the record
  doesn't carry. Keep the existing date formats.
- Set made.version to "1.13" and made.at to now; re-pin made.inputs to what you read; add
  { at, by: "astra", rule: "1.13 tighten" } to made.revised. Keep firstMessage unless it repeats the analysis; if
  you keep it, it must still match the strategy.
- A firm's colleagues come together in the batch: rewrite the lead first, then its colleagues against it.
- A date that has passed: a park whose look-again (or, without one, its step date) is past is re-dated by the
  protocol's `--lapsed` rule (the rule dates, noted in made.revised); a step that is not a park keeps its date and
  stays overdue, since a person owes it. Never move a date to hide that it passed.

Review your own work before the check: re-read each file you wrote against the caps and the no-repeats rule, and
against its old version for any plan or fact that changed without a record behind it. Fix what you find. Then run
enrich-check once; fix only what it reports for your keys and run it once more at most.

Done when every listed strategy is at 1.13 and enrich-check accepts it (no `too long:` problems for your keys).
Final message: counts only (LPs, strategy files rewritten, left alone and why, fixes from your review, checker
problems).
