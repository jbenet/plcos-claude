# Lapsed parks look again by rule · 7 Oct 2026

After PR #33 the checker counted 1,502 strategies whose next step's date had passed, against 995 stale. Most were
sourcing-stage parks from the 27 Sep to 2 Oct passes ("park him until the search pass, look again by Fri 3 Oct"),
which owe a person nothing. `scripts/enrich-look-again.ts --lapsed` re-dates a park whose look-again or step date
has passed to the rule's next date (4 Jan 2027 for the 2027 list), recorded in `made.revised` without moving
`made.at`. `--skip` takes the stale list, so an LP with something new is rewritten rather than re-dated. A step that
is not a park keeps its date and stays in the overdue count.

The script now also reads strategies in vehicle folders; before, it read only the top level, so it missed every
strategy written since the folders came in.
