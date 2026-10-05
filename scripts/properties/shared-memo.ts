/** Invented, in-memory handles only: no database, no rows. */
import { withDb, type Db } from '../../lib/db';
import { withBackgroundDb, withForegroundDb, prioritizeDb } from '../../lib/db/scheduling';
import { buildCache } from '../../lib/build-cache';
import { routeSources } from '../../modules/network/repo';
import type { Check } from './harness';

/** The first revision read waits at a gate, like a query in flight when a page read begins. */
function gatedDb(kind: Db['kind'], revisionTable: string) {
  let open!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { open = resolve; });
  const inFlight = new Promise<void>(resolve => { entered = resolve; });
  let first = true;
  const raw: Db = {
    kind,
    async query<T>() { return [] as T[]; },
    async one<T>(sql: string) {
      if (!sql.includes(revisionTable)) return null;
      if (first) { first = false; entered(); await gate; }
      return { revision: 'invented:1' } as T;
    },
    async exec() {},
    async transaction(fn) { return fn(raw); },
    async close() {},
  };
  return { db: prioritizeDb(raw), open, inFlight };
}

/**
 * 5 Oct 2026: the route warm-up (maintenance) started a shared memo; a page read holding maintenance back
 * (withForegroundDb) joined it. The memo's queries waited for the reader, the reader for the memo, and with
 * nothing else to run the property process drained: "Property run ended before its summary". On the live
 * server the page request would hang and every later maintenance query wait behind it.
 */
async function joinsMaintenanceMemo(kind: Db['kind'], revisionTable: string, read: () => Promise<unknown>): Promise<boolean> {
  const { db, open, inFlight } = gatedDb(kind, revisionTable);
  // Maintenance reads the revision; the read is in flight when the page arrives.
  const maintenance = withBackgroundDb(() => withDb(db, read)).catch(() => undefined);
  await inFlight;
  let timer: NodeJS.Timeout | undefined;
  const stalled = new Promise<'stalled'>(resolve => { timer = setTimeout(() => resolve('stalled'), 2000); });
  const page = withDb(db, () => withForegroundDb(db, async () => {
    open();
    // Maintenance creates its memo now, behind this reader; then the page reads the same revision and joins it.
    await new Promise<void>(resolve => setImmediate(resolve));
    return read();
  }));
  const outcome = await Promise.race([page.then(() => 'answered' as const, () => 'failed' as const), stalled]);
  clearTimeout(timer);
  if (outcome === 'answered') await maintenance;
  return outcome === 'answered';
}

export async function sharedMemoProperties(check: Check) {
  const results: string[] = [];
  let ok = true;
  for (const kind of ['postgres', 'pglite'] as const) {
    const sources = await joinsMaintenanceMemo(kind, 'route_revision', () => routeSources());
    const cache = buildCache(async () => (await (await import('../../lib/db')).getDb()).query('select 1 as invented'));
    const page = await joinsMaintenanceMemo(kind, 'read_revision', () => cache());
    ok &&= sources && page;
    results.push(`${kind}: route sources ${sources ? 'answered' : 'stalled'}, page cache ${page ? 'answered' : 'stalled'}`);
  }
  check('SCHEDULING a page read that joins a memo maintenance started answers, on Postgres and PGlite',
    ok, `${results.join('; ')}. Shared memos run at foreground priority whoever starts them (withSharedDb).`);
}
