# Identity export baseline

These test-only snapshots come from commit `f79be69`, before the identity export
performance changes. Only import paths have been redirected to their original
modules or the neighboring snapshots. They are never used by the application.

Keep the old queries here so `scripts/identity-export-perf.ts --baseline` can compare
the complete before/after output on the same invented database. Its baseline pass
temporarily removes only the three new indexes in that disposable database.
Array order from SQL without `ORDER BY` is normalized; values and multiplicities
must match. A missing baseline result fails the requested parity check.
