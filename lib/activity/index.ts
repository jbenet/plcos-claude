import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { config } from '../../config/deployment';
import type { Evidence, Logged } from './backfill';
import { readActivityInWorker } from './worker';
import { demoActivity } from './demo';
import type { ActivityData } from './types';
export type { ActivityData, ActivityPoint, ActivitySource, OriginCount, SourceSummary } from './types';

/** Fixed-size checks only. Writers call touchActivity after changes to existing raw files. */
async function fileGeneration(root: string): Promise<string> {
  return (await Promise.all(['activity/generation','activity','workflows/runs.jsonl','workflows/usage-estimates.jsonl',
    'enrich/raw','enrich/warehouse/graph-manifest.json','dakota/raw','dakota','intake'].map(async f => {
      try { const s = await stat(join(root,f)); return `${s.mtimeMs}:${s.size}`; }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return '-'; throw e; }
    }))).join('|');
}
/** Explicit root for offline invented fixtures; production uses the configured profile root. */
export function createActivityReader(options: {root:string;generation?:()=>Promise<string>;database?:(log:Logged)=>Promise<Evidence>}) {
  let cached: {key:string; value:Promise<ActivityData>} | undefined;
  return async function read(attempt = 0): Promise<ActivityData> {
    const key = await (options.generation ?? (() => fileGeneration(options.root)))();
    if (cached?.key === key) return cached.value;
    const entry = {key,value:Promise.resolve(null as unknown as ActivityData)};
    entry.value = (async () => {
      try {
        const result = await readActivityInWorker(options.root, options.database);
        const after = await (options.generation ?? (() => fileGeneration(options.root)))();
        if (after !== key) {
          if(cached === entry) cached = undefined;
          if (attempt >= 2) throw new Error('Activity changed repeatedly while loading. Retry after the current import completes.');
          return read(attempt + 1);
        }
        return result;
      } catch(e) { if(cached===entry) cached=undefined; throw e; }
    })();
    cached=entry;
    return entry.value;
  };
}
let realReader: (()=>Promise<ActivityData>) | undefined;
let demo: ActivityData | undefined;
export async function getActivity(): Promise<ActivityData> {
  if(config.data.profile==='demo') {
    const day=new Date().toISOString().slice(0,10);
    if(!demo || !demo.asOf.startsWith(day)) demo=demoActivity();
    return demo;
  }
  if (!realReader) {
    const {getDb}=await import('../db'), {readRevision}=await import('../build-cache'), {databaseActivity,databaseGeneration}=await import('./database');
    realReader=createActivityReader({root:config.data.root,
      generation:async()=>{ const db=await getDb(); return `${await fileGeneration(config.data.root)}:${await readRevision(db)}:${await databaseGeneration(db)}`; },
      database:async log=>databaseActivity(await getDb(),log)});
  }
  return realReader();
}
