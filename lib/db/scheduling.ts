import { AsyncLocalStorage } from 'node:async_hooks';
import type { Db } from './index';

interface ScheduledDb { db: Db; hold: <T>(work: () => Promise<T>) => Promise<T> }
// The live handle outlives Next's module reloads. Retain both its queue and async
// priority context, so hot-loaded callers do not wrap it twice or lose priority.
const global = globalThis as typeof globalThis & {
  __capitalOsDbScheduling?: { background: AsyncLocalStorage<boolean>; handles: WeakMap<Db, ScheduledDb>; cancellation?: AsyncLocalStorage<AbortSignal> };
};
const state = global.__capitalOsDbScheduling ??= { background: new AsyncLocalStorage<boolean>(), handles: new WeakMap() };
const { background } = state;
const cancellation = state.cancellation ??= new AsyncLocalStorage<AbortSignal>();

export class DbBusyError extends Error {
  readonly digest = 'CAPITAL_OS_DB_BUSY';
  constructor() { super('The server is busy, try again.'); this.name = 'DbBusyError'; }
}
export function isDbBusy(error: unknown): boolean {
  return error instanceof Error && ('digest' in error && error.digest === 'CAPITAL_OS_DB_BUSY');
}

export interface QueueClock {
  now(): number;
  after(milliseconds: number, callback: () => void): () => void;
}
const clock: QueueClock = {
  now: () => performance.now(),
  after: (milliseconds, callback) => {
    const timer = setTimeout(callback, milliseconds); timer.unref();
    return () => clearTimeout(timer);
  },
};

/** Best-effort metadata must stop queueing work when its short budget expires.
 * A query already executing cannot be interrupted; later queries remain cancelled. */
export async function bestEffortDb<T>(work: () => Promise<T>, milliseconds = 250, timer = clock): Promise<T | undefined> {
  const controller = new AbortController();
  let cancel = () => {};
  const expired = new Promise<undefined>(resolve => {
    cancel = timer.after(milliseconds, () => { controller.abort(); resolve(undefined); });
  });
  try {
    return await Promise.race([cancellation.run(controller.signal, work).catch(() => undefined), expired]);
  } finally { cancel(); }
}

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
export function prioritizeDb(db: Db, timing: QueueClock = clock): Db {
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
    const signal = cancellation.getStore();
    const queuedAt = timing.now(), queue = low ? maintenance : foreground;
    let waiting = true, cancelTimer = () => {};
    const cleanup = () => { cancelTimer(); signal?.removeEventListener('abort', abandon); };
    const abandon = () => {
      if (!waiting) return;
      waiting = false;
      const index = queue.indexOf(job);
      if (index >= 0) queue.splice(index, 1);
      cleanup(); reject(new DbBusyError());
      dispatch();
    };
    const job: Job = { run: async () => {
      if (!waiting) return;
      // Check again before starting: a CPU-heavy query can delay the timeout callback.
      if (signal?.aborted || (!low && timing.now() - queuedAt >= 20_000)) { abandon(); return; }
      waiting = false; cleanup();
      try { resolve(await background.run(low, work)); } catch (err) { reject(err); }
    } };
    if (signal?.aborted) { abandon(); return; }
    queue.push(job);
    signal?.addEventListener('abort', abandon, { once: true });
    if (!low) cancelTimer = timing.after(20_000, abandon);
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
