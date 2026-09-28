# Kit runtime contract — 28 Sep 2026

The anonymous LabOS root waits for authentication before redirecting, letting the existing
layout show its sign-in message. LabOS accepts feedback on its own origin and uses the data directory. With
`LABOS_ME_URL` absent, the Mac keeps its redirect and repository feedback directory.

| Item | Status | Fix / evidence |
|---|---|---|
| Iframe headers | Pass (code audit) | No X-Frame-Options or CSP exists in app configuration/proxy; no header change needed. Smoke script checks responses and any future frame-ancestors. |
| Cookies | Pass | All three app setters explicitly use SameSite=Lax; no Strict cookies. HTTPS subdomains of os.pl.xyz are same-site. |
| PORT / bind | Pass (code audit) | Existing Dockerfile CMD expands PORT and binds 0.0.0.0. |
| Health | Pass (property) | Existing /health rewrite reaches the public, DB-free 200 handler. |
| Anonymous LabOS root | Fixed; HTTP check pending | Root no longer races the layout with a redirect; regression checks no throw/redirect and preserves the local redirect. |
| Hard loads | Script added; execution blocked | Discovers all 77 page routes (19 dynamic templates), substitutes demo examples, GETs canonical URLs without client JS, checks 200, title, main, heading and error markers. APIs/assets are separate from page SSR. |
| Internal URLs / titles | Fixed for feedback | LabOS feedback no longer refuses the container or links to a Mac port. Other redirects preserve request origin; root metadata supplies product title. |
| Persistent writes | Fixed for LabOS demo | Issue files now use config.data.root/issues; real-profile issues already did. Next's cache remains a disposable runtime write. |
| Processes / worker threads | Existing PL exception | Import child retained as requested. Activity/enrichment workers, git inspection and scheduled backup subprocesses also need PL's approval. |
| Dashboard route-sync snippet | Not installed | App predates the kit; dashboard URL mirroring is unverified. No analytics snippet added because it transmits potentially sensitive paths/query strings. |
| Remote Postgres | Separate deployment work | Existing real-profile URL validation still permits only loopback; not changed by this runtime-contract patch. |

Verification: `npx tsc --noEmit`, `npm run boundaries`, and all 1,126 properties pass
on PGlite, including two new root/health and feedback properties. Postgres runs at merge. The sandbox
refused the demo server's bind (`listen EPERM 0.0.0.0:3216`), so HTTP and Docker behavior
are not claimed as tested. No real data read; no Docker build or deployment performed.

Run against this branch's seeded demo server (`DATA_PROFILE=demo`, `PORT=3216`):

```sh
DATA_PROFILE=demo node --import tsx scripts/kit-contract.ts http://localhost:3216
# Restart that demo server with LABOS_ME_URL set; no identity cookie is needed:
DATA_PROFILE=demo node --import tsx scripts/kit-contract.ts http://localhost:3216 --labos
```
