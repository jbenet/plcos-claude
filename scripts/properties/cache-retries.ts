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
  for (const kind of ['page', 'routes'] as const) {
    const fixture = revisionFixture();
    let attempts = 0, churn = true;
    const load = async () => { attempts++; if (churn) fixture.commit(); return null; };
    const read = kind === 'page' ? buildCache(load) : () => cachedRoutes('00000000-0000-4000-8000-000000000001', 'fund', load);
    let failure: unknown;
    await withDb(fixture.db, async () => { try { await read(); } catch (error) { failure = error; } });
    check(`${kind} cache refuses continuous cross-process revision changes after two retries`,
      isDbBusy(failure) && attempts === 3,
      `Unstable reads=${attempts}; controlled busy response=${isDbBusy(failure)}`);
    churn = false;
    const stable = await withDb(fixture.db, () => read());
    await withDb(fixture.db, () => read());
    check(`${kind} cache evicts unstable work and caches the next stable result`,
      stable === null && attempts === 4,
      'Failed attempts cannot poison the cache or return mixed-revision data');
  }
  const fixture = revisionFixture();
  let attempts = 0;
  const read = buildCache(async () => { attempts++; if (attempts < 3) fixture.commit(); return 'stable'; });
  const values = await withDb(fixture.db, () => Promise.all([read(), read(), read()]));
  check('Concurrent page callers share validated attempts while keeping a bounded retry budget',
    attempts === 3 && values.every(value => value === 'stable'),
    `${attempts} attempts for ${values.length} callers; third stable version only`);
}
