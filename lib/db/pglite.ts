import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TooManyRows, type Db, type Queryable } from './index';
import { lock } from './lock';
import { prioritizeDb } from './scheduling';
import { timeQuery } from './timing';
import { memoRead } from './read-memo';

interface WorkerError { name: string; message: string; count?: number; code?: string }
function deserialize(error: WorkerError): Error {
  return Object.assign(error.name === 'TooManyRows' ? new TooManyRows(error.count ?? 2) : new Error(error.message), error);
}

/** One worker, one connection, owned by this process. No caller loads WASM on the
 * request thread. The existing scheduler owns admission and transaction isolation. */
export async function openPglite(dir: string): Promise<Db> {
  const release = await lock(dir);
  let worker: Worker;
  try {
    worker = new Worker(resolve(process.cwd(), 'lib/db/pglite-worker.mjs'), { workerData: { dir }, execArgv: [] });
  } catch (error) { await release(); throw error; }
  let sequence = 0, failed: Error | undefined, closed = false;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  // An idle database must not keep a CLI alive. Startup and each in-flight call
  // retain the worker, so a process cannot exit halfway through an awaited write.
  const unrefWhenIdle = () => { if (pending.size === 0) worker.unref(); };
  let readyResolve: () => void, readyReject: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const fail = (error: Error) => {
    failed ??= error;
    readyReject(error);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    unrefWhenIdle();
  };
  worker.on('message', message => {
    if (message.ready) { readyResolve(); unrefWhenIdle(); return; }
    if (message.startupError) { fail(deserialize(message.startupError)); return; }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(deserialize(message.error));
    else request.resolve(message.value);
    unrefWhenIdle();
  });
  worker.on('error', fail);
  worker.on('exit', code => {
    if (!closed) fail(new Error(`Database worker exited (${code}); restart the server`));
  });
  try { await ready; }
  catch (error) { worker.ref(); await worker.terminate(); await release(); throw error; }
  function call<T>(op: string, sql?: string, params?: unknown[], tx?: string): Promise<T> {
    if (failed) return Promise.reject(failed);
    if (closed) return Promise.reject(new Error('Database is closed'));
    const id = ++sequence;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: value => resolve(value as T), reject });
      worker.ref();
      try { worker.postMessage({ id, op, sql, params, tx }); }
      catch (error) { pending.delete(id); reject(error); unrefWhenIdle(); }
    });
  }
  function on(tx?: string): Queryable {
    return {
      query: (sql, params = []) => tx ? timeQuery(sql, () => call('query', sql, params, tx)) : memoRead(sql, params, () => timeQuery(sql, () => call('query', sql, params, tx)), 'query'),
      one: (sql, params = []) => tx ? timeQuery(sql, () => call('one', sql, params, tx)) : memoRead(sql, params, () => timeQuery(sql, () => call('one', sql, params, tx)), 'one'),
      exec: sql => call('exec', sql, [], tx),
    };
  }
  let closing: Promise<void> | undefined;
  return prioritizeDb({
    kind: 'pglite',
    ...on(),
    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const tx = randomUUID();
      await call('begin', undefined, undefined, tx);
      try {
        const value = await fn(on(tx));
        await call('commit', undefined, undefined, tx);
        return value;
      } catch (error) {
        try { await call('rollback', undefined, undefined, tx); }
        catch { /* A failed worker stays failed; preserve the original exception. */ }
        throw error;
      }
    },
    close() {
      return closing ??= (async () => {
        try { if (!failed) await call('close'); }
        finally {
          closed = true;
          worker.ref();
          await worker.terminate();
          await release();
        }
      })();
    },
  });
}
