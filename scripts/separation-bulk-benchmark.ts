/** Run: DATA_PROFILE=demo node --import tsx scripts/separation-bulk-benchmark.ts
 * Times the separation hotspot, including reads and writes, not fixture setup or migrations.
 * Both versions run in rollback-only transactions on the same invented temporary database.
 */
import { openTestDb } from './properties/database';
import { migrate } from '../lib/db/migrate';
import { recordDuplicateSeparations as before } from './fixtures/separation-bulk-baseline';
import { recordDuplicateSeparations as after } from '../lib/enrich/duplicate-rules';
import { separationScaleFixture, countSeparationWrites } from './separation-bulk-properties';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeImportDuplicatesInTransaction } from '../lib/enrich/import-dupes';

if (process.env.DATA_PROFILE === 'real' || process.env.DATABASE_URL) throw new Error('Benchmark requires demo and an isolated temporary PGlite database.');
process.env.DATA_PROFILE = 'demo';
const scratch = await mkdtemp(join(tmpdir(), 'invented-separation-benchmark-'));
const db = await openTestDb(join(scratch, 'db'));
try {
  await migrate(db);
  const fixture = await db.transaction(tx => separationScaleFixture(tx));
  for (const [version, run] of [['before', before], ['after', after],
    ['after-full-merge', (tx: import('../lib/db').Queryable, by: string) => mergeImportDuplicatesInTransaction(tx, by)]] as const) {
    if (process.argv.includes('--after-only') && version === 'before') continue;
    await db.transaction(async tx => {
      await tx.exec('savepoint benchmark');
      try {
        const counted = countSeparationWrites(tx);
        const start = performance.now();
        await run(counted.tx, 'invented-benchmark', fixture.report());
        const milliseconds = performance.now() - start;
        const rows = await tx.one<{ n: string }>('select count(*) n from identity.match_assertion');
        console.log(JSON.stringify({ version, groups: 1400, largestGroup: 500, milliseconds: Math.round(milliseconds),
          assertions: Number(rows!.n), insertStatements: counted.inserts(), scope: version === 'after-full-merge' ? 'full merge; invented PGlite fixture' : 'separation hotspot; invented PGlite fixture' }));
        if (version !== 'before' && milliseconds >= 120_000) throw new Error('Separation scale budget exceeded: 120 seconds');
      } finally {
        await tx.exec('rollback to savepoint benchmark; release savepoint benchmark');
      }
    });
  }
} finally { await db.close(); await rm(scratch, { recursive: true, force: true }); }
