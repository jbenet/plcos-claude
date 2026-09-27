## Prospect keys — import research after creating the person

“Add prospects to the pipeline” now records each supplied `personKey` as an
`identity.source_record` with source `prospect_key`, whether the person was created,
matched, or already had a pursuit. Rerunning it backfills aliases for earlier imports.
Existing mappings are retained; conflicting identities are listed and skipped.

“Import the findings” resolves W1 and W5 source keys before writing research or proposals.
Prospect keys use `prospect_key`; `member:<x>` uses the existing `warehouse` mapping with
the full prefix. Both source keys and UUIDs follow canonical identities after merges.
File validation still checks the original key against its filename, diagnostics retain
that key, and strategy deduplication retains the original file hash.

Unmapped files say “key &lt;k&gt; is not mapped yet; run Add prospects (or Import portfolio)
first”. A strategy without an open pursuit in its named vehicle says it will be retried
on the next import once the pursuit exists. No input files need renaming.

**Migrations:** none. The existing source-record table and canonical-identity function
support this change; no applied migration was changed.

**Apply on live:** after Claude integrates this branch and restarts the live server,
open Developer → Enrichment and rerun “Add prospects to the pipeline”, then “Import the
findings”. The first step records missing aliases even for existing pursuits. For member
keys, the corresponding `warehouse` mapping must already exist. The portfolio importer’s
own `portfolio` founder keys are a separate namespace. “Import the findings” also builds
the network after the import: if local warehouse graph inputs are present but their member
mappings are missing, that build creates them, and running “Import the findings” again
imports the files. Retry the findings import after
creating any missing pursuit. All database operations use the live server; no separate
database-opening CLI or file rewrite is needed.

**Verification:** invented demo fixtures cover alias creation and backfill, repeated
imports, conflict refusal, merge chains, equivalent UUID/prospect/member results,
unmapped keys, and retry after pursuit creation. `npx tsc --noEmit` and `npm run boundaries`
pass; `npm run props` passes **638 of 638 properties**, including 12 new checks. The existing
disposition fixture cleanup now removes source mappings before deleting its people.
No real records were read.
