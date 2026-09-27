import type { Db } from '@/lib/db';
import { withBackgroundDb } from '@/lib/db/scheduling';
import { config } from '@/config/deployment';
import { readLayout } from '@/config/ports';
import { readReplicas } from './replica';
import { dakotaJob, translateDakota } from './translate';

// Keep the local worker across Next module reloads. Only the live server's existing
// handle writes; a restart uses the database cursor, never an in-memory receipt.
const g=globalThis as typeof globalThis & {__dakotaWorkers?:WeakMap<Db,Promise<void>>};
const workers=g.__dakotaWorkers??=new WeakMap<Db,Promise<void>>();
export function dakotaLiveServer():boolean {
  return config.data.profile==='real'&&((!config.data.copyTakenAt&&readLayout().role==='live')||Boolean(config.db.url&&process.env.POSTGRES_REHEARSAL==='1'));
}
export function resumeDakotaJob(db:Db):void {
  if(!dakotaLiveServer()||workers.has(db))return;
  if(db.kind==='postgres') {
    if(process.env.POSTGRES_REHEARSAL==='1')return;
    const queued=(async()=>{
      const job=await dakotaJob(db);
      if(job?.status==='queued') {
        const receipt=await db.one<{status:string}>("select status from platform.import_job where kind='dakota' order by created_at desc limit 1");
        if(receipt&&['failed','completed'].includes(receipt.status))return;
        const {queueImportJob}=await import('@/lib/import-jobs/server');
        await queueImportJob(db,'dakota',job.actor);
      }
    })();
    workers.set(db,queued);
    void queued.catch(()=>{}).finally(()=>workers.delete(db));
    return;
  }
  const worker=withBackgroundDb(async()=>{
    const job=await dakotaJob(db);
    if(!job||!['queued','running'].includes(job.status))return;
    try {
      const replicas=await readReplicas('data/real/dakota/raw');
      if(!replicas.length)throw new Error('No complete replicas.');
      await translateDakota(db,job.actor,replicas);
    } catch {
      // Never persist or print an exception that could include a source record.
      await db.query(`update dakota.translation_job set status='failed',error=$1 where id=$2 and status<>'completed'`,
        ['Dakota import stopped. Check the complete local replicas, then resume from the last committed batch.',job.id]);
    }
  });
  workers.set(db,worker);
  void worker.catch(()=>{/* DB shutdown can prevent an error receipt; the persisted cursor remains resumable. */})
    .finally(()=>workers.delete(db));
}
