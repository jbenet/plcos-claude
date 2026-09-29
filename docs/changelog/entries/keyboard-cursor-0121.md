## Selection and Pipeline — a keyboard cursor that keeps up (issue 0121)

Juan reported five things about the keyboard cursor on Selection. Selection and Pipeline now use
one shared cursor, `components/strategy/row-cursor.ts`, so each fix applies to both pages.

- **A click or a tap moves the cursor.** Ticking a row's box used to leave the cursor where it
  was. Now a tick, or a click or tap anywhere in the row except a link or button, puts the cursor
  on that row. ↑ and ↓ go on from there.
- **The cursor stays in place after Move to Selected.** When the row in focus leaves the list,
  the cursor goes to the next row still listed (or the one before it, at the end). Before, a bulk
  move sent it back to the top. Changing the search, a filter, a status or the sort still starts
  from the top.
- **The page scrolls ahead of the cursor.** The cursor is kept 15% of the screen away from the top
  and bottom edge (a guess from Juan's "10–20%"), so the next rows are visible before the cursor
  gets there. Before, the page scrolled only when the cursor reached the edge. The scroll is
  worked out by hand after each move, not with `scrollIntoView`.
- **Each move is cheap.** The rows are memoised and stop being rebuilt on each move. Each row
  reads from a small store whether it holds the cursor, so a move re-renders two rows. Before,
  every visible row re-rendered, because `pick` and the jump handler were new functions on every
  render. The reasons panel follows at a lower priority and reads the server once the cursor has
  rested for 150 ms. Before, it read the server on every key repeat, and Next runs server actions
  one at a time, so those reads queued. The `lp=` address update waits until the cursor rests.
- **Releasing the key stops the cursor.** The cursor makes at most one move per frame. A key
  repeat that was generated before the last move reached the screen is dropped, so repeats no
  longer build up in a queue.

Measured on the demo with 300 invented extra LPs, 240 rows on screen, at 1366×892 in Chromium
(dev server), holding ↓ for 1 s at a 30 ms repeat:

| | Before | After |
| --- | ---: | ---: |
| Keypress to paint, median | 36 ms | 16 ms |
| Same, with the CPU slowed 4× | 483 ms | 61 ms |
| Moves after release, 4× slower CPU | 33, the last 6.4 s after | 0–2 already in progress, the last within 50 ms |

`npm run e2e` has two new checks: a tick moves the cursor and a bulk move keeps its place, and a
held ↓ (with the CPU slowed 4×) makes no moves after release. Both fail on the old code.
Points 1–3 also pass in Playwright WebKit. Safari on an iPad was not tested.
