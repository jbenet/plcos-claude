/** Invented top_connectors benchmark: DATABASE_URL=postgres://…/plcos_test_* node --import tsx scripts/connectors-perf.ts [--open-lps=N].
 * Builds network-perf's real-shape invented graph (5,418 LPs, high-degree hubs), then times a cold top_connectors plan
 * for the vehicle (--budget-ms caps the wait), the kept answer, and a plan made again after a write, counting queries and the time spent in them. Invented data only.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function main() {
  if ((process.env.DATA_PROFILE && process.env.DATA_PROFILE !== 'demo') || process.env.ENRICH_DIR || process.env.PGLITE_DIR) throw new Error('Invented fixture refuses real profile and existing data directories');
  const root = await mkdtemp(join(tmpdir(), 'plcos-connectors-perf-'));
  process.env.DATA_PROFILE = 'demo'; process.env.ENRICH_DIR = join(root, 'enrich'); process.env.PGLITE_DIR = join(root, 'db'); process.env.PLCOS_IMPORT_WORKER = '1';
  const { config } = await import('../config/deployment');
  Object.defineProperty(config.data, 'root', { value: root });
  Object.defineProperty(config.outreach, 'connectorsBudgetMs', { value: Number(process.argv.find((a) => a.startsWith('--budget-ms='))?.slice(12) ?? 600_000) });
  const [{ openTestDb, cleanTestPostgres }, { migrate }, { withDb }, { withQueryTimings }, { buildNetwork }, { generateNetworkFixture }, { getUserByHandle }, { actAs }, { topConnectors }] = await Promise.all([
    import('./properties/database'), import('../lib/db/migrate'), import('../lib/db'), import('../lib/db/timing'), import('../modules/network/build'),
    import('./network-perf'), import('../modules/platform/repo'), import('../lib/auth/acting'), import('../lib/outreach/connectors')]);
  const db = await openTestDb(join(root, 'db'));
  try {
    const open = Number(process.argv.find((a) => a.startsWith('--open-lps='))?.slice(11) ?? 400);
    await migrate(db);
    await generateNetworkFixture(db, process.env.ENRICH_DIR!, false, true, open);
    await withDb(db, () => buildNetwork({ awaitBackground: true }));
    const user = (await withDb(db, () => getUserByHandle('invented-0')))!;
    for (const run of ['cold', 'kept', 'replanned']) {
      // A write the plan reads moves its revision: planned again, with the routes the first plan cached.
      if (run === 'replanned') await db.query(`update platform.vehicle set sort_order = sort_order where slug = 'neurotech'`);
      let queries = 0, sqlMs = 0;
      const bySql = new Map<string, { n: number; ms: number }>();
      const start = performance.now();
      const out = await withQueryTimings((q) => { queries++; sqlMs += q.milliseconds;
        const k = q.sql.replace(/\s+/g, ' ').trim().slice(0, 110), b = bySql.get(k) ?? { n: 0, ms: 0 }; b.n++; b.ms += q.milliseconds; bySql.set(k, b); },
        () => withDb(db, () => actAs(user, () => topConnectors(user, { vehicle: 'neurotech', firstHopOnly: true }))));
      const d = out.data as { lpsOpen?: number; lpsInspected?: number; total?: number; complete?: boolean; connectors?: Array<{ bestScore: number | null }> };
      console.log(JSON.stringify({ run, open, ms: Math.round(performance.now() - start), queries, sqlMs: Math.round(sqlMs),
        lpsOpen: d.lpsOpen, inspected: d.lpsInspected, connectors: d.total, complete: d.complete }));
      if (process.argv.includes('--queries')) for (const [k, b] of [...bySql].sort((x, y) => y[1].ms - x[1].ms).slice(0, 15)) console.log(`${b.n}\t${Math.round(b.ms)}ms\t${k}`);
    }
  } finally { await db.close(); await cleanTestPostgres(); }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
