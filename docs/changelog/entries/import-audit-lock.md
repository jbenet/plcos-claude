# Pushes and API calls no longer time out while an import runs; identity reviews carry email domains · 7 Oct 2026

**The audit lock.** On the night of 7 Oct, every push the Mac sent while a findings import ran failed with "statement
timeout" (57014) at its record stage, and the server logged "[sync] audit failed" twenty seconds before each. The
findings import consolidates duplicate pursuits inside its one long transaction, and that step locked
`platform.audit_log` in share row exclusive mode, so every audit insert in the app (sync pushes, MCP and outreach
calls, people's own actions) waited until the import committed, then hit the 20 s statement timeout. The files had
landed, but each push answered 500. The merge no longer locks the audit log: the audit rows it reads are people's
status changes, and every writer of one updates `strategy.pursuit` first, which the merge still locks. A new
Postgres property opens a merge transaction and appends an audit row from another connection under a 2 s lock timeout.

**Email domains in the identity review.** W13 left most same-name pairs unresolved because the 22 Sep Affinity person
had nothing to compare. `identity-review.jsonl` members now carry `emailDomains`: the domains (never a local part) of
the addresses on Affinity's own person record and on research claims not sourced from Dakota.
