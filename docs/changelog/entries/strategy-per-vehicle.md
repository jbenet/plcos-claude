## Strategy per vehicle — import companion strategies

W5 now imports both `enrich/strategy/<key>.json` and
`enrich/strategy/<vehicle-slug>/<key>.json`. A companion folder must be a known vehicle
slug and exactly match `ask.vehicle`. Only one folder level is read. Legacy top-level
files still accept the vehicle's display name or slug.

The importer resolves canonical identity and vehicle before checking conflicts. Two files
for the same pair are both refused, including a UUID and a source alias for the same LP;
neither replaces the existing proposal. Diagnostics name the conflicting files. A valid
companion proposal attaches to its own open pursuit, and updating it withdraws only that
pursuit's previous open proposal. Repeated imports remain idempotent.

The LP page lists each pursuit's strategy in the existing card with its vehicle label.
The strategy table, So next, fit list and selection pane retain their per-pursuit readers;
LP cards and organization headings also exclude a stored strategy naming another vehicle.
The import's refusal list now shows the full file key so companion files can be identified.
W5 documents where to write and read companion strategies.

**Migrations:** none needed. `strategy.suggestion` already stores `pursuit_id`, and
`strategy.pursuit` is unique by `(entity_id, vehicle_id)`. Existing migration
`007_suggestion_vehicle.sql` repairs older undecided proposals using `ask.vehicle`;
decided history is preserved. No applied migration was edited.

**Apply on live:** after Claude integrates this branch and the live server loads the
updated code, open Developer → Enrichment and run “Import the findings”. Existing
companion files need no move. Their `ask.vehicle` must be the exact folder slug, their
identity must resolve, and an open pursuit must exist in that vehicle. Resolve any
reported folder mismatch or duplicate pair and rerun the import. All writes run inside
the live server; no separate database CLI, reset or manual migration is needed.

**Verification:** invented demo fixtures cover both layouts, exact folder validation,
unknown and deeper folders, canonical-alias conflicts, per-vehicle reads across the LP,
strategy, fit and selection views, repeat imports and isolated revisions. No real data
was read. `npx tsc --noEmit` and `npm run boundaries` pass; `npm run props` passes
**700 of 700 properties**, including 11 new checks.
