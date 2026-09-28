/** The cutover checker's comparison and the image's static guards. Invented inputs only; no database,
 * docker or network. */
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compare } from '../../lib/db/pg-verify';
import type { Check } from './harness';

export async function deployToolingProperties(check: Check): Promise<void> {
  const scratch = await mkdtemp(join(tmpdir(), 'service-backup-'));
  try {
    // Compare S3 selection with the existing disk policy, including the cap/newest rule.
    const names = ['20200101T0000Z', '20200102T0000Z', '20210101T0000Z'];
    for (const stamp of names) await writeFile(join(scratch, `plcos-real-${stamp}-daily.tar.gz.gpg`), 'x');
    const disk = execFileSync('python3', ['scripts/backup-prune.py', scratch, '0', '--dry-run'], { encoding: 'utf8' });
    const listing = names.map(s => `2020-01-01 00:00:00 1 ${s.replace('Z', '00Z')}.dump.gpg`).join('\n');
    const dropped = execFileSync('python3', ['scripts/backup-prune.py', '--list-stdin', 'database', '0'], { input: listing + '\n', encoding: 'utf8' });
    check('BACKUP S3 thinning matches disk policy and keeps newest despite cap',
      names.every(s => disk.includes(`would remove plcos-real-${s}`) === dropped.includes(s.replace('Z', '00Z'))) &&
      dropped.trim().split('\n').length === 2 && !dropped.includes('20210101'), 'Invented listings; zero cap cannot remove newest.');
    for (const [name, body] of Object.entries({ node: 'echo unused', pg_dump: 'echo invented', pg_restore: 'echo "SCHEMA only"', gpg: 'echo UNEXPECTED; exit 99', aws: 'echo UNEXPECTED; exit 99' })) {
      await writeFile(join(scratch, name), `#!/bin/sh\n${body}\n`, { mode: 0o700 });
    }
    const run = spawnSync('bash', ['scripts/backup-service.sh'], { encoding: 'utf8', env: {
      ...process.env, PATH: `${scratch}:${process.env.PATH}`, DATA_PROFILE: 'demo', DATABASE_URL: 'postgres://invented',
      BACKUP_BUCKET: 'invented', BACKUP_GPG_PUBLIC_KEY: 'invented', BACKUP_DRY_RUN: '1',
    } });
    check('BACKUP refuses zero TABLE DATA before encryption or AWS', run.status !== 0 && run.stderr.includes('no TABLE DATA') && !`${run.stdout}${run.stderr}`.includes('UNEXPECTED'), 'Command stubs; no database, keys or network.');
  } finally { await rm(scratch, { recursive: true, force: true }); }

  // ---- cutover verification ---------------------------------------------------------------------
  const snap = (rows: Record<string, [number, string]>, seq = '10') => ({
    tables: new Map(Object.entries(rows).map(([k, [count, checksum]]) => [k, { count, checksum }])),
    sequences: new Map([['platform.audit_log_id_seq', seq]]),
    objects: { views: 1, functions: 2, triggers: 3, indexes: 4, constraints: 5, schemas: 6 },
  });
  const same = compare(snap({ 'a.t': [3, 'h1'], 'b.u': [0, 'h0'] }), snap({ 'a.t': [3, 'h1'], 'b.u': [0, 'h0'] }));
  check('CUTOVER VERIFY matches identical snapshots with counts only', same.ok && same.rows === 3 && same.tables === 2, 'Invented digests.');
  check('CUTOVER VERIFY refuses an equal count with a different checksum',
    !compare(snap({ 'a.t': [3, 'h1'] }), snap({ 'a.t': [3, 'h2'] })).ok, 'A changed row is a mismatch.');
  const missing = compare(snap({ 'a.t': [3, 'h1'], 'b.u': [1, 'h'] }), snap({ 'a.t': [3, 'h1'] }));
  check('CUTOVER VERIFY refuses a missing table', !missing.ok && missing.missingTables.join() === 'b.u', 'Restore dropped a table.');
  check('CUTOVER VERIFY refuses a sequence behind the source', !compare(snap({ 'a.t': [3, 'h1'] }, '10'), snap({ 'a.t': [3, 'h1'] }, '9')).ok, 'New ids would collide.');
  check('CUTOVER VERIFY refuses an empty comparison', !compare(snap({}), snap({})).ok, 'Zero tables is never a pass.');

  // ---- image static guards ------------------------------------------------------------------------
  const [dockerfile, ignore] = await Promise.all(['Dockerfile', '.dockerignore'].map(f => readFile(f, 'utf8')));
  check('IMAGE runs as a non-root user', /^USER 10001:10001$/m.test(dockerfile) && !/^USER root/m.test(dockerfile), 'Fixed uid.');
  check('IMAGE fails the build on a traced private path', dockerfile.includes('scripts/check-build-traces.ts') && dockerfile.includes("-ipath '*plcos-data*'"), 'Tracing guard and final sweep.');
  check('IMAGE refuses a context that is not a git archive', dockerfile.includes('GIT_COMMIT unset') && dockerfile.includes('[ ! -e .git ]'), 'Source stage.');
  check('IMAGE context ignores data and secrets', ['data/*', '**/plcos-data', '.env', 'node_modules'].every(l => ignore.split('\n').includes(l)), '.dockerignore second fence.');
}
