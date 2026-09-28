# svc-image — One image, and the cutover tooling

28 September 2026 · `claude/svc-image`

These are tools for the one-app target: one LabOS app with a persistent volume and PL's provisioned
Postgres.

**The image.** A plain image runs `next start` as uid 10001. `scripts/image-build.sh` builds it only from
`git archive <commit>`. The build fails if:
- the context has `.git` or stray files under `data/`;
- the tracing audit finds a traced file under `data/real` or `plcos-data`;
- the final image has such a path.

Docker is not installed on this Mac, so no image was built; the context guard was run against an
extracted archive.

**The cutover.** `scripts/cutover.sh` and `scripts/cutover-reverse.sh` do the following:
- freeze the source with READ_ONLY_MODE, when that exists, and then the database itself;
- dump and restore;
- verify counts, checksums, sequences and object counts with the new `lib/db/pg-verify.ts`, which
  reuses pg-copy's digest;
- flip the target only after verification passes.

Both directions were rehearsed on the :5434 test cluster with 120 tables and 1,001,069 invented rows.
Each verified with 0 mismatches in 10 s, and 5 refusals held. The counts are in
[the rehearsal log](../../deploy/rev2/cutover-rehearsal.md), and
[image-and-cutover.md](../../deploy/rev2/image-and-cutover.md) explains how to use both tools.

**Validation.** TypeScript and boundaries pass, and the property suite passes on PGlite, including 9 new
invented cases. No real data was read, and nothing was fetched, pushed or uploaded.
