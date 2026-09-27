import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { config } from '../../config/deployment';
import { aggregate } from './model';
import { backfill, readLog, type Evidence, type Logged } from './backfill';
import { ActivityFileCache, atomicJson, cacheVersion, checksum } from './file-cache';
import { demoActivity } from './demo';
import { onActivityChange } from './notifications';
import type { ActivityData } from './types';
export type { ActivityData, ActivityPoint, ActivitySource, OriginCount, SourceSummary } from './types';

/** Background only. Cache writes must not invalidate themselves via activity's mtime. */
async function fileGeneration(root: string): Promise<string> {
  return (await Promise.all(['activity/generation','workflows/runs.jsonl','workflows/usage-estimates.jsonl',
    'enrich/raw','enrich/warehouse/graph-manifest.json','dakota/raw','dakota','intake'].map(async f => {
      try { const s = await stat(join(root,f)); return `${s.mtimeMs}:${s.size}`; }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return '-'; throw e; }
    }))).join('|');
}

/** Explicit root for invented fixtures; requests only hydrate a small saved aggregate.
 * refresh() is the background/test seam, never awaited by a page or an import. */
export function createActivityReader(options: {
  root: string; generation?: () => Promise<string>; database?: (log: Logged) => Promise<Evidence>;
  pollMs?: number;
}) {
  const files = new ActivityFileCache(options.root);
  const path = join(options.root, 'activity/aggregate-v1.json');
  // No snapshot yet: the epoch cannot misrepresent an empty result as a fresh scan.
  let snapshot = aggregate([], [], new Date(0).toISOString());
  let key: string | undefined, flight: Promise<ActivityData> | undefined;
  let closed = false, queued = false, dirty = 0;
  const generation = options.generation ?? (() => fileGeneration(options.root));
  const ready = (async () => {
    try {
      // Bound cold-request work even if the disposable cache is damaged/oversized.
      if ((await stat(path)).size > 8 * 1024 * 1024) return;
      const saved = JSON.parse(await readFile(path, 'utf8'));
      if (saved.version !== cacheVersion || !saved.value || saved.checksum !== checksum(saved.value) || !Array.isArray(saved.value.points)
        || !Array.isArray(saved.value.origins) || !Array.isArray(saved.value.sources)
        || !Number.isFinite(Date.parse(saved.value.asOf))) return;
      snapshot = saved.value;
      // Always validate source metadata after restart, reusing persisted digests.
    } catch { /* No usable saved aggregate: background rebuild, never a request scan. */ }
  })();
  let loaded = false;
  const refresh = (): Promise<ActivityData> => {
    if (closed) return Promise.resolve(snapshot);
    if (flight) return flight;
    flight = (async () => {
      await yieldTurn(); // Do not inherit a request's synchronous work budget.
      await ready;
      const before = await generation(), observedDirty = dirty;
      if (key === before && !dirty) return snapshot;
      if (!loaded) { await files.load(); loaded = true; }
      files.begin();
      try {
        const log = await readLog(options.root, files);
        const history = await backfill(options.root, log, files);
        const database = await options.database?.(log) ?? {points:[], origins:[]};
        await yieldTurn();
        const result = aggregate([...history.points,...database.points,...log.points],
          [...history.origins,...database.origins,...log.origins], new Date().toISOString());
        const after = await generation();
        // One pass only. A racing import leaves the last good result available and
        // schedules a later pass instead of recursing indefinitely on a request.
        if (after !== before || dirty !== observedDirty) { dirty++; return snapshot; }
        await files.save();
        await atomicJson(path, {version:cacheVersion, checksum:checksum(result), value:result});
        snapshot = result; key = before; dirty = 0;
        return snapshot;
      } finally { await files.close(); }
    })().finally(() => { flight = undefined; });
    return flight;
  };
  let nextCheck = 0;
  const schedule = (force = false) => {
    if (closed || queued || flight || (!force && Date.now() < nextCheck)) return;
    queued = true;
    setImmediate(() => {
      queued = false;
      if (closed) return;
      nextCheck = Date.now() + 1000; // GUESS: one-second coalescing/check interval.
      void refresh().catch(() => {
        // Never emit source paths/content from a background failure.
        console.warn('[activity] Refresh failed; retaining the last aggregate.');
      });
    });
  };
  const unsubscribe = onActivityChange(options.root, () => { dirty++; schedule(true); });
  const timer = options.pollMs ? setInterval(() => schedule(), options.pollMs) : undefined;
  timer?.unref();
  const read = async (): Promise<ActivityData> => {
    await ready;
    schedule();
    return snapshot;
  };
  return Object.assign(read, { refresh, stats:files.stats, close:async () => {
    closed = true; unsubscribe(); if (timer) clearInterval(timer);
    await flight?.catch(() => {}); await files.close();
  } });
}

type Reader = ReturnType<typeof createActivityReader>;
const processState = globalThis as typeof globalThis & { __capitalOsActivity?: {root:string; version:string; reader:Reader} };
function realReader(): Reader {
  const prior = processState.__capitalOsActivity;
  if (prior?.root === config.data.root && prior.version === cacheVersion) return prior.reader;
  if (prior) void prior.reader.close();
  // DB acquisition and all generation queries happen only in background callbacks.
  const reader = createActivityReader({root:config.data.root, pollMs:1000,
    generation:async () => {
      const {getDb} = await import('../db');
      const {readRevision} = await import('../build-cache');
      const {databaseGeneration} = await import('./database');
      const {withBackgroundDb} = await import('../db/scheduling');
      return withBackgroundDb(async () => {
        const db = await getDb();
        return `${await fileGeneration(config.data.root)}:${await readRevision(db)}:${await databaseGeneration(db)}`;
      });
    },
    database:async log => {
      const {getDb} = await import('../db');
      const {databaseActivity} = await import('./database');
      const {withBackgroundDb} = await import('../db/scheduling');
      return withBackgroundDb(async () => databaseActivity(await getDb(),log));
    },
  });
  processState.__capitalOsActivity = {root:config.data.root, version:cacheVersion, reader};
  return reader;
}
/** Called at server startup; lazy reads also cover dev reloads and non-Next hosts. */
export function startActivity(): void {
  if (config.data.profile === 'real' && !config.db.rehearsal) void realReader()();
}
let demo: ActivityData | undefined;
export async function getActivity(): Promise<ActivityData> {
  if(config.data.profile==='demo') {
    const day=new Date().toISOString().slice(0,10);
    if(!demo || !demo.asOf.startsWith(day)) demo=demoActivity();
    return demo;
  }
  return realReader()();
}
