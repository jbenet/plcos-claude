# Strategy 0097, rail 0102 — recommendations, utility created, status marks

Juan on the redesigned strategy page (0097): "So much better!", with four asks; and a new order for
the vehicle pages in the rail (0102).

| | |
|---|---|
| ![The vehicle strategy page, with the "What to do" band, the menu of moves and status marks](docs/changelog/shots/strategy-0097/01-what-to-do.webp) | The tinted "What to do" band under the counts, the gaps and risks below it, and status marks (`StatusMark`) beside every status word. |

- **Pipeline and conversion: what to do.** A tinted "What to do" band under the counts, computed from
  the records, at most two sentences. It starts nearest money: harden the soft held by Committed LPs,
  follow up with Discussing, naming the three with the largest supported capacity. Then it widens:
  introductions or replies for a batch of Connecting LPs with a recorded route (20 a week, GUESS), or
  routes for them when none is recorded, and refilling Selected from Selection when Selected is thin.
  With a target it also says how many commitments the gap needs at the mean indication (GUESS) and
  whether the pipeline from Selected to Discussing holds that many.
- **Gaps and risks: what to do.** The gaps that touch LPs from Selected to Committed come first, with
  a verb for each (research, give an owner, run or refresh a route search, write a strategy). The bulk
  gap in New and Sourcing is left to the Selection ranking rather than a bulk push, and small gaps
  away from the pipeline are called fine.
- **Menu of moves: utility created.** Three scores per move: reach (LPs), capital this raise, and
  presence (0–5, drawn as five marks): lasting brand and perception beyond this raise. A move may carry
  its own presence estimate (optional `presence` GUESS in the menu file, validated 0–5 with a basis);
  otherwise its kind's default applies, drawn dashed and said as such. Utility = capital + presence ×
  $10K a point (GUESS, `config.strategyRanking.presencePointValue`), and moves, So next and the queue
  now rank by utility; capital per team hour stays beside it as the efficiency, cash and days as
  constraints. Every opened move writes out capital, utility and efficiency. The move data is JSON
  already, so no migration was needed. The demo fixture gives four invented moves their own presence.
- **LPs by next action.** The filter line has its own styles, matching Pipeline and Selection (the old
  shared ones had been removed, which is why it looked broken), and the unused `TableControls` went.
  Status carries a small mark beside its word everywhere on the page, from a new shared
  `components/ui/StatusMark` (New dashed ring, Sourcing glass, Selected dot, Connecting arrow,
  Discussing speech, Committed green check, Passed slashed ring); the word always stays.
- **Rail (0102).** Portfolio, Visualizations, Funder–vehicle fit, Strategy, Pipeline, Selection,
  Calendar, Warm intro routes, then the rest; WIP pages unchanged.

Validation: `npx tsc`, `npm run boundaries`, and 564 of 564 properties, eight new on invented numbers
(recommendations, utility, presence validation). Checked in Chromium on the demo at 1440×900 and
1180×820: search, sort, gap links, opening a move from So next and recording a decision. Demo page
0.24–0.32 s warm.
