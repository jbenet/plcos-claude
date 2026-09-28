# Strategic value: a column and a filter on Selection (issue 0120)

| | |
|---|---|
| ![Selection on SPV — Cortex, sorted by the Strategic column, with the reasons for the LP in focus](docs/changelog/shots/strategic-0120/01-selection-strategic-column.webp) | Selection on an SPV, sorted by Strategic: high, some, unknown, none, each marked *derived* or *assessed*; the reasons for the LP in focus sit beside the list. |
| ![Selection on PLC Neurotech I filtered to High or some](docs/changelog/shots/strategic-0120/02-fund-high-or-some.webp) | On a fund, filtered to "High or some": here the levels come from people's "Beyond capital" grades in Fit & standing. |

Juan, 28 Sep 2026: "Add a filter (or sort col) for 'strategic', which renders the list in terms of how
useful the investor would be for this vehicle (for SPV: this one company, for funds: the fund as a
whole). This lets me pick potentially smaller checks but that would be worth a lot for the co."

**The level.** Each LP on each vehicle gets one of *high*, *some*, *none* or *unknown*, computed on the
server with the list (`modules/strategy/strategic-rules.ts`, read by `lib/pipeline-data.ts`). It is a
separate lens: it never enters the score, and the score's order is unchanged by it. From, in order:

1. **A person's grade.** The fit assessment's "Beyond capital" dimension for this LP and vehicle: strong
   is high, good is some, neutral or weak is none. It wins, as a person's SPV setting does; what the
   records say is listed beneath it.
2. **Research text that ties them to the vehicle.** On an SPV, a fact or profile naming its company
   (the vehicle's name without "SPV") counts double. Otherwise one point each for a role or board seat
   in the field (operating), an investment in it (portfolio, including the SPV stance's own quote), and a
   stated interest (expertise). The field's words are per vehicle in `config.strategic.domains`, marked
   GUESS; a word must start a word ("neuro*" is neuroscience, never "euro"; "neural" is left out).
3. **The sourcing judgement:** a prospect row marked `strategic`, with its reason.
4. **The vehicle's W5 strategy:** affinity read high, or an ask of advice, introductions or co-investing.

Two points, or a tie to the company, read high; one reads some. With none, a judgement against — a
researched prospect row not marked strategic, or a strategy reading affinity low — reads none; anything
else is **unknown**, not none (rule 7). The reasons, up to three, each dated where the record is.

**The page.** A sortable Strategic column beside Check size on Selection, with *derived*, *assessed* or
*no evidence* under the level and the reasons in its title; sorting puts high first and orders by score
within a level. A Strategic filter (Any, High or some, High, Some, None, Unknown) on Selection and on
Pipeline, kept in the address. The panel for the LP in focus shows the level, "not part of the score",
and its reasons. To make room, Met and Last touch now give way below a 920 px list (they are in the
panel), Routes below 760 and Stage below 600.

**Demo.** Invented inputs on SPV — Cortex (`lib/seed-strategic.ts`): a board seat at Cortex, a
neurosurgeon principal who writes about brain-computer interfaces, a prospect row marked strategic, one
sourced and not marked. **Properties** (`scripts/properties/strategic.ts`): unknown without evidence;
the company tie; one kind of tie once; word starts; sourcing and the strategy; a person's grade wins;
per vehicle; sort and filter; and the scores unchanged when strategic evidence lands.
