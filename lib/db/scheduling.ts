import { AsyncLocalStorage } from 'node:async_hooks';
import type { Db, Queryable } from './index';

interface ScheduledDb { db: Db; cancellable: (signal: AbortSignal) => Queryable; hold: <T>(work: () => Promise<T>) => Promise<T> }
// The live handle outlives Next's module reloads. Retain both its queue and async
// priority context, so hot-loaded callers do not wrap it twice or lose priority.
const global = globalThis as typeof globalThis & {
  __capitalOsDbScheduling?: { background: AsyncLocalStorage<boolean>; handles: WeakMap<Db, ScheduledDb>; idleBusyLogged?: boolean };
};
const state = global.__capitalOsDbScheduling ??= { background: new AsyncLocalStorage<boolean>(), handles: new WeakMap() };
const { background } = state;

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
 * A query already executing cannot be interrupted; later queries on the explicitly bound handle remain cancelled. */
export async function bestEffortDb<T>(work: (signal: AbortSignal) => Promise<T>, milliseconds = 250, timer = clock): Promise<T | undefined> {
  const controller = new AbortController();
  let cancel = () => {};
  const expired = new Promise<undefined>(resolve => {
    cancel = timer.after(milliseconds, () => { controller.abort(); resolve(undefined); });
  });
  try {
    return await Promise.race([(async () => work(controller.signal))().catch(() => undefined), expired]);
  } finally { cancel(); }
}

/** Cancellation is an explicit capability, never inherited by shared async work.
 * This is intentionally only Queryable: a transaction already admitted must finish. */
export function cancellableDb(db: Db, signal: AbortSignal): Queryable {
  const scheduled = state.handles.get(prioritizeDb(db));
  if (scheduled) return scheduled.cancellable(signal);
  const run = <T>(work: () => Promise<T>): Promise<T> => {
    if (signal.aborted) return Promise.reject(new DOMException('DB work cancelled', 'AbortError'));
    return work();
  };
  return {
    query: (sql, params) => run(() => db.query(sql, params)),
    one: (sql, params) => run(() => db.one(sql, params)),
    exec: sql => run(() => db.exec(sql)),
  };
}

/** Only explicitly scoped maintenance work yields its place to interactive queries. */
export const withBackgroundDb = <T>(work: () => Promise<T>): Promise<T> => background.run(true, work);

/**
 * Work that other callers can join — an in-flight memo shared under a revision — runs at foreground
 * priority, whoever starts it. A page read inside withForegroundDb holds maintenance back; when the route
 * warm-up (maintenance) had started the memo, its queries waited for that read and the read waited for
 * them. Nothing else was left to run, so the property process drained before its summary (5 Oct 2026);
 * on a server the page would hang and every later maintenance query queue behind it.
 */
export const withSharedDb = <T>(work: () => Promise<T>): Promise<T> => background.run(false, work);

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
  const prior = state.handles.get(db);
  if (prior) return prior.db;
  if (db.kind === 'postgres') return concurrentDb(db);
  type Job = { run: () => Promise<void> };
  const foreground: Job[] = [], maintenance: Job[] = [];
  let scheduled = false, executing = false, readers = 0;
  const dispatch = () => {
    if (scheduled || executing || (!foreground.length && (readers > 0 || !maintenance.length))) return;
    scheduled = true;
    setImmediate(async () => {
      const job = foreground.shift() ?? (readers === 0 ? maintenance.shift() : undefined);
      if (job) await job.run();
      scheduled = false;
      if (foreground.length || maintenance.length) dispatch();
    });
  };
  const enqueue = <T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> => new Promise((resolve, reject) => {
    const low = background.getStore() === true;
    const queuedAt = timing.now(), queue = low ? maintenance : foreground;
    let waiting = true, deadlineWaived = false, cancelTimer = () => {};
    const cleanup = () => { cancelTimer(); signal?.removeEventListener('abort', abandon); };
    const origin = new Error('DB request queued here');
    const abandon = () => {
      if (!waiting) return true;
      // Explicit cancellation is not load shedding: never resurrect expired writes.
      if (!signal?.aborted && !executing && !foreground.some(other => other !== job)) {
        if (!state.idleBusyLogged) {
          state.idleBusyLogged = true;
          console.error('[db] invariant: busy refusal with an idle foreground queue; running query instead', origin.stack);
        }
        deadlineWaived = true;
        cancelTimer();
        dispatch();
        return false;
      }
      waiting = false;
      const index = queue.indexOf(job);
      if (index >= 0) queue.splice(index, 1);
      cleanup(); reject(signal?.aborted ? new DOMException('DB work cancelled', 'AbortError') : new DbBusyError());
      dispatch();
      return true;
    };
    const job: Job = { run: async () => {
      if (!waiting) return;
      // Check again before starting: a CPU-heavy query can delay the timeout callback.
      if (signal?.aborted || (!deadlineWaived && !low && timing.now() - queuedAt >= 20_000)) { if (abandon()) return; }
      waiting = false; cleanup();
      executing = true;
      try { resolve(await background.run(low, work)); } catch (err) { reject(err); }
      finally { executing = false; dispatch(); }
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
  const entry: ScheduledDb = { db: wrapped, cancellable: signal => ({
    query: (sql, params) => enqueue(() => db.query(sql, params), signal),
    one: (sql, params) => enqueue(() => db.one(sql, params), signal),
    exec: sql => enqueue(() => db.exec(sql), signal),
  }), hold: async work => {
    readers++;
    try { return await background.run(false, work); }
    finally { readers--; dispatch(); }
  } };
  state.handles.set(db, entry);
  state.handles.set(wrapped, entry);
  return wrapped;
}

/** PostgreSQL foreground connections run concurrently. Same-process maintenance still
 * respects a multi-query reader's yield, without serializing unrelated pages or workers. */
function concurrentDb(db: Db): Db {
  let readers = 0;
  const waiting = new Set<() => void>();
  const run = async <T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (signal?.aborted) throw new DOMException('DB work cancelled', 'AbortError');
    if (background.getStore() && readers > 0) await new Promise<void>(resolve => waiting.add(resolve));
    if (signal?.aborted) throw new DOMException('DB work cancelled', 'AbortError');
    return work();
  };
  const wrapped: Db = {
    kind: 'postgres',
    query: (sql, params) => run(() => db.query(sql, params)),
    one: (sql, params) => run(() => db.one(sql, params)),
    exec: sql => run(() => db.exec(sql)),
    transaction: fn => run(() => db.transaction(fn)),
    close: () => db.close(),
  };
  const entry: ScheduledDb = {
    db: wrapped,
    cancellable: signal => ({
      query: (sql, params) => run(() => db.query(sql, params), signal),
      one: (sql, params) => run(() => db.one(sql, params), signal),
      exec: sql => run(() => db.exec(sql), signal),
    }),
    hold: async work => {
      readers++;
      try { return await background.run(false, work); }
      finally { if (--readers === 0) { for (const resume of waiting) resume(); waiting.clear(); } }
    },
  };
  state.handles.set(db, entry);
  state.handles.set(wrapped, entry);
  return wrapped;
}
