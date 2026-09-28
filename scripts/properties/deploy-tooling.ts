/** The cutover checker's comparison and the image's static guards. Invented inputs only; no database,
 * docker or network. */
import { readFile } from 'node:fs/promises';
import { compare } from '../../lib/db/pg-verify';
import type { Check } from './harness';

export async function deployToolingProperties(check: Check): Promise<void> {
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
