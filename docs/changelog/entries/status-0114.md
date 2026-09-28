# System status as one quiet mark beside the user · issue 0114

| | |
|---|---|
| ![The status mark, a dim dot beside Juan's name in the rail](docs/changelog/shots/status-0114/01-status-mark.webp) | The mark at rest: a dim dot at the right of the user's name, replacing the old per-page Imports card. |
| ![The status panel open, showing Feedback and Imports](docs/changelog/shots/status-0114/02-status-panel-open.webp) | A tap opens the words: Feedback ("Nothing waiting to file") and Imports ("Nothing running"), with links to Developer → Status and Logs. |

**The imports panel is off the pages.** Every page used to open with an "Imports" card listing the
last day's jobs, including four stopped retries of one duplicate merge that a later run had already
answered. Juan: "not good UX for most users; belongs in developer or logs or status… a small
indicator in the bottom left (by the username) that has a tooltip or something."

**One mark beside the user, for imports and feedback both.** The feedback line that said whether a
report was safe (27 Sep) and the import progress now share one small mark at the right of the
user's name in the rail, and in the top bar on a phone. At rest it is a dim dot. It says, most
urgent first:
- a solid **!** when feedback is only on this device and the tab is not yet safe to close;
- a ringed **!** when an import stopped and nobody has looked since;
- a pulsing ring while feedback is saving or an import runs;
- **✓** when feedback is saved on the server or has just been filed.

Its title says the same in words. A tap opens the words: feedback, with "Show the notes" for the
full list (Retry now, Copy text, Discard), and imports, with each running job's step and each
stopped one's reason. Links go to Developer → Status and Logs. Opening it marks a stopped import as
seen in this browser. A stopped import counts only while it is the latest of its kind: a later run
of the same import has answered it.

**Where the full detail lives.** Developer → Status has the imports in full, the earlier ones folded
under "Earlier today". Enrichment, Affinity and Linear, the pages that start imports, show the ones
running or needing a look. A finished import still redraws the page you are on. One poll per tab
serves them all: every 2 s while something runs, every 5 s otherwise (a guess). The "real data,
nothing imported" notice and the breadcrumb's sync line stay: they qualify what the page shows.

**Checks.** New properties: a stopped import needs a look only while it is the latest of its kind,
and the layout draws no import panel while the rail has the one status mark. Checked at 1440×900
and 1180×820 with touch (a 40 px tap target), with a stubbed running import and invented stopped
ones.
