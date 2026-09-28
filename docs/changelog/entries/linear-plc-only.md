## Linear — PLC-only sync and replica rebuild

Linear now reads only `config.linear.teams` (default `['PLC']`). Every entity query carries a
server-side scope; users are requested only by referenced IDs. The client keeps its mutation
guard and prevents caller variables from broadening the team allowlist. Scope changes force a
full scoped pull. Translation rejects out-of-scope records and strips foreign references.

Developer → Linear displays the allowlist and scopes every count and project row, including
legacy data before cleanup. **Purge and re-map** runs the new `linear-rebuild` job: filter raw
JSONL files, remove empty files, retain counts-only purge notes, and transactionally truncate and
replay the Linear schema. Pull and rebuild cannot overlap. Rebuild needs no Linear key or API.

Claude runs cleanup on the live server: Developer → Linear → **Purge and re-map**; wait for the
job to finish and reload. A subsequent **Full resync** refreshes the allowed-team copy. Retry the
rebuild after an interrupted purge before syncing. No real data was accessed in development.

Validation: TypeScript and boundaries passed. Fixture properties cover immutable query scope,
translation exclusion, orphan file removal and repeated rebuilds. The complete PGlite suite passed 1,013/1,013; the final focused Linear suite passed 25/25. The requested Postgres command was attempted but sandbox networking refused localhost
port 5434 (`EPERM`); Claude must run it before integration.
