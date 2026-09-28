/** Invented rows only. A real child process proves that pages and jobs do not share a JS process. */
import { spawn, spawnSync } from 'node:child_process';
import { MessageChannel } from 'node:worker_threads';
import { launchImportJob } from '../../lib/import-jobs/server';
import { connectJobDb,hostJobDb } from '../../lib/db/job-bridge';
import { randomUUID } from 'node:crypto';
import { openTestDb } from './database';
import { migrate } from '../../lib/db/migrate';
import { createImportJob, executeImportJob, IMPORT_FAILURE } from '../../lib/import-jobs/store';
import { withImportLock } from '../../lib/db/advisory';
import type { ImportJob } from '../../lib/import-jobs/types';
import type { Check } from './harness';

export async function importJobProperties(check:Check) {
  // A busy child must stop on server disconnect without waiting for its work to finish.
  {
    const child=spawn(process.execPath,['--import','tsx','--input-type=module','--eval',`
      import { requireImportParent } from './lib/import-jobs/parent.ts';
      requireImportParent();
      setInterval(() => {}, 1000);
      process.send('ready');
    `],{stdio:['ignore','ignore','ignore','ipc']});
    let ready=false;
    const code=await new Promise<number|null>((resolve,reject)=>{
      const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Invented orphan worker timeout'));},5000);
      child.once('message',()=>{ready=true;child.disconnect();});
      child.once('error',error=>{clearTimeout(timeout);reject(error);});
      child.once('exit',code=>{clearTimeout(timeout);resolve(code);});
    });
    check('IMPORT JOB worker exits when its server IPC channel closes',ready&&code===1,
      'A real child running unfinished work exits within five seconds after parent disconnect.');
    const orphan=spawnSync(process.execPath,['--import','tsx','--input-type=module','--eval',`
      import { requireImportParent } from './lib/import-jobs/parent.ts';
      requireImportParent();
      process.exit(0);
    `],{stdio:'ignore',timeout:5000});
    check('IMPORT JOB worker refuses to start without its parent channel',orphan.status===1&&!orphan.error,
      'Missing or already closed IPC fails before work starts.');
  }
  // Issue 0114: progress is a quiet mark in the rail, not a panel over every page.
  {
    const { needsLook } = await import('../../lib/import-jobs/client');
    const { readFile } = await import('node:fs/promises');
    const job=(id:string,kind:ImportJob['kind'],status:ImportJob['status'])=>({id,kind,status,phase:'',done:0,total:1,result:null,error:null});
    // Newest first, active first, as /api/import-jobs returns them.
    const look=needsLook([job('r','findings','running'),job('c','duplicates','completed'),job('f1','duplicates','failed'),job('f2','duplicates','failed'),job('f3','findings','failed'),job('p','prospects','failed')]);
    const layout=await readFile('app/layout.tsx','utf8'), rail=await readFile('components/shell/Rail.tsx','utf8');
    check('0114 a stopped import needs a look only while it is the latest of its kind',
      look.map(j=>j.id).join()==='p',
      'Four stopped retries answered by a later completed run, and a stopped run with a newer one going, are not raised; the lone stopped one is.');
    check('0114 no import panel over every page; one status mark beside the user in the rail',
      !/ImportJobs/.test(layout) && /<SystemStatus \/>/.test(rail) && !/OutboxIndicator/.test(rail),
      'The full panel lives on Developer → Status and the pages that start imports; the feedback line and import progress share the mark.');
  }
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
      const together=await Promise.all([createImportJob(db,'pursuits',actor),createImportJob(db,'pursuits',actor)]);
      check('IMPORT JOB PGlite concurrent clicks share one active receipt',together[0].id===together[1].id,'Worker threads use the one owner handle and the same partial unique index.');
      const id=together[0].id;
      launchImportJob(db,id);launchImportJob(db,id);
      const wait=async(id:string)=>{
        const until=Date.now()+30000;
        while(Date.now()<until){
          const job=await db.one<ImportJob>('select * from platform.import_job where id=$1',[id]);
          if(job&&['completed','failed'].includes(job.status))return job;
          await new Promise(resolve=>setTimeout(resolve,25));
        }
        throw new Error('Invented thread timeout');
      };
      const result=await wait(id);
      check('IMPORT JOB PGlite worker completes through the original DB owner',result.status==='completed'&&result.result?.merged===0,'Duplicate launch runs a single receipt; no second PGlite open, seed or connector request.');
      const bad=await createImportJob(db,'affinity',actor,{operation:'invented-invalid'});
      launchImportJob(db,bad.id);
      const stopped=await wait(bad.id);
      check('IMPORT JOB PGlite worker failure has a safe persisted receipt',stopped.status==='failed'&&stopped.error===IMPORT_FAILURE,'An invalid operation fails before any connector request.');
      const {port1,port2}=new MessageChannel(),closeHost=hostJobDb(db,port1),remote=connectJobDb(port2,'pglite');
      await db.exec('create table public.thread_atomic (value integer)');
      await remote.transaction(async tx=>{await tx.query('insert into public.thread_atomic values (1)');});
      let entered!:()=>void;
      const begun=new Promise<void>(resolve=>{entered=resolve;});
      const abandoned=remote.transaction(async tx=>{await tx.query('insert into public.thread_atomic values (2)');entered();await new Promise(resolve=>setTimeout(resolve,25));});
      const outcome=abandoned.catch(()=>{});
      await begun;closeHost();await outcome;
      const rows=await db.query<{value:number}>('select value from public.thread_atomic');
      check('IMPORT JOB disconnected transaction rolls back without undoing prior commits',rows.length===1&&rows[0]?.value===1,'A worker port loss releases the transaction and preserves only committed work.');
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
        env:{...process.env,DATABASE_URL:url.toString(),DATA_PROFILE:'demo',PLCOS_IMPORT_WORKER:'1'},stdio:['ignore','ignore','ignore','ipc'],
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
