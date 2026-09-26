import { AsyncLocalStorage } from 'node:async_hooks';
import type { Db } from './index';

interface ScheduledDb { db: Db; hold: <T>(work: () => Promise<T>) => Promise<T> }
// The live handle outlives Next's module reloads. Retain both its queue and async
// priority context, so hot-loaded callers do not wrap it twice or lose priority.
const global = globalThis as typeof globalThis & {
  __capitalOsDbScheduling?: { background: AsyncLocalStorage<boolean>; handles: WeakMap<Db, ScheduledDb> };
};
const state = global.__capitalOsDbScheduling ??= { background: new AsyncLocalStorage<boolean>(), handles: new WeakMap() };
const { background } = state;

/** Only explicitly scoped maintenance work yields its place to interactive queries. */
export const withBackgroundDb = <T>(work: () => Promise<T>): Promise<T> => background.run(true, work);

/** Keep maintenance out of a complete multi-query read, including intentional I/O yields. */
export function withForegroundDb<T>(db: Db, work: () => Promise<T>): Promise<T> {
  const scheduled = state.handles.get(prioritizeDb(db));
  return scheduled ? scheduled.hold(work) : work();
}

/**
 * PGlite has one connection. Keep complete transactions indivisible, but admit queued
 * foreground work before the next maintenance operation. Dispatch on the next event-loop
 * turn so a page's continuation can enqueue its next query before maintenance resumes.
 * An executing query cannot be preempted: maintenance must also bound its query sizes.
 */
export function prioritizeDb(db: Db): Db {
  if (db.kind !== 'pglite') return db;
  const prior = state.handles.get(db);
  if (prior) return prior.db;
  type Job = { run: () => Promise<void> };
  const foreground: Job[] = [], maintenance: Job[] = [];
  let scheduled = false, readers = 0;
  const dispatch = () => {
    if (scheduled || (!foreground.length && (readers > 0 || !maintenance.length))) return;
    scheduled = true;
    setImmediate(async () => {
      const job = foreground.shift() ?? (readers === 0 ? maintenance.shift() : undefined);
      if (job) await job.run();
      scheduled = false;
      if (foreground.length || maintenance.length) dispatch();
    });
  };
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    const low = background.getStore() === true;
    (low ? maintenance : foreground).push({ run: async () => {
      try { resolve(await background.run(low, work)); } catch (err) { reject(err); }
    } });
    dispatch();
  });
  const wrapped: Db = {
    kind: db.kind,
    query: (sql, params) => enqueue(() => db.query(sql, params)),
    one: (sql, params) => enqueue(() => db.one(sql, params)),
    exec: sql => enqueue(() => db.exec(sql)),
    transaction: fn => enqueue(() => db.transaction(fn)),
    // Wait for both queues before closing the underlying connection.
    close: () => withBackgroundDb(() => enqueue(() => db.close())),
  };
  const entry: ScheduledDb = { db: wrapped, hold: async work => {
    readers++;
    try { return await background.run(false, work); }
    finally { readers--; dispatch(); }
  } };
  state.handles.set(db, entry);
  state.handles.set(wrapped, entry);
  return wrapped;
}
