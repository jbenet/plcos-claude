# Strip Dakota at cutover

Rev 3 decision 3: `cutover.sh` now strips Dakota from the **target**, after restore
checksums match and before it becomes writable. `--keep-dakota` skips stripping.
Copied running/queued import jobs become failed with `stopped at cutover` in either mode.
The Mac runtime is unchanged, including when `LABOS_ME_URL` is unset.

The transform empties all seven Dakota tables, removes source records, identifiers,
claims and derived evidence, keeps names and independent evidence, and clears
unsupported answer/profile fields. It reverses Dakota-dependent LP re-point journals
before deleting their source evidence. Conflicting later edits, mixed unstructured
prose and unhandled provenance roll back and stop cutover. Output contains counts
only. The [provenance inventory](../../deploy/strip-dakota-provenance.md) records the
schema audit; no real data was read or transformed during development.

Invented properties: seven populated Dakota tables → zero rows; source records,
claims and identifiers each 4 → 2 independent rows; mixed edges 3 → 2; copied active
jobs 2 → 0. Actual translator/re-point fixtures prove journal undo and conflict
rollback. Shell fixtures cover default stripping, `--keep-dakota`, and refusal to
flip after failure. Types, boundaries and PGlite properties checked; Postgres runs
at merge.
