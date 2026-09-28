# Feedback reporters and the decision log

Feedback filing now resolves the journal's local user selector against active
`platform.app_user` rows before writing the issue. The same resolver serves local
auth: a valid selected user wins, otherwise the first active user is used. The
reporter and its verification context are written from that resolved row, never
from a request-body identity. `unknown` is used only when a successful lookup finds
no active user. A lookup error keeps the durable journal pending for retry.

POST still journals and returns 202 without waiting on the database. Issue numbering
now waits for reporter resolution; database metadata and audit remain best effort
after the file receipt. Connection notes share the resolver. The old deferred,
unverified reporter input to `fileFeedback` has been removed.

`docs/decisions/` contains 21 curated decisions from dated Juan quotes in the
repository's own docs. Each records date, who, quote, source, scope and supersedes;
the README describes how to add and supersede entries. The seed excludes real
data, issue files, memory files and quotes naming LPs or non-team people. It makes
no claim to cover the deployment plan's broader count of 123 quotes.

Run `node --import tsx scripts/decisions-index.ts` (or add `--json`) to list and
validate the log. All 21 quotes were checked against their source text, allowing
only whitespace normalization.

Validation: four new reporter properties cover selector resolution and forged
context, retry after lookup failure, consistent issue/receipt/audit identity, and
the no-active-user fallback. The focused feedback suite passes 17/17; the full
PGlite suite passes 1012/1012 (four added). TypeScript and boundaries pass.
The requested Postgres command was attempted against
`postgres://plcos@127.0.0.1:5434/plcos_test_feedback_reporter`, but the sandbox
refused the connection with `EPERM` before any properties ran (zero executed).
Claude must run that backend suite outside this network-restricted sandbox before
integrating.

Claude on live: integrate and restart the app; no migration or data job is needed.
Existing issue files are not backfilled: historical identity must not be guessed.
No real data was read or changed in this work.
