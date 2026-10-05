import { getDb, type Db } from '@/lib/db';
import { DbBusyError, withSharedDb } from '@/lib/db/scheduling';

class RevisionChanged extends Error {}
// GUESS — two retries tolerate brief imports without an unbounded page rebuild loop.
const REVISION_RETRIES = 2;

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
  const readOnce = async (...args: string[]): Promise<T> => {
    const db = await getDb(), revision = await readRevision(db);
    let state = databases.get(db);
    if (state?.revision !== revision) {
      state = { revision, entries: new Map() };
      databases.set(db, state);
    }
    const key = JSON.stringify(args), prior = state.entries.get(key);
    if (prior) return prior;
    // Shared with whoever asks next, so it never runs at maintenance priority (withSharedDb).
    const value: Promise<T> = withSharedDb(() => Promise.resolve().then(async () => {
      try {
        const result = await load(...args);
        // Concurrent callers share this validated promise, never the unvalidated load.
        if (await readRevision(db) !== revision) throw new RevisionChanged();
        return result;
      } catch (error) {
        if (state.entries.get(key) === value) state.entries.delete(key);
        throw error;
      }
    }));
    state.entries.set(key, value);
    if (state.entries.size > limit) state.entries.delete(state.entries.keys().next().value!);
    return value;
  };
  return async (...args: string[]): Promise<T> => {
    // Retry outside shared attempts: joining another caller must not extend our budget.
    for (let attempt = 0; ; attempt++) {
      try { return await readOnce(...args); }
      catch (error) {
        if (!(error instanceof RevisionChanged)) throw error;
        if (attempt >= REVISION_RETRIES) throw new DbBusyError();
      }
    }
  };
}
