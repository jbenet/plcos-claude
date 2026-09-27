import { spawn } from 'node:child_process';
import { join } from 'node:path';
import type { Db } from '@/lib/db';
import { config } from '@/config/deployment';
import { withImportLock } from '@/lib/db/advisory';
import { createImportJob,failImportJob } from './store';
import type { ImportJob,ImportKind } from './types';

// Next reloads must not spawn another local child for the same receipt.
const g=globalThis as typeof globalThis & {__importChildren?:Set<string>};
const children=g.__importChildren??=new Set<string>();
async function recordWorkerExit(db:Db,id:string,error:string):Promise<void> {
  const job=await db.one<ImportJob>("select * from platform.import_job where id=$1 and status in ('queued','running')",[id]);
  if(job&&config.db.url)await withImportLock(config.db.url,job.kind,()=>failImportJob(db,id,error));
}
export async function queueImportJob(db:Db,kind:ImportKind,actor:string,input:Record<string,unknown>={}):Promise<ImportJob> {
  const job=await createImportJob(db,kind,actor,input);
  if(job.status==='queued')launchImportJob(db,job.id);
  return job;
}
export function launchImportJob(db:Db,id:string):void {
  if(db.kind!=='postgres'||!config.db.url||children.has(id))return;
  children.add(id);
  try {
    // Only the opaque job ID goes in argv. Credentials stay inherited in the environment.
    // Ignore output: a lower-level exception must never print source records or URLs.
    const child=spawn(process.execPath,['--import','tsx',join(process.cwd(),'scripts/import-worker.ts'),id],{
      cwd:process.cwd(),env:{...process.env,PLCOS_IMPORT_WORKER:'1'},stdio:'ignore',
    });
    const stopped=(code:number|null)=>{
      children.delete(id);
      if(code===0)return;
      void recordWorkerExit(db,id,'Worker exited before completion. Review committed results before retrying.').catch(()=>{});
    };
    child.once('error',()=>stopped(null));child.once('exit',stopped);child.unref();
  } catch {
    children.delete(id);
    void recordWorkerExit(db,id,'Worker could not start. Check the local runtime, then retry.').catch(()=>{});
  }
}
/** Polling also recovers queued receipts after a server restart. Interrupted work is never silently replayed. */
export async function importJobStatus(db:Db):Promise<ImportJob[]> {
  if(db.kind!=='postgres')return [];
  const jobs=await db.query<ImportJob>(`select * from platform.import_job
    where status in ('queued','running') or created_at>clock_timestamp()-interval '1 day'
    order by (status in ('queued','running')) desc,created_at desc,id limit 30`);
  if(process.env.POSTGRES_REHEARSAL==='1')return jobs;
  for(const job of jobs) {
    if(job.status==='queued')launchImportJob(db,job.id);
    if(job.status==='running'&&config.db.url&&Date.now()-new Date(job.heartbeat_at??job.started_at??job.created_at).getTime()>60000) {
      // A stale heartbeat alone is insufficient: a busy worker still owns the database lock.
      await withImportLock(config.db.url,job.kind,()=>failImportJob(db,job.id,'Worker stopped without a completion receipt. Review committed results before retrying.'));
    }
  }
  return jobs;
}
