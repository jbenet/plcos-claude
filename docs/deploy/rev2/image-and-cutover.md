# The image and the cutover: how to use them

For the one-app target: one LabOS app with a persistent volume and PL's provisioned Postgres. It all
runs locally; nothing here contacts a registry, a bucket or a cloud.

## The image

```sh
bash scripts/image-build.sh [<commit>] [--tag <name>]    # default HEAD, tag capital-os:<sha12>
```

- The build context is `git archive <commit>` piped into `docker build -`. Untracked files, `data/`,
  `plcos-data`, `.next`, `node_modules` and `.env` cannot get into it.
- The build fails in any of these cases:
  - the commit tracks anything under `data/` except its README, or any `plcos-data` path;
  - the context has `.git` or stray data (for example, someone ran `docker build .`);
  - `build:traces` finds a traced file under `data/real` or `plcos-data`;
  - a final sweep finds such a path in `/app`.
- The image runs `next start` on `$PORT` (8080) as uid 10001, with a health check on `/api/health`. Only
  `data/` (where the volume mounts) and `.next/cache` are writable.
- Docker is not installed on this Mac, so no image has been built or measured. The context guard was run
  against an extracted archive. If PL's kit Dockerfile is used instead, keep the `git archive` context and
  the three guards.

## The cutover and the reverse cutover

```sh
bash scripts/cutover.sh run --from <mac url> --to <target url> [--grants grants.sql] [--work <dir>]
bash scripts/cutover-reverse.sh --from <target url> --to <NEW empty mac db url>
bash scripts/cutover.sh status   --db <url>    # frozen? READ_ONLY_MODE? how many tables
bash scripts/cutover.sh unfreeze --db <url>    # rollback before any write lands on the target
```

`run` goes through these steps in order. It stops at the first failure, leaving the source frozen and
the target read-only.

1. **Preflight.** It refuses a target that already has tables, and refuses the same database twice.
2. **Freeze.** READ_ONLY_MODE is set on through `platform.set_read_only_mode(true)`, if that function
   exists. The database is set to `default_transaction_read_only`, other sessions are ended, and an
   INSERT probe must fail.
3. **Dump.** `pg_dump -Fc`. The listing must show data for every table.
4. **Restore.** `--no-owner --no-acl --single-transaction`, then the optional grants file. The target
   stays read-only.
5. **Verify.** `scripts/pg-verify.ts`, whose logic is in `lib/db/pg-verify.ts`. It compares per-table
   counts and pg-copy's ordered-row checksums, the sequences, and the object counts. Any difference
   blocks the flip.
6. **Flip.** The target becomes writable and READ_ONLY_MODE is cleared there. The source stays frozen:
   rename it `*_precutover` and keep it for 14 days. Pointing the app at the target is a configuration
   change, which the script prints but does not make.

The reverse cutover is the same run, but it never restores into a frozen or `*_precutover` database.
The report in the work directory holds counts and timings only. Rehearsal results are in
[cutover-rehearsal.md](cutover-rehearsal.md).

**Not built yet:**
- moving the hot files onto the volume, with a SHA-256 manifest;
- the transfer leg: an encrypted upload and a restore from inside PL's network, needed if PL's Postgres
  can't be reached from the Mac.
