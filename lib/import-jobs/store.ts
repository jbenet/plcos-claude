import type { Db, Queryable } from '@/lib/db';
import type { ImportJob, ImportKind, ImportProgress } from './types';

export const IMPORT_FAILURE = 'Import stopped. Review the last committed results before retrying; completed changes are preserved.';
export async function createImportJob(db: Db, kind: ImportKind, actor: string, input: Record<string, unknown> = {}): Promise<ImportJob> {
  return db.transaction(async tx => {
    const inserted = await tx.one<ImportJob>(`insert into platform.import_job(kind,actor,input) values($1,$2,$3::jsonb)
      on conflict(kind) where status in ('queued','running') do nothing returning *`, [kind, actor, JSON.stringify(input)]);
    if (inserted) return inserted;
    const active = await tx.one<ImportJob>("select * from platform.import_job where kind=$1 and status in ('queued','running')", [kind]);
    if (!active) throw new Error('Import finished while queueing. Retry.');
    const same = await tx.one('select 1 from platform.import_job where id=$1 and input=$2::jsonb',[active.id,JSON.stringify(input)]);
    if (!same) throw new Error('Another operation of this kind is running. Wait for it to finish.');
    return active;
  });
}
export async function failImportJob(db: Queryable, id: string, error = IMPORT_FAILURE): Promise<void> {
  await db.query(`update platform.import_job set status='failed',phase='Stopped',error=$2,finished_at=clock_timestamp()
    where id=$1 and status in ('queued','running')`, [id,error]);
}
/** Work owns a session advisory lock before entering here. No automatic replay of partial jobs. */
export async function executeImportJob(db: Db, id: string,
  work: (job: ImportJob, progress: ImportProgress) => Promise<Record<string, unknown>>,
  observe?: (job: ImportJob) => void): Promise<void> {
  const job = await db.one<ImportJob>(`update platform.import_job set status='running',phase='Starting',started_at=clock_timestamp(),heartbeat_at=clock_timestamp()
    where id=$1 and status='queued' returning *`, [id]);
  if (!job) return;
  observe?.(job);
  const progress: ImportProgress = async (phase, done=0, total=null) => {
    observe?.({...job,phase,done,total,heartbeat_at:new Date()});
    await db.query(`update platform.import_job set phase=$2,done=$3,total=$4,heartbeat_at=clock_timestamp() where id=$1 and status='running'`,[id,phase,done,total]);
  };
  // GUESS: five seconds is frequent enough for local job liveness without crowding reads.
  let heartbeatPending = false;
  const heartbeat = setInterval(() => { if (heartbeatPending) return; heartbeatPending = true; void db.query("update platform.import_job set heartbeat_at=clock_timestamp() where id=$1 and status='running'",[id]).catch(()=>{}).finally(()=>{heartbeatPending=false;}); },5000);
  heartbeat.unref();
  try {
    const result = await work(job,progress);
    await db.query(`update platform.import_job set status='completed',phase='Completed',done=coalesce(total,done),result=$2::jsonb,
      heartbeat_at=clock_timestamp(),finished_at=clock_timestamp() where id=$1 and status='running'`,[id,JSON.stringify(result)]);
  } catch (error) {
    // Driver and connector exceptions can contain records or credentials. Fixed text only.
    await failImportJob(db,id,job.kind === 'workflow' && error instanceof Error && error.message === 'Workflow refused: ANTHROPIC_API_KEY is not set.' ? error.message : IMPORT_FAILURE);
  } finally { clearInterval(heartbeat); }
}
