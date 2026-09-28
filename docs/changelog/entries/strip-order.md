# Cutover re-point order and viewer refusals

Dakota stripping retries FK-blocked LP re-point undos inside savepoints. Shared
batch timestamps no longer cause a created organisation pursuit to be deleted
before its dependent contacts are undone. No-progress dependencies and later edits
still roll back the entire strip.

Viewer server actions now redirect to the normal refusal message instead of
returning an unhandled 500 (303 for plain form posts). API refusals retain HTTP 403.

Invented-data properties reproduce the old FK failure, verify restoration and
no-progress rollback, and cover plain/enhanced action refusals without writes.
Validation: `npx tsc --noEmit`, `npm run boundaries`, `npm run props`.
Postgres verification runs at merge; no real data was read.
