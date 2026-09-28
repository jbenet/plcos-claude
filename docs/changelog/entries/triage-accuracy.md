# Triage and checker accuracy

Reply triage now requires a personal inbound email with the LP as sender, a complete small internal recipient list, an explicit non-mailing flag, and no later outbound email. Missing metadata fails closed; meetings never create a reply obligation. The three-recipient ceiling is a labelled guess.

The export adds “vehicle-tagged contact, no pursuit,” including contacts with no pursuit anywhere. Existing pursuits in any status suppress that vehicle's missing-pursuit row. W9 refresh preserves these exported review rows.

The checker reuses the importer's strategy-file reader for legacy files and vehicle folders, validates folder/ask agreement against the exported database vehicle catalog, and flags duplicate LP/vehicle pairs across layouts. Name checks use case-insensitive word boundaries and skip single-word names and common prose labels. Lead pins are checked within their vehicle.

Run Export the research set once after updating to populate the strict reply evidence and `vehicles.json`. Demo checks can use the seed vehicle catalog; real checks require the exported catalog and never open the database.

Validation: invented regression properties for reply evidence, missing pursuits, both strategy layouts, naming and duplicates; `npx tsc --noEmit`, `npm run boundaries`, `npm run props`. Postgres validation runs at merge.
