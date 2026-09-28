# Name collisions — retain usable research

Person/organization collisions now drop only the conflicting facts or connections, with indexed problem notes. Identity, valid sibling items and unrelated paths remain importable. Explicit item types take precedence over the finding's inferred subject type; collision comparisons retain organization words while matching stays unchanged.

The import and checker report findings kept with dropped items separately from rejected findings. Invented properties cover namesake organizations, own-named canonical organizations, foundation/person mistakes, ambiguous targets, retained paths and import counts.

Validation: `npx tsc --noEmit`, `npm run boundaries`, `npm run props`. Postgres validation runs at merge.
