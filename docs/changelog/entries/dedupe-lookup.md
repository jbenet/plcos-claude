# Duplicate organizations: affiliation text, and a lookup for the Mac · 8 Oct 2026

Searching Everyone for one accelerator showed a dozen records: exact-name duplicates, and organizations named after a
short biography ("Former X / Y", "Personal investing (formerly X)", "X (General Partner) / Y (former CEO)").

- **Add prospects** now reads such an organization field into the organizations it names, with the role and
  whether it is a former one, and records affiliations with them instead of creating an organization named after the
  sentence (`lib/enrich/affiliation-text.ts`). A plain name, "Acme (UK)" or "Widget (Acme)" is kept whole.
- An Admin token can now find records of any type by name, and the duplicate groups **Merge duplicate identities**
  holds back for review, with their W13 group ids, members, types, roles and reasons, without pulling the database:
  `GET /api/sync/entity-type?find=<name>` and `?review=<name>`, or `bash scripts/cloud-entity-type.sh find|review
  '<name>'` on the Mac. The review read runs the pass in a transaction it rolls back, so it changes nothing.

The existing duplicates are merged by a W13 run and the duplicates job, on that review.
