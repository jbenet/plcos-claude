## Entity type corrections — issue 0063

Pipeline records imported as people can now be corrected locally to organizations (or back to
people). The correction records the original and effective type, actor, timestamp, reason, rule,
evidence and stable request key. Reversal records its own actor, time and reason. Affinity remains
read-only; its source records are retained. Identity reads and both research export files use the
corrected type, protected against source refreshes by the database.

“Import the findings” runs `rule:org-name-match` before W3 identity checks. It corrects a pipeline
person only when its normalized name exactly matches a known organization or an organization
explicitly named in accepted findings or W3 paths, and available identity sources contain no email,
title or personal LinkedIn. Multiple organization identities, person evidence and prior local
decisions are reported without a change. Reversing the rule prevents its reapplication. No
name-only merges are introduced; existing canonical redirects remain intact and W3 reads them.
Developer → Enrichment shows the last import's correction and ambiguity counts with entity links.

Migration: `modules/identity/migrations/007_entity_type_correction.sql` (new; existing migrations
unchanged). Integration may renumber its prefix before the first live application.

### Running on live after integration

1. Integrate this branch and restart the existing live server normally. Its migration runner applies
   the new migration using the server's database handle. Do not open the real database from a script.
2. Select the operator in the local user switcher. Open Developer → Enrichment and click
   **Import the findings**. Review “N entity types corrected, M ambiguous” and its linked records.
3. Click **Export the research set** before running the next enrichment check or W3 pass. The next
   `research-set.jsonl` and `candidates.jsonl` carry the corrected types. Keep workflow inputs fixed
   during any running research pass.

For an explicit correction, POST JSON to `/api/identity/entity-type` from the live application's
browser session. Use `operation: "correct"`, `entityId`, `type: "org"` (or `"person"`), a nonblank
`reason`, and a stable `requestKey`. The response supplies `correctionId`. The selected local
operator supplies the actor; callers cannot choose it. This endpoint only changes the local DB.

For reversal, POST `operation: "reverse"`, `correctionId` and a nonblank `reason` to the same
endpoint. Correction IDs from automatic decisions appear in the import report. Repeated requests
are harmless. Undo any identity merges involving the corrected node through the existing merge
undo path first; reversal refuses to change a merged component's meaning. Re-export afterward.

Validation uses invented fixtures only. Typecheck, boundaries and the complete property suite are
run before commit; the final result is recorded below. Browser QA could not run because the sandbox
refused a demo listening socket (`EPERM`); no screenshot was produced and no real data was accessed.

Validation: `npx tsc --noEmit` and `npm run boundaries` pass; `npm run props` reports **618 of 618
properties hold**, including 19 new entity-type properties. Coverage includes actual import order,
canonical aliases, stale exports during network rebuilding, reversal, person evidence and export/W3
agreement. The existing Affinity GET-only property continues to enforce the no-write boundary.
