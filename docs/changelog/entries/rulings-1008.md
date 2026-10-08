# The Admin token merges duplicate identities; the connector cap only advises · 8 Oct 2026

Juan, 8 Oct 2026, on the overnight summary:

- **Merge duplicate identities by token.** The W13 proposals were waiting for a person to click Developer → Enrichment →
  Merge duplicate identities. Juan: "ideally you do it". `/api/sync/jobs` (and `scripts/cloud-job.sh duplicates`) now
  queues that job for an Admin's token, as the button does for an Admin. Its checks, audit and reversal are the
  button's.
- **The connector cap advises.** A connector asked more than `asksPerConnectorPerQuarter` times this quarter blocked
  the ask (`connector_load`, modules/coordination/service.ts). Juan: "i'd remove it unless necessary". It is now shown
  beside the blocks and refuses nothing, like the relationship cap since 4 Oct (`config.guard.askLimit`).

Checks: tsc, boundaries, and the sync-vehicles properties (jobs by token) on Postgres.
