# Strategy 0065 / 0082 — the vehicle strategy page, redesigned

Juan asked for a strategy page that says where the raise stands and what to do next (0065), with a
compact "So next", a better LP table, and a large menu of whole-raise moves ranked with LP actions
(0082: "maybe you take a stab — your designs tend to be better"). Tonight's data and logic stay as
they were: strategies scoped to the right vehicle, the move records with their import, audited
choose/dismiss/reorder decisions, and one ranking by GUESS capital per team hour. The page itself is
redone in the house look (Today's cards, the diagnosis box, compact list tables).

- **Headline and cards.** A sentence headline from the records ("$X to go. $Y soft to convert."), then
  Today's four cards: hard (green, with cash as a separate state), soft (hatched, "never added to
  hard"), gap to target (hard only), active pipeline. Hard and soft never share a number.
- **Where we stand.** The diagnosis box, four short paragraphs, each resting on a record lower on the
  page: money, pipeline and recorded stage exits (largest samples first, never ranked on a thin one),
  the two largest gaps as links that filter the LP table, and the top option with how many LP actions
  can be scored at all and what an LP action needs to be scored.
- **So next.** Ten options on one scale, one compact row each: kind tag (an LP action or the move's
  category), title with one line of what it means, GUESS capital, team hours and GUESS $ per team hour
  with a bar sized against the largest. A move's row opens it in the menu.
- **Pipeline and conversion / Gaps and risks,** side by side: status counts with bars and recorded
  exits moving forward; this week's changes folded into one line; every coverage gap a link that
  filters the table.
- **Menu of moves.** Chips for the kinds of work Juan named (convert and close, materials, public
  presence, events, source and enrich), each with its count; a kind with nothing estimated shows at
  zero, so a hole in the option space is visible. Sortable compact rows that open in place: what the
  move is, audience and dependencies; every GUESS input with its basis and the arithmetic written
  out; evidence with source, date, confidence and verifier; and the decision form, which keeps its
  receipt on screen after the server records it.
- **LPs by next action.** One-line rows (risk count, action clipped to a line), sortable, filterable,
  `/` to search, and a row that opens on a tap into three columns: the action, angle, plan and risks;
  the score's inputs with the formula; the evidence work behind the points. Columns give way by the
  card's width (container queries), not the window's, so an iPad with the detail pane open keeps the
  name, the action and the score.
- **Speed.** Rows travel packed: repeated text once in a table, coverage views as a bitmask, links as
  a shared prefix. On a real-scale copy (about two thousand pursuits) the page's HTML fell from 4.4 MB
  to 2.2 MB; search updates within a frame of typing. Three new properties check that packing is
  exact, that it saves space, and that a link outside the prefix is refused.
- Styles moved to `strategy.module.css` beside the page and the components; tonight's page rules in
  `globals.css` were removed.

Validation: `npx tsc`, `npm run boundaries`, and 457 of 457 properties. Checked in Chromium at
1440×900, 1180×820 and with a narrow card, on the demo and a copy of the real data: search, sort, gap
links, opening a move from So next, and recording a decision on the demo. `time-pages.ts` on the
copy: strategy 1.09 s cold, 1.00 s warm; on the demo 0.26 s warm. At 390 px the app shell keeps its
rail and detail pane, which leaves no room for any page's content; that is the shell's, not this page's.
