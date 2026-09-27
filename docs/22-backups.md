# Backups of the real data

Juan, 27 Sep 2026: "think about and plan for DB backups. For now you could just snapshot and targz and
encrypt it. store in another directory. Maybe we upload it somewhere (GitHub repo? Or too big? I can
upload to Google Drive for PL if needed as a stopgap.)"

## What exists now

`npm run backup` (`scripts/backup-real.sh`):
1. **Clone** `plcos-data/real` with APFS copy-on-write clones, which takes about a second. It skips
   lock files and the Postgres rehearsal cluster.
2. **Check that the snapshot opens.** A separate process opens the cloned PGlite database and reads
   from it. If it can't, nothing is written. The live server may be mid-write while the clone is
   taken, so the snapshot is crash-consistent at best. This check is what makes it count.
3. **Pack and encrypt** in one stream (`tar | gzip | gpg --symmetric AES256`), so no unencrypted
   archive ever touches the disk. The passphrase is random, stored in the login keychain as
   `plcos-backup / passphrase`, and never printed or passed on a command line.
4. **Write** `~/plcos-backups/plcos-real-<UTC stamp>.tar.gz.gpg` (mode 600, folder mode 700,
   outside every repository) with a `.sha256` beside it.
5. **Rotate.** Keep the newest 24 backups, plus the first backup of each of the last 14 days. Both
   numbers are guesses (`KEEP_HOURLY`, `KEEP_DAILY`).

`npm run backup:restore -- <file> <empty dir>` decrypts and unpacks. `npm run backup:key` says whether
the passphrase is stored.

**First run, 27 Sep 15:30 UTC:**
- The real folder was 9.8 GB, of which the PGlite database was 8.2 GB. The backup is 2.1 GB and took
  2 min 44 s.
- Checks: the checksum matches, it decrypts, and the archive holds every folder.

**Save the passphrase in 1Password.** Without it, no backup can be restored. It lives only in this
Mac's keychain.

## Off-machine copies: decisions for Juan

- **GitHub: no.** A 2.1 GB file is over GitHub's 100 MB file limit, Git LFS would keep every version
  forever, and a repository is the wrong place for confidential data even when encrypted.
- **Google Drive (PL), as a stopgap: yes, if Juan uploads,** or once a Drive connector is approved
  for writing. The archive is encrypted and the key never goes with it.
- **Dakota.** Each backup contains Dakota data: the raw replica and its database projection. Dakota
  data must not leave our systems (docs/20-dakota.md). An off-machine copy therefore either excludes
  Dakota (`--no-dakota`: leave out `real/dakota` and drop the `dakota` schema from the snapshot before
  packing; to build), or Juan decides that PL's Drive counts as our system, as the PL warehouse does.

## Schedule

A backup every hour while the Mac is on, via a launchd agent (to add with Juan's OK, since it is a
standing job on his machine). Until then Claude runs `npm run backup` before risky operations: bulk
merges, migrations, and the Postgres switch.

## After the move to Postgres (docs/21)

- A nightly `pg_dump --format=custom`, encrypted the same way. It is consistent by construction and
  far smaller than the PGlite directory.
- Later, continuous WAL archiving (pgBackRest or `archive_command`) if losing an hour's writes ever
  matters.
- Keep the last PGlite directory untouched for two weeks after the switch, as the rollback.

## Restore drill

Once a week, restore the newest backup into an empty folder, open it with `npm run preview`, and check
that pages load. A backup nobody has restored is a hope, not a backup.

## Open question

**Why is the PGlite directory 8.2 GB?** Likely dead rows and WAL left from repeated large imports
(route caches, identity merges). Moving to Postgres and running `VACUUM FULL` will show the true
size. Until then, the size drives backup time.
