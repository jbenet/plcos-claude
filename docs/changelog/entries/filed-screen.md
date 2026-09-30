## Feedback — the filed screen is back: file several in a row

Juan, 29 Sep 2026: "the filing multiple issues in a row screen went away." It went on 27 Sep with the
feedback journal (ac26ce7), when File started closing the box at once so nothing waited on the
server. It is back, on top of the journal: File still returns at once, and the box stays open on a
filed screen.

- **Filed as issue N**, with *Give more feedback* (⌘/Ctrl+↵), *Open the issue* and *Close* (esc).
  Give more feedback opens a fresh box on the same page, with a new automatic screenshot.
- **Filed while this was open** lists every report from this sitting with its number once filing
  ends. Until then a report's row says where it is — sending, saved on the server, or kept in this
  browser with the server's reason — and the box can be closed at any point: the outbox still sends it.
- `scripts/feedback-regression.ts` had not run clean since the journal: its stand-in server replies
  predated it, and two checks expected the draft, not the outbox, to keep an unanswered report. Both
  are updated, and a check files two reports in a row. 14 of 14 pass.

![The filed screen after two reports in a row (invented reports)](docs/changelog/shots/filed-screen/01-filed-batch.webp)
