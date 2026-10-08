# The Admin token reads Affinity · 8 Oct 2026

Juan, 8 Oct 2026: "Also update statuses from affinity -- sent a bunch of emails". The Affinity reads could only be
started from Developer → Affinity.

- **`cloud-job.sh affinity <operation>`** queues the buttons' own reads with an Admin token: `slice` (list entries
  and their statuses), `history` (emails and other interactions), `notes`, `meetings` and `translate` (the local
  mapping, then reconciliation and relationship ties). Each read uses its default request cap and reads only what
  changed. The token cannot override a cap, and Affinity stays read-only.
- For fresh statuses and emails, run slice, then history, then translate, each after the last completes.

Checks: tsc, boundaries and the sync-vehicles properties (an Affinity job needs a known operation).
