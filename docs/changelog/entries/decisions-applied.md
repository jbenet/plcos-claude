## Identity review — apply later decisions without removing history

An applied person-to-organization correction no longer conflicts with a later merge for the
same group. The apply step checks persisted receipts before comparing unapplied proposals,
including receipts retained after reversals. Exact retries still make no changes.

A later proposal for an expanded group supersedes an older unapplied proposal when the full
group membership is provable and the later selection covers the older selection. The report
shows the superseded count and both line numbers separately from refusals. Unapplied conflicting
decisions for the same group remain refused. The decisions file is never rewritten.

Validation: invented-data properties cover applied retype followed by merge, retries,
superseded older merge and two unapplied conflicting decisions. Checks: `npx tsc --noEmit`,
`npm run boundaries`, `npm run props`.

Integrator: capture the updated decision report on the demo server at merge; no screenshot
was taken in this sandbox.
