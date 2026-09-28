## Batch keys — new strategies and research aliases

W5 `--keys` now includes listed LPs eligible for a first strategy through resolved research,
engagement or the warm lane, and retains them when collecting colleagues at their firm.
It reports omitted keys by reason, including batch reservations.

Research exports now write `entity-keys.json` using the findings importer's identity resolver.
Batch cutting reads that map to join alias-keyed findings to candidates without opening the
database. Refresh Export the research set before using aliases from an older export.

Validation: `npx tsc --noEmit`, `npm run boundaries`, `npm run props`.
Invented properties cover CLI selection, omission counts, firm grouping and alias ambiguity.
Postgres validation remains at merge.
