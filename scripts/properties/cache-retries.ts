import type { Check } from './harness';
import { type Db, withDb } from '../../lib/db';
import { buildCache } from '../../lib/build-cache';
import { isDbBusy } from '../../lib/db/scheduling';
import { cachedRoutes } from '../../modules/network/cache';

/** Simulate commits by a different process between reads, without touching a database. */
function revisionFixture() {
  let revision = 0, foreground = 0;
  const db: Db = {
    kind: 'postgres',
    query: async () => [],
    one: async <T>(sql: string, params?: unknown[]) => {
      if (sql.includes('identity.canonical_entity_id')) return { id: params![0] } as T;
      if (sql.includes('from network.route_cache')) return null;
      return { revision: String(revision), foreground: String(foreground), epoch: '0', day: '2026-09-27' } as T;
    },
    exec: async () => {},
    transaction: async fn => fn(db),
    close: async () => {},
  };
  // A person's commit moves both; an import worker's (network 017) only the revision.
  return { db, commit: () => { revision++; foreground = revision; }, background: () => { revision++; } };
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
  {
    // While only an import has written, a page answers with its last build and rebuilds behind it.
    const fixture = revisionFixture();
    let loads = 0, release!: () => void;
    let gate: Promise<void> = Promise.resolve();
    const read = buildCache(async () => { loads++; await gate; return `build ${loads}`; });
    const first = await withDb(fixture.db, () => read());
    fixture.background();
    gate = new Promise(resolve => { release = resolve; });
    const quick = await withDb(fixture.db, () => read());
    const again = await withDb(fixture.db, () => read());
    check('page cache answers from its last build while only an import has written, and rebuilds once behind it',
      first === 'build 1' && quick === 'build 1' && again === 'build 1' && loads === 2, `answers ${first}, ${quick}, ${again}; loads ${loads}`);
    release();
    await new Promise(resolve => setTimeout(resolve, 10));
    const rebuilt = await withDb(fixture.db, () => read());
    check('page cache serves the rebuild once it is done', rebuilt === 'build 2' && loads === 2, `answer ${rebuilt}; loads ${loads}`);
    fixture.commit();
    gate = Promise.resolve();
    const fresh = await withDb(fixture.db, () => read());
    check("page cache rebuilds before answering after a person's change", fresh === 'build 3' && loads === 3, `answer ${fresh}; loads ${loads}`);
  }
  {
    // A recent read (score detail): after a person's change it answers the last build if young enough,
    // without waiting for a rebuild already running, and a plain read still rebuilds first.
    const fixture = revisionFixture();
    let loads = 0, release!: () => void;
    let gate: Promise<void> = Promise.resolve();
    const read = buildCache(async () => { loads++; await gate; return `build ${loads}`; });
    await withDb(fixture.db, () => read());
    fixture.commit();
    gate = new Promise(resolve => { release = resolve; });
    const front = withDb(fixture.db, () => read());
    await new Promise(resolve => setTimeout(resolve, 5));
    const recent = await withDb(fixture.db, () => read.recent(60_000));
    release();
    const fresh = await front;
    const old = await withDb(fixture.db, () => read.recent(0));
    check("page cache: a recent read answers the last build after a person's change and starts no second rebuild",
      recent === 'build 1' && fresh === 'build 2' && loads === 2 && old === 'build 2',
      `recent ${recent}, plain ${fresh}, too old ${old}; loads ${loads}`);
  }
  const fixture = revisionFixture();
  let attempts = 0;
  const read = buildCache(async () => { attempts++; return 'stable'; });
  const values = await withDb(fixture.db, () => Promise.all([read(), read(), read()]));
  check('Concurrent page callers share one load',
    attempts === 1 && values.every(value => value === 'stable'),
    `${attempts} loads for ${values.length} callers`);
}
