# A findings import survives a deploy · 7 Oct 2026

No findings import finished on 7 Oct until mid-afternoon. Six in a row stopped with "Worker stopped without a
completion receipt": each ran 9 to 26 minutes, and a deploy went live every 10 to 20 minutes that day, restarting the
server and the import worker it had started. The pushed files were in place, but the steps after the import (the LP
re-point, the SPV stance and the research ties, which run last and take longest) did not complete.

- **A restart re-queues it.** The recovery that marks a stopped import now queues a findings import again, as the
  token's owner who asked for it. A findings import reads every pushed file again from the start, as each push's
  import already does. The stopped receipt says "A new findings import was queued to read the files again." Other
  kinds still wait for a person.
- **A deploy waits for it.** `/api/health` adds `importing: N` while this server runs N import workers (a count, no
  kind or name), and `scripts/ship.sh --deploy` waits up to an hour (a guess) for it to clear before pushing.

Checks: `npx tsc --noEmit`, `npm run boundaries`, and the import-jobs properties on PGlite and Postgres, with two
new cases: a replayed kind is queued again with that receipt, and any other kind waits. Two deploy-tooling cases cover
the health count and the wait in ship.sh.
