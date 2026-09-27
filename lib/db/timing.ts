import { AsyncLocalStorage } from 'node:async_hooks';

export interface QueryTiming { sql: string; milliseconds: number }
const observer = new AsyncLocalStorage<(sample: QueryTiming) => void>();

/** Opt-in local profiling. Never records parameters or result data. Timing starts
 * inside the scheduler, so another query's queue wait is not counted as execution. */
export const withQueryTimings = <T>(record: (sample: QueryTiming) => void, work: () => Promise<T>): Promise<T> =>
  observer.run(record, work);

export async function timeQuery<T>(sql: string, work: () => Promise<T>): Promise<T> {
  const record = observer.getStore();
  if (!record) return work();
  const start = performance.now();
  try { return await work(); }
  finally { record({ sql, milliseconds: performance.now() - start }); }
}
