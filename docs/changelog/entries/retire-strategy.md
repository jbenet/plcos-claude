# A push can retire a strategy file · 8 Oct 2026

A push could replace a strategy file on the server but never remove one. That left 21 LPs with two files for the same
vehicle, which the import refuses both of, and 74 orphan files.

- **Retire by push.** A W5 file whose content is `{ "retire": true, "reason": "…" }` removes the server's strategy file
  at its path. The file is kept under the push's `inbox/<run>/replaced/`, and the findings import runs as for any W5 push.
- **Refusals.** A path with no file on the server, a missing reason or any other field is refused, and nothing is
  removed.

Checks: tsc, boundaries and the new sync-retire properties on Postgres.
