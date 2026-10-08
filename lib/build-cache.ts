import { getDb, type Db } from '@/lib/db';
import { withSharedDb } from '@/lib/db/scheduling';

/** One revision read, never a scan of the graph or picker tables. Writes invalidate at
 * transaction commit; midnight refreshes date-sensitive picker inputs. Guards are read live. */
export async function readRevision(db: Db): Promise<string> {
  const row = await db.one<{ revision: string }>(`select revision::text || ':' || current_date::text as revision
    from network.read_revision where singleton`);
  return row!.revision;
}

/**
 * Bounded per-database memo for page inputs. Rejections are evicted; concurrent requests share the
 * work. Callers must treat returned values as immutable.
 *
 * A load the data changed under is answered but not kept (performance pass, 8 Oct 2026). It read
 * nothing older than the revision it started at, which is what an uncached page shows; keeping it
 * under that revision would be wrong, so the next request loads again. Before, such a load was thrown
 * away and run again, up to three times, then failed as "busy": while an import committed every few
 * seconds, a pipeline that takes seconds to build cost three builds and then an error page.
 */
export function buildCache<T>(load: (...args: string[]) => Promise<T>, limit = 16) {
  const databases = new WeakMap<Db, { revision: string; entries: Map<string, Promise<T>> }>();
  return async (...args: string[]): Promise<T> => {
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
        // Concurrent callers share this answer either way; only a load at one revision is kept.
        if (await readRevision(db) !== revision && state.entries.get(key) === value) state.entries.delete(key);
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
}
