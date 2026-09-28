## Env keys and feedback export — 28 Sep 2026

One small shell helper prefers env credentials, preserving the existing Mac fallback:
`AFFINITY_API_KEY`, `LINEAR_API_KEY`, and Dakota's existing `DAKOTA_USERNAME` /
`DAKOTA_PASSWORD` (its API uses a password exchange, not an API key). Warehouse queries
prefer `CLOUDSDK_AUTH_ACCESS_TOKEN`, otherwise using the same gcloud application-default login.

`GET /api/feedback/export?since=<ISO timestamp with timezone>` returns `{ items: [...] }`
from the existing issues list, with `created > since`. It requires
`Authorization: Bearer <FEEDBACK_EXPORT_TOKEN>`; unset/empty token gives 404, wrong or missing
bearer gives 401, invalid/missing `since` gives 400. The response is not cached; no writes,
new tables or configuration layers. Journaled feedback appears once filed in the issues list.

Validation: TypeScript, boundaries, and the property suite on invented data; two new properties
cover env/fallback behavior and export authorization, timestamp filtering and unchanged files.
Postgres runs at merge.
