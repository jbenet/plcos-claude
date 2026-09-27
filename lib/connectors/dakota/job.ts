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
  return config.data.profile==='real'&&!config.data.copyTakenAt&&readLayout().role==='live';
}
export function resumeDakotaJob(db:Db):void {
  if(!dakotaLiveServer()||workers.has(db))return;
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
