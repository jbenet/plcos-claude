import { getDb, type Db } from '@/lib/db';

/** One revision read, never a scan of the graph or picker tables. Writes invalidate at
 * transaction commit; midnight refreshes date-sensitive picker inputs. Guards are read live. */
export async function readRevision(db: Db): Promise<string> {
  const row = await db.one<{ revision: string }>(`select revision::text || ':' || current_date::text as revision
    from network.read_revision where singleton`);
  return row!.revision;
}

/** Bounded per-database memo for page inputs. Rejections are evicted; concurrent
 * requests share the work. Callers must treat returned values as immutable. */
export function buildCache<T>(load: (...args: string[]) => Promise<T>, limit = 16) {
  const databases = new WeakMap<Db, { revision: string; entries: Map<string, Promise<T>> }>();
  const read = async (...args: string[]): Promise<T> => {
    const db = await getDb(), revision = await readRevision(db);
    let state = databases.get(db);
    if (state?.revision !== revision) {
      state = { revision, entries: new Map() };
      databases.set(db, state);
    }
    const key = JSON.stringify(args), prior = state.entries.get(key);
    if (prior) return prior;
    const value: Promise<T> = Promise.resolve().then(async () => {
      try {
        const result = await load(...args);
        // Concurrent callers share this validated promise, never the unvalidated load.
        return await readRevision(db) === revision ? result : read(...args);
      } catch (error) {
        if (state.entries.get(key) === value) state.entries.delete(key);
        throw error;
      }
    });
    state.entries.set(key, value);
    if (state.entries.size > limit) state.entries.delete(state.entries.keys().next().value!);
    return value;
  };
  return read;
}
