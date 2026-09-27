# 0066, second pass — The drawings back, bounded for volume; the clock retired

Juan found tonight's first pass for issue 0066 not good: the visualisations had turned into
count tables and paged record lists. This pass puts the earlier drawings back — the dark floor,
blocks sized by money, the glyph vocabulary, the radar, the three-column network, the fog — and
bounds each one for the volume the raise has now (two thousand pursuits in one vehicle, a
thousand in one owner's Sourcing cell). The first pass's data and logic fixes stay: vehicle
scoping on the board, request-local shared reads, the Vehicle and Rubric band filters, the
filter in the address, the invented-fixture properties.

One rule for crowds, stated on the page: **a group too crowded to draw names the few that most
need a look — blocked, dated soon, then the largest — and counts the rest**; the count opens
them in the list under the drawing, which holds every record.

- **The line.** A cell draws at most five marks; a crowded one names four and ends in a
  "+1,018 more" bar with its needs-evidence count. Tapping it filters the page to that status
  and lane and scrolls to the list.
- **The load.** The four heaviest people get columns and everyone lighter shares one. Each track
  names its four largest and draws the rest as one block of their total; unsized pursuits are a
  count with the exceptions named. A thin bar under each name says which statuses the load sits
  in. Money never adds across vehicles: with several in scope, a track is grouped per vehicle,
  each with its own figure and no column total (the earlier drawing summed them).
- **The strip** now carries the clock's pile: open work with no date on it, by owner and largest
  first, paged. Its off-window columns fit on screen.
- **The clock is retired.** It drew three weeks forward per owner, which the strip's "planned
  next" half already draws per vehicle; at this volume its timeline was almost empty while its
  pile held almost everything. The pile moved to the strip; an old `?view=clock` link opens the
  strip. Fourteen views now.
- **The map.** An empty plane is replaced by a sentence when nothing is scored; a crowded plane
  draws density squares and names the largest cheques. The fog is counted by what we know, who
  holds it and segment, and names the twelve best-connected unscored names to score first. A
  paged list of every name is its list equivalent.
- **The network.** Team, the ten connectors who reach the most pursuits (with how many), and the
  twelve pursuits with the most confirmed lines; the rest are counted. Selecting anyone redraws
  the columns around them. Chips filter by evidence; a paged table lists every connector-to-
  pursuit line with the team member on our side.
- **The radar.** The polar drawing is back; the outer ring is log-scaled from a fortnight to a
  year, dots spread so the named largest don't bunch, and names are drawn only where they don't
  collide. A crowded radar draws counted bubbles per vehicle and ring. The off-radar panel counts
  by owner and names the eight largest; band chips open the list.
- **The coverage** groups pursuits by their pattern of six marks, commonest first; choosing a
  pattern lists exactly those pursuits.
- **The grid** leads with how many LPs have no open lever and can show only those; each cell is a
  button that opens its reason (it was a hover or a disclosure triangle).
- **The flow**'s counts table folds into "the same flow as a table".
- **The calendar**'s drawing is back as the gantt, with each lane capped at six rows — pressing
  things first — and the rest counted at the lane's name. The weekly count table is gone.
- Single-page pagers stay quiet; counts carry thousands separators; SVG trig is rounded so the
  server and the browser agree on coordinates.
- On a narrow main column (an iPad with rail and inspector) the context console stacks under the
  drawing and scrolls into view on a tap, and wide drawings keep a legible size and scroll
  sideways rather than shrinking their text.

New styles live in `components/floor/floor.module.css` and `components/calendar/Gantt.module.css`.
`npm run props` loads CSS modules as a class-name map, so components that use them still render
in the properties; the 0066 properties now cover the load, coverage, strip and the capped gantt
with invented fixtures.

Not verified: iPad Safari itself (checked in Chromium at 1180×820 with touch). At 390 px the
app shell keeps its rail and inspector, which leaves the main column too narrow for any page;
that is the shell's, not this page's.
