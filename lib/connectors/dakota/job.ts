import type { Db } from '@/lib/db';
import { config } from '@/config/deployment';
import { isLiveServer } from '@/config/ports';
import { dakotaJob } from './translate';

// Keep the local worker across Next module reloads. Only the live server's existing
// handle writes; a restart uses the database cursor, never an in-memory receipt.
const g=globalThis as typeof globalThis & {__dakotaWorkers?:WeakMap<Db,Promise<void>>};
const workers=g.__dakotaWorkers??=new WeakMap<Db,Promise<void>>();
export function dakotaLiveServer():boolean {
  return config.data.profile==='real'&&((!config.data.copyTakenAt&&isLiveServer())||Boolean(config.db.url&&process.env.POSTGRES_REHEARSAL==='1'));
}
export function resumeDakotaJob(db:Db):void {
  if(!dakotaLiveServer()||workers.has(db))return;
  {
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
}
