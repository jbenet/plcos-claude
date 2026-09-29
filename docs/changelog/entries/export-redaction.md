# Research export — preserve identity keys and email domains

Identity-review exports preserve source keys with long digit runs, including Affinity company/person IDs, warehouse keys and finding keys. Phone detection applies to free text, not schema-identified source keys. Email addresses retain their domain as `…@example.com`, including encoded addresses and name-only W3/warehouse records; phone contact schemes remain omitted.

Added invented-data properties for opaque identifiers, free-text phone redaction, numeric email domains, encoded addresses and name-only records. No real records were read or exported.

Validation: `npx tsc --noEmit`, `npm run boundaries`, `npm run props`.
