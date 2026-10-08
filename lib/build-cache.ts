import { AsyncLocalStorage } from 'node:async_hooks';
import { getDb, type Db } from '@/lib/db';
import { withSharedDb } from '@/lib/db/scheduling';

/** One revision read, never a scan of the graph or picker tables. Writes invalidate at
 * transaction commit; midnight refreshes date-sensitive picker inputs. Guards are read live. */
export async function readRevision(db: Db): Promise<string> {
  return (await readRevisions(db)).revision;
}

/** The read revision, and the part of it only people's writes move (network 017: not an import worker's). */
async function readRevisions(db: Db): Promise<{ revision: string; foreground: string }> {
  const row = await db.one<{ revision: string; foreground: string }>(`select revision::text || ':' || current_date::text as revision,
    foreground::text || ':' || current_date::text as foreground from network.read_revision where singleton`);
  return row!;
}

// GUESS — the oldest build a page may answer with while only imports have written since. Each such
// answer starts a rebuild behind it, so in practice a build is as old as one rebuild; this bounds the
// case where rebuilds keep failing.
export const BACKGROUND_STALE_MS = 10 * 60_000;

/** Set while a build runs: an input it reads from another cache is current, never an earlier build,
 * or a rebuild behind an answer would keep the older inputs under the new revision. */
const building = new AsyncLocalStorage<true>();

interface Built<T> { value: T; foreground: string; started: number }
interface State<T> {
  revision: string;
  /** Loads at `revision`, shared by concurrent callers. */
  entries: Map<string, Promise<T>>;
  /** The newest finished load per key, whatever revision it ran at. */
  latest: Map<string, Built<T>>;
  /** Rebuilds running behind an answer from `latest`. */
  behind: Set<string>;
}

/**
 * Bounded per-database memo for page inputs. Rejections are evicted; concurrent requests share the
 * work. Callers must treat returned values as immutable.
 *
 * A load the data changed under is answered but not kept (performance pass, 8 Oct 2026). It read
 * nothing older than the revision it started at, which is what an uncached page shows; keeping it
 * under that revision would be wrong, so the next request loads again. Before, such a load was thrown
 * away and run again, up to three times, then failed as "busy".
 *
 * While only import workers have written since the last build (the foreground revision has not moved,
 * network 017), the cache answers with that build at once and rebuilds behind it, so a page stays fast
 * through a half-hour import that commits every few seconds; the import's results show a rebuild later.
 * A person's own change moves the foreground revision, so the page they open next is rebuilt first.
 */
export function buildCache<T>(load: (...args: string[]) => Promise<T>, limit = 16) {
  const databases = new WeakMap<Db, State<T>>();
  const keep = (state: State<T>, key: string, built: Built<T>) => {
    const prior = state.latest.get(key);
    if (prior && prior.started > built.started) return;
    state.latest.delete(key);
    state.latest.set(key, built);
    if (state.latest.size > limit) state.latest.delete(state.latest.keys().next().value!);
  };
  /**
   * One load at `revision`. A load in front is shared through `entries` while it runs; one behind an
   * answer is not, so the next caller also gets the quick answer. Either is kept for exact hits only
   * if the revision still holds when it ends.
   */
  const run = (db: Db, state: State<T>, key: string, args: string[], revision: string, foreground: string, behind = false): Promise<T> => {
    const started = Date.now();
    // Shared with whoever asks next, so it never runs at maintenance priority (withSharedDb).
    const value: Promise<T> = withSharedDb(() => Promise.resolve().then(async () => {
      try {
        const result = await building.run(true, () => load(...args));
        keep(state, key, { value: result, foreground, started });
        const holds = (await readRevision(db)) === revision && state.revision === revision;
        if (behind && holds && !state.entries.has(key)) state.entries.set(key, Promise.resolve(result));
        if (!holds && state.entries.get(key) === value) state.entries.delete(key);
        return result;
      } catch (error) {
        if (state.entries.get(key) === value) state.entries.delete(key);
        throw error;
      }
    }));
    if (!behind && state.revision === revision) {
      state.entries.set(key, value);
      if (state.entries.size > limit) state.entries.delete(state.entries.keys().next().value!);
    }
    return value;
  };
  const answer = async (args: string[], recentMs: number | null): Promise<T> => {
    const db = await getDb();
    const { revision, foreground } = await readRevisions(db);
    let state = databases.get(db);
    if (!state) { state = { revision, entries: new Map(), latest: new Map(), behind: new Set() }; databases.set(db, state); }
    if (state.revision !== revision) { state.revision = revision; state.entries = new Map(); }
    const key = JSON.stringify(args), prior = state.entries.get(key);
    const last = building.getStore() ? undefined : state.latest.get(key);
    // A recent read does not wait for a build already running in front; it starts none of its own then.
    if (prior && !(recentMs !== null && last && Date.now() - last.started < recentMs)) return prior;
    const quick = last && (last.foreground === foreground ? Date.now() - last.started < BACKGROUND_STALE_MS
      : recentMs !== null && Date.now() - last.started < recentMs);
    if (last && quick) {
      if (!prior && !state.behind.has(key)) {
        state.behind.add(key);
        const s = state;
        void run(db, s, key, args, revision, foreground, true).catch(() => {}).finally(() => s.behind.delete(key));
      }
      return last.value;
    }
    return run(db, state, key, args, revision, foreground);
  };
  /** The current build, as above. */
  const get = (...args: string[]) => answer(args, null);
  /**
   * For a read that may lag a person's own last change by one view: the newest build if it began within
   * `ms`, whatever has been written since, with a rebuild behind it; otherwise as `get`.
   */
  get.recent = (ms: number, ...args: string[]) => answer(args, ms);
  return get;
}
