# Cutover rehearsal log (local, invented data, 28 Sep 2026)

The rehearsal of `scripts/cutover.sh` and `scripts/cutover-reverse.sh` between two
databases on the invented-data test cluster (127.0.0.1:5434, trust auth, Postgres 17.11). Counts only.
No real data was read; ports 3000, 3001 and 57433 were not touched. How to use the tools:
[image-and-cutover.md](image-and-cutover.md).

## The source

`plcos_test_cutover_a`: every migration applied and the demo seed loaded through the app's own boot
(`openFresh()` with `DATA_PROFILE=demo`), then two rehearsal-only additions:

- a stand-in for build item 9's READ_ONLY_MODE contract (`platform.set_read_only_mode(boolean)`,
  `platform.read_only_mode()` and a one-row table), so the freeze and flip of the application flag
  ran end to end. The real functions land with item 9.
- 1,000,000 invented `platform.audit_log` rows, for volume.

Result: 120 tables, 25 schemas, 1,001,069 rows, 216 MB on disk (the real database is about 640 MB).

## Forward: `a` → `b` (empty)

| Step | Result | Seconds |
|---|---|---|
| preflight | different databases; target empty; source has a migration ledger | 0 |
| freeze | READ_ONLY_MODE on; database read-only; 0 other sessions ended; an INSERT probe refused | 0 |
| dump | 120 of 120 tables' data listed; 9,020,351 bytes (`-Fc`) | 1 |
| restore | single transaction, `--no-owner --no-acl`; target set read-only | 2 |
| verify | **MATCH**: 120 tables, 1,001,069 rows, 0 differ / missing / extra; 6 sequences, 0 differ; views 3/3, functions 15/15, triggers 51/51, indexes 231/231, constraints 455/455, schemas 25/25 | 7 |
| flip | target writable; READ_ONLY_MODE off in the target | 0 |
| **total** | | **10** |

Afterwards: `a` frozen with READ_ONLY_MODE on; `b` writable with it off.

## Refusals (each stopped before changing anything)

- An INSERT on the frozen source: refused by Postgres ("read-only transaction").
- Running the forward cutover again into `b`: "the target already has 120 tables".
- Source and target the same database: refused.
- Reverse cutover into the frozen original `a`: "the target is a frozen database".
- Reverse cutover into a database named `*_precutover`: refused.

## Team writes, then the reverse: `b` → new `a`

Three invented `audit_log` rows were written on `b` (the "service" now holds writes the original lacks).
The original `a` was renamed `plcos_test_cutover_a_precutover` (plan §2: kept untouched for 14 days), and
a new empty `plcos_test_cutover_a` was created.

| Step | Result | Seconds |
|---|---|---|
| preflight | target empty, not frozen, not `*_precutover` | 0 |
| freeze | READ_ONLY_MODE on in `b`; `b` read-only | 0 |
| dump | 120 of 120 tables' data; 9,020,403 bytes | 1 |
| restore | into the new `a` | 2 |
| verify | **MATCH**: 120 tables, 1,001,072 rows (the 3 team writes included), 0 differ; 6 sequences, 0 differ; objects equal | 7 |
| flip | new `a` writable; READ_ONLY_MODE off | 0 |
| **total** | | **10** |

Audit rows: pre-cutover 1,000,017; new `a` 1,000,020. A write to the new `a` was accepted.

## The checker catches differences

`pg-verify` of the kept pre-cutover database against the new `a` (after one more write) reported
**MISMATCH**: 2 tables differ (`platform.audit_log` 1,000,017 vs 1,000,021; the flag table, equal count
but different checksum) and 1 sequence differs. Exit 1.

## Unfreeze

`cutover.sh unfreeze --db b` (the rollback before any write lands on the target) returned `b` to
writable with READ_ONLY_MODE off.

## What this does not show

- Timing at production size. Verification dominates (two full ordered-row hashes); at 640 MB expect
  roughly 30–60 s end to end (GUESS, linear from 216 MB). The T−3 rehearsal in the prod environment sets
  the real number (plan §2 step 1).
- The transfer leg to PL's Postgres (an encrypted upload and an in-network restore, if the Mac cannot
  reach it). The local rehearsal restores straight from the dump file.
- Roles and grants: the rehearsal used one role; a real run restores `--no-owner --no-acl` and then
  applies the target's grants with `--grants`.
- The file volume and its SHA-256 manifest (about 1.0 GB of hot files) are not in these scripts yet.
