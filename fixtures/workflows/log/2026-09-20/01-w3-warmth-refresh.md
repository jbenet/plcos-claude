# 01 — W3 warmth refresh, stopped and rerun

Runs: `00000000-0000-4000-8000-000000000014` (stopped) and `00000000-0000-4000-8000-000000000015` (rerun). Invented demo note.

Hypothesis: a refresh over frozen inputs reproduces the previous ties exactly, plus the new meetings.

The first run stopped: an input changed while it ran, and the check refused to write. The rerun, on a new freeze, wrote 47 ties.

Learned: freeze before, check after; a changed input is a stop, not a warning.
