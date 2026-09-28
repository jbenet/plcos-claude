# Viewer speed — remove the Affinity note cross product (F5)

Viewer page data now expands each latest Affinity note's person/company links once and joins
source identities by key. The query still returns only note metadata; permissions, local
sign-in, admin loaders and restricted-field behavior are unchanged. No migration or new cache.

Invented PGlite fixture: 2,000 LPs, 2,300 pursuits, 1,500 strategies, 43,000 people,
4,000 research notes and 2,000 Affinity notes with two versions each. Three samples per loader:
viewer median **3,412 → 315 ms** (10.8× faster); uncached admin pipeline **310 ms**,
so viewer is **1.02× admin**, within the 1.5× target for uncached page data.
Admin's memoized load is **0.32 ms**; this change does not establish the target against that
cache hit or measure HTTP/SSR timings. Postgres and deployed route timings remain merge checks.
Reproduce with `node --import tsx scripts/viewer-speed-bench.ts`; it creates and removes its
own temporary database, refuses configured databases, and checks before/after DTO equality.

Properties cover latest-version ordering, timestamp ties, merged aliases, duplicate links,
person/company ID separation, shared notes, removed/missing references, and scoped/empty
grants. Validation: `npx tsc --noEmit`, `npm run boundaries`, `npm run props` (PGlite).
