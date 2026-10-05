# The real data moved to Railway · 5 Oct 2026

Juan decided on 5 Oct to move that day. The "Finish the Railway setup" session ran it from docs/deploy/railway.md
§5, while Juan was asleep and at his request.

- **Rehearsal first,** from a copy, because `cutover.sh run` always freezes its source. The copy was dumped as the
  read-only role (21 s, 272 MB) and restored on the Mac (27 s). It went to Railway through an SSH tunnel into
  Postgres's own container, with no public database port. Total 741 s; MATCH.
- **The move:** 789 s; MATCH. 135 tables, 1,609,149 rows, 6 sequences, and every view, function, trigger, index and
  constraint. The restore through the tunnel is the long part, about 11–12 minutes. Dakota moved with everything
  else (decision C).
- **The working files:** 37,914 files.
  - Packed in 42 s into 554 MiB, uploaded with `scp` in 235 s, unpacked in 15 s.
  - The rehearsal found that macOS `tar` adds a hidden `._` entry for every file with extended attributes. The
    fixed `cutover-files.sh` (`claude/files-appledouble`) packed the real move, with 0 such entries.
- **The switch:** Juan's `/setup` settings were copied from the demo database, so no `/setup` reopened.
- **Smoke test, signed in as Juan, reads only:** 33 pages, all 200, 0 errors. Covered:
  - /today;
  - each of the 6 vehicles' overview, pipeline, selection and strategy;
  - /orgs/g/lps;
  - /developer/enrich;
  - /settings.

  The research-set export rebuilt in 70 s.
- **The Mac:** its live server stopped at 08:45 UTC and `moved-to-cloud` was set at once, so `npm run dev:real`
  refuses. The frozen `plcos_live` and the 1.1 GB pre-move backup stay until 19 Oct (decision H). Local copies now
  come down through the snapshot API (`scripts/cloud-pull.sh`).

Counts only; no records are in this entry.
