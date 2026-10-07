import { spawn } from 'node:child_process';
import { MessageChannel,Worker } from 'node:worker_threads';
import { join } from 'node:path';
import type { Db } from '@/lib/db';
import { config } from '@/config/deployment';
import { withImportLock } from '@/lib/db/advisory';
import { hostJobDb } from '@/lib/db/job-bridge';
import { createImportJob,failImportJob,IMPORT_FAILURE } from './store';
import type { ImportJob,ImportKind } from './types';

// Both handles and receipts survive Next module reloads. Workers belong to this process.
const g=globalThis as typeof globalThis & {__importChildren?:Set<string>;__importProgress?:Map<string,ImportJob>;__importFollowUps?:Map<string,{actor:string;input:Record<string,unknown>}>};
const children=g.__importChildren??=new Set<string>();
const progress=g.__importProgress??=new Map<string,ImportJob>();
// An import asked for while one of its kind runs (a push mid-import, 7 Oct 2026): run once more after it, so the
// new files are read. In memory: a restart loses it, and the restart's recovery or the next push queues anew.
const followUps=g.__importFollowUps??=new Map<string,{actor:string;input:Record<string,unknown>}>();
/** Queue `kind` again when its running job ends, here or after a restart's recovery; one pending run per kind. */
export function importAfterRunning(kind:ImportKind,actor:string,input:Record<string,unknown>={}):void {followUps.set(kind,{actor,input});}
async function runFollowUp(db:Db,id:string):Promise<void> {
  const job=await db.one<Pick<ImportJob,'kind'>>('select kind from platform.import_job where id=$1',[id]);
  const next=job&&followUps.get(job.kind);
  if(!job||!next)return;
  followUps.delete(job.kind);
  await queueImportJob(db,job.kind as ImportKind,next.actor,next.input).catch(()=>{followUps.set(job.kind,next);});
}
function remember(job:ImportJob):void {
  progress.set(job.id,job);
  // Active work stays visible; retain at most thirty completed receipts between polls.
  const completed=[...progress.values()].filter(j=>!['queued','running'].includes(j.status))
    .sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime());
  for(const stale of completed.slice(30))progress.delete(stale.id);
}
async function recordWorkerExit(db:Db,id:string,error:string):Promise<void> {
  const job=await db.one<ImportJob>("select * from platform.import_job where id=$1 and status in ('queued','running')",[id]);
  if(!job)return;
  if(db.kind==='postgres'&&config.db.url)await withImportLock(config.db.url,job.kind,()=>failImportJob(db,id,error));
  else {await failImportJob(db,id,error);remember({...job,status:'failed',phase:'Stopped',error});}
}
/** A stopped job's receipt goes to the server log too: phase, error class and code, never record content.
 * The worker's own stdout and stderr stay discarded, because a driver error printed there can quote rows. */
async function logStopped(db:Db,id:string):Promise<void> {
  const job=await db.one<Pick<ImportJob,'kind'|'status'|'error'>>('select kind,status,error from platform.import_job where id=$1',[id]);
  if(job?.status==='failed')console.error(`[import] ${job.kind} job ${id.slice(0,8)} failed: ${job.error??IMPORT_FAILURE}`);
}
export async function queueImportJob(db:Db,kind:ImportKind,actor:string,input:Record<string,unknown>={}):Promise<ImportJob> {
  const job=await createImportJob(db,kind,actor,input);
  if(db.kind==='pglite')remember(job);
  if(job.status==='queued')launchImportJob(db,job.id);
  return job;
}
export function launchImportJob(db:Db,id:string,options?:{demoRoot?:string}):void {
  if(children.has(id))return;
  if(options?.demoRoot&&config.data.profile!=='demo')throw new Error('Fixture override requires demo.');
  children.add(id);
  let dispose=()=>{};
  let didStop=false;
  const stopped=(code:number|null)=>{
    if(didStop)return;didStop=true;
    dispose();children.delete(id);
    if(code===0){void logStopped(db,id).then(()=>runFollowUp(db,id)).catch(()=>{});return;}
    void recordWorkerExit(db,id,'Worker exited before completion. Review committed results before retrying.').then(()=>logStopped(db,id)).then(()=>runFollowUp(db,id)).catch(()=>{});
  };
  try {
    if(db.kind==='pglite') {
      const {port1,port2}=new MessageChannel();
      dispose=hostJobDb(db,port1);
      const worker=new Worker(join(process.cwd(),'scripts/import-thread.mjs'),{
        workerData:{id,port:port2,demoRoot:options?.demoRoot},transferList:[port2],stdout:true,stderr:true,execArgv:[],
      });
      // Never expose source rows from lower-level exceptions through console output.
      worker.stdout.resume();worker.stderr.resume();
      worker.on('message',({job}:{job?:ImportJob})=>{if(job?.id===id)remember(job);});
      worker.once('error',()=>stopped(null));worker.once('exit',stopped);
      return;
    }
    if(!config.db.url)throw new Error('Missing Postgres configuration.');
    const child=spawn(process.execPath,['--import','tsx',join(process.cwd(),'scripts/import-worker.ts'),id],{
      cwd:process.cwd(),env:{...process.env,PLCOS_IMPORT_WORKER:'1'},stdio:['ignore','ignore','ignore','ipc'],
    });
    child.once('error',()=>stopped(null));child.once('exit',stopped);child.channel?.unref();child.unref();
  } catch {
    dispose();children.delete(id);
    void recordWorkerExit(db,id,'Worker could not start. Check the local runtime, then retry.').catch(()=>{});
  }
}
/** The parent mirror remains readable while the single PGlite connection runs a transaction. */
export function activeImportProgress():ImportJob[]|null {
  if(!children.size||config.db.url)return null;
  return [...progress.values()].sort((a,b)=>Number(['queued','running'].includes(b.status))-Number(['queued','running'].includes(a.status))||new Date(b.created_at).getTime()-new Date(a.created_at).getTime()).slice(0,30);
}
/** Read progress without starting work or changing a job; safe for HTTP GET. */
export async function importJobSnapshot(db:Db):Promise<ImportJob[]> {
  const mirrored=activeImportProgress();if(mirrored)return mirrored;
  const jobs=await db.query<ImportJob>(`select * from platform.import_job
    where status in ('queued','running') or created_at>clock_timestamp()-interval '1 day'
    order by (status in ('queued','running')) desc,created_at desc,id limit 30`);
  return jobs;
}

/**
 * A findings import reads every pushed file again from the start, as each push's import does, so one a restart
 * stopped is queued again (7 Oct 2026: every deploy restarted the server mid-import, and no findings import had
 * finished all day). Its receipt says so. Other kinds still wait for a person.
 */
const REPLAYED:readonly string[]=['findings'];
export const stoppedReplayed=(kind:string)=>`Worker stopped without a completion receipt (the server restarted). A new ${kind} import was queued to read the files again.`;

/** Server lifecycle recovery. Interrupted running work is not replayed, except the kinds in REPLAYED. */
export async function importJobStatus(db:Db,o:{replayed?:readonly string[]}={}):Promise<ImportJob[]> {
  const mirrored=activeImportProgress();if(mirrored)return mirrored;
  const jobs=await importJobSnapshot(db);
  if(process.env.POSTGRES_REHEARSAL==='1')return jobs;
  for(const job of jobs) {
    if(db.kind==='pglite')remember(job);
    if(job.status==='queued')launchImportJob(db,job.id);
    if(job.status==='running'&&Date.now()-new Date(job.heartbeat_at??job.started_at??job.created_at).getTime()>60000) {
      const replay=(o.replayed??REPLAYED).includes(job.kind);
      const error=replay?stoppedReplayed(job.kind):'Worker stopped without a completion receipt. Review committed results before retrying.';
      let failed=false;
      if(db.kind==='postgres'&&config.db.url)failed=(await withImportLock(config.db.url,job.kind,()=>failImportJob(db,job.id,error))).acquired;
      else if(!children.has(job.id)){await recordWorkerExit(db,job.id,error);failed=true;}
      if(failed&&replay&&!followUps.has(job.kind))followUps.set(job.kind,{actor:job.actor,input:job.input??{}});
      await runFollowUp(db,job.id);
    }
  }
  return jobs;
}
