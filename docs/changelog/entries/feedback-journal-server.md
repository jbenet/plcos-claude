## Feedback journal on the server — saved in milliseconds, filed afterwards

Juan, 27 Sep, on the browser-only outbox ([feedback-journal](feedback-journal.md)): "no, it should
journal to the server. the page may die or close forever." He also ruled out a separate journal
process: "no additional servers, mess to deploy". So the journal lives inside the one Next server.

**/api/feedback journals first and answers at once.** It checks the report: words, image types,
sizes, and at most 40 MB of pictures together (a GUESS). It then writes the report as one file,
`<issues dir>/inbox/<clientId>.json`, using a temporary file, fsync, rename, then fsync of the
folder. It answers 202 `{ journaled, clientId }` and awaits nothing else: no database, no auth
lookup, no issue numbering. A client id already journaled or filed writes nothing and says so.
Once filed, the answer carries the issue number. The reporter's handle comes from the user cookie,
now in its own light module (`lib/auth/cookie.ts`). A property walks both feedback routes' static
imports and fails if one reaches `lib/db`, `modules/` or auth.

**Filing happens afterwards** (`lib/feedback-ingest.ts`). An in-process ingester files each
journaled report through the same writer as before, `fileFeedback`, deduped on `client_id`. Only
one pass runs at a time; a kick during a pass asks for one more pass. It runs:

- right after each journal write;
- when the server starts (`instrumentation.ts`);
- every 10 s.

A filed report moves to `inbox/filed/<clientId>.json`, which keeps its issue number but not its
pictures, since those are in `attachments/`. A failure stays in the inbox and is retried. A
connection note that can never be saved (its LP is gone) moves to `inbox/refused/` with the
reason. The issue file is the record. The database row and audit entry now wait for a busy
database as background work, for up to two minutes (a GUESS), instead of 250 ms. The
issue-number lock is now shared across Next's module copies in one process. `issues/inbox/` is
git-ignored for the demo; the real one sits under `data/real/issues/`.

**Client.** File keeps the report in this browser, then posts it with a 3 s timeout (plus 1 s per
MB of pictures). On a 202 the browser copy is dropped and the rail says "Saved on server ·
filing…". GET `/api/feedback?clientId=` reads only the journal, and the rail uses it to show
"Filed as issue 0123". When the server can't be reached, the report stays in the browser outbox
and the rail says "1 note only on this device", in a solid, brighter style marked "!", until the
server accepts it. Small notes use `keepalive`, so closing the tab mid-send doesn't cancel them.
The connection-feedback form works the same way. Its checks of the author and the LP moved to
the ingester. With no user cookie it falls back to the first active user, as the route did.

**Checked on a demo server** (a temporary live row, reverted), with Chromium, at 1180×820 with
touch and at 390×844:

- **Database connection held by a 25 s transaction** (a temporary dev route, not committed): five
  POSTs of one report with a 182 KB screenshot got 202 in 5–28 ms. The journal file was on disk
  at once, the issue was filed 1 s later, and its database row appeared once the hold ended.
- **Tab closed right after the 202:** the issue was filed.
- **Server frozen with SIGSTOP:** the box closed after the 3 s timeout, and the rail showed "1 on
  this device". After SIGCONT the report filed once, about 1 s later.
- **Entry left in the inbox while the server was down:** it filed on restart with no request made.
- **Resends:** every resend, before and after filing, produced one issue.
- **Connection note:** saved on the server in about 100 ms; the note was kept once.

Six new properties, 13 in total for the journal:

- a write is atomic and idempotent under concurrency;
- a half-written temporary is never read as a report;
- ingest files each report once, even after a crash between the issue write and the move;
- a failure stays in the inbox and files on a later pass;
- a report is checked before it is journaled;
- the routes' import chain reaches no database code.

Not verified: Safari's IndexedDB, which is now used only as the fallback.

This route can't help while the whole event loop is frozen: PGlite runs on the main thread, and
heavy import work does too. Astra is fixing those freezes separately. This route never waits on
the database and adds none of that work itself.
