## Selection 0109 — a smaller main button, and the other actions back

Issue 0109, a follow-up to 0104 on an SPV's Selection page. Juan liked the clearer button but found
it too big, and missed the actions that had disappeared from the panel.

| | |
|---|---|
| ![Selection's one panel: heading, Move to Selected, links and the earlier actions](docs/changelog/shots/selection-0109/01-one-panel.webp) | The one card: heading, the smaller Move to Selected button, the four links, and the earlier actions (Set status, Touchpoint, Context, Research, Connections, Strategy, Feedback). |

**One panel for what to do.** At the top of the side panel, one card now holds:
- **Heading:** the LP in focus, with its other name, status and owner, or "N ticked" with Clear.
- **Move to Selected:** the app's black primary style, full width and the height of a normal
  button (44 px on touch screens). The `s` and `u` keys and the Undo toast work as before.
- **Links** for the LP in focus: LP page, Strategy, Fit & standing, and Routes.
- **The earlier actions:** Set status, Touchpoint, Context, Research, Connections, Strategy and
  Feedback. Before, they appeared only once something was ticked; now they act on the LP in focus
  too. Set status starts on "Choose…" instead of Selected, because Selected has its own button.
  The note stays optional, and Passed still needs who ended it and why.

The reasons card below it no longer repeats the links or the tick button. On a narrow screen the
card sits under the LP in focus, as before. The organisation grouping from 0105 is unchanged: the
panel acts on the LP in focus or on everyone ticked, including people ticked through their
organisation's row.

No owner-change action was added. No page in the app has one, so the panel shows the owner and
does not change it.

**Checked** on the demo, with `crypto.randomUUID` removed as on plain http:
- PLC Neurotech I and SPV Cortex, at 1440×900 and at 1180×820 with touch;
- move one, move several, undo each, and Passed with who and why;
- the four links load, a grouped organisation row is shown, and there are no console errors.

Also viewed at 390 px wide.
