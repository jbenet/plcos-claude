# A thin refresh re-pins by rule · 7 Oct 2026

After PR #35, 325 strategies were stale, and 203 of the sourcing ones only because their LP had a newer finding: mostly
thin refreshes from 30 Sep to 7 Oct under canonical keys, which add nothing the strategy hadn't read. Rewriting them
costs a full W5 pass each and changes nothing a person acts on.

`scripts/enrich-repin.ts` takes a list of strategy, newer finding and the finding it was written from. It re-pins
`made.inputs.finding` to the newer date only when `repinBlockers` finds no new fact, investor type or capacity band and
no correction bearing on the strategy, and says so in `made.revised`; `made.at` stays. Everything else is listed with
its reason for a rewrite.
