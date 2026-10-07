## New feedback wakes project dev — 7 Oct 2026

Juan asked for feedback to reach development without anything polling. After the feedback box files an
issue, the server now waits for the box to go quiet (90 s), then fires one Claude Code routine, at most once
every 10 minutes, which wakes the project's feedback thread (docs/deploy/07-feedback-signal.md). A failed
fire keeps the ids and retries with backoff; the queue survives a restart.

The signal carries issue numbers and a signed read link, never the issue's words.
`GET /api/feedback/signal?ids=…&exp=…&sig=…` returns only the issues it names and their own attachments,
for three days; it answers 404 while the signal is off. Two new settings in Settings → Connections →
Tokens, **Feedback signal URL** and **Feedback signal token** (`FEEDBACK_SIGNAL_URL`,
`FEEDBACK_SIGNAL_TOKEN`), turn it on; unset, nothing is sent. The Mac app signals the same way and names its
folder instead of a link.

Validation: TypeScript, boundaries and the property suite on invented data; eight new properties cover the
off state, burst coalescing, the gap, retry and backoff, link tampering and expiry, the Mac text, the
settings' validation and the read route's scoping.
