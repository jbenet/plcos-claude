# LabOS live server — rehearsal blockers F1, F3 and F4

The image pins `NEXT_DIST_DIR=.next` at build and runtime. `LABOS_ME_URL` makes the deployed server live through one shared helper used by mutation, import, connector and recovery gates. Without it, local checkout roles still apply; preview guards remain in place.

LabOS user resolution reads first, including inactive bindings, and inserts only unknown UIDs. A known UID now makes zero writes instead of one insert attempt per request, preserving page-cache revisions and avoiding import row locks. Unknown members still become viewers; existing roles and names stay unchanged.

Invented-data properties cover image directories, local and deployed roles, preview refusal, and ten concurrent known-UID reads with zero writes and unchanged revision, plus inactive-user refusal. Validation: `npx tsc --noEmit`, `npm run boundaries`, and `npm run props` pass (1,173/1,173, PGlite); the tightened image-stage property also passes independently. Postgres runs at merge. No real-volume load test was rerun.
