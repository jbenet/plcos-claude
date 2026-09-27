## Feedback journal — File never waits on the server

Juan, 27 Sep: "Site keeps getting pegged/can't submit feedback. Maybe need a journaled thing for
feedback, so I can enter it safely and quickly while the db is locked or rebooting." The live
server is one Node process. During a big import its event loop is busy for minutes, or it restarts.
The server already wrote the issue file before touching the database, but the feedback box's POST
had to reach it first. When it hung or failed, the report was only a draft in the box.

**Save on File.** Pressing File puts the report into this browser's outbox (`lib/feedback-outbox.ts`)
and closes the box right away. The outbox keeps the text, the screenshots and dropped images, the
captured context and a client id. It uses IndexedDB, with one record per report. If IndexedDB is
unavailable or never opens (it gives up after 2 s), the words go to localStorage without the
pictures, and the entry says so. Every access is wrapped. The client id comes from
`lib/request-key.ts`, so plain http works. The draft is dropped only once the outbox has the report.

**Background sending.** A sender posts each entry with an 8 s timeout. After a failed send it waits
5 s, 15 s, 60 s, then every 2 minutes (GUESS constants in `lib/feedback-journal.ts`). It also tries
again at once:

- when the page loads;
- on `online`;
- when the tab becomes visible, or a page is restored from the back-forward cache;
- when any request to the app succeeds (a watched `window.fetch`).

An entry is removed only when a 2xx response names an issue number and echoes the entry's client
id. A 4xx means the server refused it. That entry waits for Retry now instead of the clock. Tabs
tell each other about changes over a BroadcastChannel.

**Idempotency.** `/api/feedback` accepts `clientId`, a plain id of 8–64 letters, digits and
hyphens; anything else is refused. The file sink writes it into the issue frontmatter as
`client_id:`. The writer keeps that line through status changes. Before filing, the sink looks for
the id. On a repeat it returns the existing issue, marked `repeat`, and `fileFeedback` skips the
database row and the audit entry. Creates now run one at a time per folder. This lets a resend
that races the first write find it, and stops two concurrent reports from taking the same number.

**Visible state.** A quiet line in the rail's footer shows what is happening. Just after File it
says "Saved. Filing…". While reports wait it says "2 notes waiting to file". For 8 seconds after
one files it says "Filed as issue 0123". At zero it disappears. At phone widths the same line sits
in the top bar in fewer words. It opens a list with each report's state, its last error, its try
count and when it will try next. Each report has Retry now, Copy text and Discard (Discard asks
first). Copy text falls back to a selection copy because the clipboard API needs https.

**Connection feedback.** The connection-feedback form uses the same outbox. Save clears the box at
once, and the line under it follows the note's progress. Its route already deduplicated on the
note id. Two faults had made the form unusable, and both are fixed:

- It fetched a Dakota policy from GET `/api/feedback`. That handler went in merge 7bf581f when the
  Dakota refusal came off filing, so the form always showed "Feedback policy is unavailable". The
  form no longer asks.
- The route compared the browser's Origin with the URL Next passes to the route (the bound
  address), so every note from a browser was refused. It now compares against the Host header.

Checked on a demo server (a temporary live row in `.ports.json` so it would file, since reverted),
with Playwright in Chromium:

- The box closes 40–90 ms after File.
- With the server frozen for 60 s (SIGSTOP), the report filed once, a second after the server
  resumed.
- With the server killed mid-file and restarted, it filed once.
- Two reports survived a reload with sends blocked and filed together after one Retry now.
- Three concurrent resends of one client id plus a fourth got one issue; a path-like id got a 400.
- Connection notes saved on their own once their route came back.

All of this was checked at 1180×820 with touch and at 390×844.

New properties (`scripts/properties/feedback-journal.ts`, 7) cover:

- the backoff schedule, directly and through `settle`;
- removal only on a confirmed id, over 3,489 invented responses;
- 4xx refusals versus retries;
- connection receipts;
- dedupe by client id, sequential, concurrent and after a status change;
- client-id validation.

Not verified: Safari. Older WebKit can leave `indexedDB.open` pending or drop connections after a
long background stretch. The outbox opens a connection per operation and falls back to
localStorage after 2 s, but no Safari was available to test it here.
