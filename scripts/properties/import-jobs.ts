/** Invented rows only. A real child process proves that pages and jobs do not share a JS process. */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { openTestDb } from './database';
import { migrate } from '../../lib/db/migrate';
import { createImportJob, executeImportJob, IMPORT_FAILURE } from '../../lib/import-jobs/store';
import { withImportLock } from '../../lib/db/advisory';
import type { ImportJob } from '../../lib/import-jobs/types';
import type { Check } from './harness';

export async function importJobProperties(check:Check) {
  const db=await openTestDb();
  try {
    await migrate(db);
    const actor=randomUUID();
    await db.query(`insert into platform.app_user(id,handle,name,initials,role,email) values($1,'invented-worker','Invented worker','IW','admin','worker@example.test')`,[actor]);
    const queued=async()=> (await db.one<ImportJob>("insert into platform.import_job(kind,actor) values('pursuits',$1) returning *",[actor]))!;
    const first=await queued();
    let observed=false;
    await executeImportJob(db,first.id,async(job,progress)=>{
      await progress('Invented batch',1,2);
      const row=await db.one<ImportJob>('select * from platform.import_job where id=$1',[job.id]);
      observed=row?.status==='running'&&row.phase==='Invented batch'&&row.done===1&&row.total===2;
      return {written:2};
    });
    const completed=await db.one<ImportJob>('select * from platform.import_job where id=$1',[first.id]);
    check('IMPORT JOB persists progress and a distinct completion receipt',observed&&completed?.status==='completed'&&completed.done===2&&completed.result?.written===2,'Persisted phase, numerator, denominator and final counts.');
    let reran=false;
    await executeImportJob(db,first.id,async()=>{reran=true;return {};});
    check('IMPORT JOB completed receipt cannot be executed twice',!reran,'A second execution must claim queued status atomically.');
    const failed=await queued();
    await executeImportJob(db,failed.id,async()=>{throw new Error('invented private row content');});
    const error=await db.one<ImportJob>('select * from platform.import_job where id=$1',[failed.id]);
    check('IMPORT JOB error receipts contain no raw exception data',error?.status==='failed'&&error.error===IMPORT_FAILURE,'Fixed safe message; committed work remains reviewable.');
    if(db.kind==='pglite') {
      let refused=false;
      try {await createImportJob(db,'pursuits',actor);} catch {refused=true;}
      check('IMPORT JOB PGlite cannot enqueue a separate DB writer',refused,'Existing PGlite action and Dakota paths remain in process.');
      return;
    }
    const queuedTogether=await Promise.all([createImportJob(db,'pursuits',actor),createImportJob(db,'pursuits',actor)]);
    check('IMPORT JOB concurrent clicks share one active receipt',queuedTogether[0].id===queuedTogether[1].id,'Partial unique index permits one active job per kind.');
    const dbName=(await db.one<{name:string}>('select current_database() name'))!.name;
    const url=new URL(process.env.DATABASE_URL!);url.pathname=`/${dbName}`;
    let release!:()=>void,entered!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
    const held=withImportLock(url.toString(),'pursuits',async()=>{entered();await gate;});
    await started;
    try {
      let enteredSecond=false;
      const second=await withImportLock(url.toString(),'pursuits',async()=>{enteredSecond=true;});
      check('IMPORT JOB database advisory lock admits a single writer per kind',!second.acquired&&!enteredSecond,'Independent PostgreSQL sessions contend on the same kind, independent of process globals.');
      const other=await withImportLock(url.toString(),'findings',async()=>true);
      check('IMPORT JOB unrelated kinds use independent advisory locks',other.acquired,'The guard is per kind.');
    } finally {release();await held;}
    const id=queuedTogether[0].id;
    const runChild=()=>new Promise<number|null>((resolve,reject)=>{
      const child=spawn(process.execPath,['--import','tsx','scripts/import-worker.ts',id],{
        env:{...process.env,DATABASE_URL:url.toString(),DATA_PROFILE:'demo',PLCOS_IMPORT_WORKER:'1'},stdio:'ignore',
      });
      const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Invented worker timeout'));},30000);
      child.once('error',e=>{clearTimeout(timeout);reject(e);});
      child.once('exit',code=>{clearTimeout(timeout);resolve(code);});
    });
    const exits=await Promise.all([runChild(),runChild()]);
    const childJob=await db.one<ImportJob>('select * from platform.import_job where id=$1',[id]);
    check('IMPORT JOB duplicate child launches produce one successful invented import',exits.every(code=>code===0)&&childJob?.status==='completed'&&childJob.result?.merged===0,'Two independent child pools compete for one queued receipt; no false failure. No init, seed, or connector requests.');
  } finally {await db.close();}
}
