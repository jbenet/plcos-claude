import type { Check } from './harness';
import { type Db, withDb } from '../../lib/db';
import { buildCache } from '../../lib/build-cache';
import { isDbBusy } from '../../lib/db/scheduling';
import { cachedRoutes } from '../../modules/network/cache';

/** Simulate commits by a different process between reads, without touching a database. */
function revisionFixture() {
  let revision = 0;
  const db: Db = {
    kind: 'postgres',
    query: async () => [],
    one: async <T>(sql: string, params?: unknown[]) => {
      if (sql.includes('identity.canonical_entity_id')) return { id: params![0] } as T;
      if (sql.includes('from network.route_cache')) return null;
      return { revision: String(revision), epoch: '0', day: '2026-09-27' } as T;
    },
    exec: async () => {},
    transaction: async fn => fn(db),
    close: async () => {},
  };
  return { db, commit: () => { revision++; } };
}

export async function cacheRetryProperties(check: Check) {
  {
    // Route searches never return a mixed graph: they retry twice, then answer busy.
    const fixture = revisionFixture();
    let attempts = 0, churn = true;
    const load = async () => { attempts++; if (churn) fixture.commit(); return null; };
    const read = () => cachedRoutes('00000000-0000-4000-8000-000000000001', 'fund', load);
    let failure: unknown;
    await withDb(fixture.db, async () => { try { await read(); } catch (error) { failure = error; } });
    check('routes cache refuses continuous cross-process revision changes after two retries',
      isDbBusy(failure) && attempts === 3,
      `Unstable reads=${attempts}; controlled busy response=${isDbBusy(failure)}`);
    churn = false;
    const stable = await withDb(fixture.db, () => read());
    await withDb(fixture.db, () => read());
    check('routes cache evicts unstable work and caches the next stable result',
      stable === null && attempts === 4,
      'Failed attempts cannot poison the cache or return mixed-revision data');
  }
  {
    // Page inputs (8 Oct 2026): a load the data changed under is answered once and never kept.
    const fixture = revisionFixture();
    let attempts = 0, churn = true;
    const read = buildCache(async () => { attempts++; if (churn) fixture.commit(); return `load ${attempts}`; });
    const first = await withDb(fixture.db, () => read());
    check('page cache answers a load the data changed under, without retrying it',
      first === 'load 1' && attempts === 1, `answer=${first}, loads=${attempts}`);
    churn = false;
    const second = await withDb(fixture.db, () => read());
    const third = await withDb(fixture.db, () => read());
    check('page cache keeps no load the data changed under, and keeps the next stable one',
      second === 'load 2' && third === 'load 2' && attempts === 2, `answers=${second}, ${third}; loads=${attempts}`);
  }
  const fixture = revisionFixture();
  let attempts = 0;
  const read = buildCache(async () => { attempts++; return 'stable'; });
  const values = await withDb(fixture.db, () => Promise.all([read(), read(), read()]));
  check('Concurrent page callers share one load',
    attempts === 1 && values.every(value => value === 'stable'),
    `${attempts} loads for ${values.length} callers`);
}
