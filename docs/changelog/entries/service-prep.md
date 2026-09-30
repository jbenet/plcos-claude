# Service prep — env template, preflight, backup restore drill, cutover file pack

30 September 2026 · operational only, no page changes

Where the move to one service stands, what PL Infra still has to answer, and the cutover sequence
with each step marked ready or blocked: [status-2026-09-30.md](../../deploy/status-2026-09-30.md).

- [service.env.example](../../deploy/service.env.example) lists every variable the service reads,
  by name only, each tagged (required, required once real, later, optional, image, internal, never).
  A property fails when the code reads a variable the template does not list.
- `bash scripts/preflight.sh [--dry]` checks a target against rev 3: environment names, Node, child
  processes, memory and CPU limits, the volume, the Postgres 17 tools, the RDS CA files, the database
  (version, TLS, privileges, emptiness), the backup key, and without `--dry` S3, egress and LabOS.
  It prints names, never values.
- `scripts/backup-service-restore.sh` restores a service backup into an empty database and folder.
  `scripts/service-drill.sh` runs backup and restore end to end on invented demo data: on the test
  cluster, 119 tables and 1,086 rows verified MATCH, every working file's SHA-256 matched, and both
  refusals held.
- `scripts/cutover-files.sh list|pack` is runbook step 3c. It leaves out database folders, `dakota/`,
  logs, snapshots and the research-export files (regenerated on the service after the Dakota strip),
  and refuses an archive that contains any of them.

Validation: `bash scripts/gate.sh` passes: types, boundaries, 1,394 PGlite and 1,403 Postgres properties, five of them new (invented data). No real data read, nothing
fetched, pushed or uploaded; no image built (no Docker here).
