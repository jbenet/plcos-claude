/**
 * Invented-data, disposable local HTTP harness, not a Next production-page benchmark.
 * node --import tsx scripts/responsiveness.ts [--baseline] [--seconds=60] [--query-only]
 * --dispatch measures cross-thread dispatch when a sandbox forbids sockets; it is not HTTP.
 * The SQL loop burns CPU for the requested duration, reproducing synchronous WASM work.
 * Probes run in another thread so a frozen server cannot hide the waiting requests.
 */
import { createServer } from 'node:http';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';

if (process.env.DATA_PROFILE === 'real') throw new Error('Responsiveness benchmark refuses real profile.');
process.env.DATA_PROFILE='demo';
delete process.env.DATABASE_URL;
const dispatch=process.argv.includes('--dispatch');
const baseline=process.argv.includes('--baseline');
const seconds=Number(process.argv.find(x=>x.startsWith('--seconds='))?.split('=')[1]??60);
if (!Number.isFinite(seconds)||seconds<0.1||seconds>120) throw new Error('Expected 0.1–120 seconds.');
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const percentile=(values:number[],p:number)=>values.slice().sort((a,b)=>a-b)[Math.min(values.length-1,Math.ceil(values.length*p)-1)]??0;
const root=await mkdtemp(join(tmpdir(),'plcos-responsiveness-'));
const {openPglite}=await import('../lib/db/pglite');
const {openMainThreadBaseline}=await import('../lib/db/responsiveness-baseline');
const db=await (baseline?openMainThreadBaseline:openPglite)(join(root,'db'));
const server=createServer((req,res)=>{
  if(req.url==='/trivial') {res.end('ok');return;}
  if(req.url==='/journal'&&req.method==='POST') {
    void appendFile(join(root,'feedback.jsonl'),JSON.stringify({at:Date.now(),text:'invented feedback'})+'\n').then(()=>res.end('ok'),()=>{res.statusCode=500;res.end('failed');});return;
  }
  res.statusCode=404;res.end();
});
if(!dispatch) {server.listen(0,'127.0.0.1');await once(server,'listening');}
const port=dispatch?undefined:(server.address() as {port:number}).port;
type ProbeResult={samples:{trivial:number[];journal:number[]};errors:number};
async function measure(name:string,work:()=>Promise<unknown>) {
  const worker=new Worker(join(process.cwd(),'scripts/responsiveness-probe.cjs'),{workerData:{port,dispatch}});
  await once(worker,'message');
  if(dispatch) worker.on('message',(message:{id?:number;route?:string})=>{
    if(!message.id)return;
    if(message.route==='trivial')worker.postMessage({id:message.id});
    else void appendFile(join(root,'feedback.jsonl'),JSON.stringify({at:Date.now(),text:'invented feedback'})+'\n').then(()=>worker.postMessage({id:message.id}),()=>worker.postMessage({id:message.id,error:true}));
  });
  const histogram=monitorEventLoopDelay({resolution:10});histogram.enable();
  await delay(150);
  const start=performance.now();
  let output:unknown, failure:unknown;
  try {output=await work();} catch(error) {failure=error;} finally {await delay(150);histogram.disable();}
  const resultPromise=new Promise<ProbeResult>(resolve=>worker.on('message',(message:ProbeResult)=>{if(message.samples)resolve(message);}));worker.postMessage('stop');
  const result=await resultPromise;await worker.terminate();
  const metrics={transport:dispatch?'thread dispatch (socket sandbox prohibited HTTP)':'HTTP',phase:name,mode:baseline?'main-thread baseline':'worker',elapsedMs:Math.round(performance.now()-start),
    loopP99Ms:+(histogram.percentile(99)/1e6).toFixed(2),loopMaxMs:+(histogram.max/1e6).toFixed(2),errors:result.errors,
    trivial:{samples:result.samples.trivial.length,p99Ms:+percentile(result.samples.trivial,.99).toFixed(2),maxMs:+Math.max(...result.samples.trivial).toFixed(2)},
    journal:{samples:result.samples.journal.length,p99Ms:+percentile(result.samples.journal,.99).toFixed(2),maxMs:+Math.max(...result.samples.journal).toFixed(2)}};
  console.log(JSON.stringify({...metrics,...(output?{result:output}:{})}));
  if(failure)throw failure;
  if(result.errors)throw new Error('Probe requests failed.');
  if(!baseline&&metrics.trivial.p99Ms>=(name==='query'?50:200))throw new Error(`${name} trivial p99 exceeded budget.`);
  if(!baseline&&name==='query'&&metrics.trivial.maxMs>=50)throw new Error('Query trivial maximum exceeded 50 ms budget.');
  if(!baseline&&metrics.journal.p99Ms>=200)throw new Error(`${name} DB-free journal p99 exceeded budget.`);
}
try {
  await measure('query',async()=>{await db.exec(`do $$ declare deadline timestamptz:=clock_timestamp()+interval '${seconds} seconds'; n bigint:=0; begin while clock_timestamp()<deadline loop n:=n+1; end loop; end $$`);});
  if(!process.argv.includes('--query-only')) {
    const {migrate}=await import('../lib/db/migrate');await migrate(db);
    const actor=randomUUID();
    await db.query(`insert into platform.app_user(id,handle,name,initials,role,email) values($1,'benchmark','Invented benchmark','IB','admin','benchmark@example.test')`,[actor]);
    const enrich=join(root,'enrich');await mkdir(join(enrich,'raw'),{recursive:true});
    const ids=Array.from({length:1100},()=>randomUUID());
    await db.query(`insert into identity.entity(entity_id,entity_type,display_name) select id::uuid,'person'::identity.entity_type,'Invented benchmark person '||ordinality from unnest($1::text[]) with ordinality as x(id,ordinality)`,[ids]);
    const paths:string[]=[];
    for(let i=0;i<ids.length;i++) {
      const finding={key:ids[i],name:`Invented benchmark person ${i+1}`,researched:{at:'2026-09-27',by:'invented fixture',workflow:'W1',version:'1.0'},identity:{match:'confirmed',basis:'Invented fixture'},facts:[],profile:{summary:'Invented fixture profile',investorType:'unknown'}};
      await writeFile(join(enrich,'raw',`${ids[i]}.json`),JSON.stringify(finding));
      paths.push(JSON.stringify({lp:ids[i],other:{name:`Invented benchmark person ${(i+1)%ids.length+1}`,key:ids[(i+1)%ids.length],type:'lp'},kind:'other',tier:'D',basis:'Invented discovery clue. '+ 'x'.repeat(Math.ceil(18_000_000/ids.length))}));
    }
    const connections=paths.join('\n');await writeFile(join(enrich,'connections.jsonl'),connections);
    console.log(JSON.stringify({fixture:{researchFiles:ids.length,connectionBytes:Buffer.byteLength(connections),connectionRecords:paths.length}}));
    process.env.ENRICH_DIR=enrich;
    const {withDb}=await import('../lib/db');
    const {createImportJob,executeImportJob}=await import('../lib/import-jobs/store');
    const {launchImportJob,importJobStatus}=await import('../lib/import-jobs/server');
    const job=await createImportJob(db,'findings',actor);
    await measure('import',async()=> {
      if(baseline) {
        const {runImportOperation}=await import('../lib/import-jobs/operations');
        await withDb(db,()=>executeImportJob(db,job.id,runImportOperation.bind(null,db)));
      } else {
        launchImportJob(db,job.id,{demoRoot:root});
        const deadline=Date.now()+300000;
        while(Date.now()<deadline) {
          const current=(await importJobStatus(db)).find(row=>row.id===job.id);
          if(current?.status==='completed'||current?.status==='failed')break;
          await delay(50);
        }
      }
      const receipt=await db.one<import('../lib/import-jobs/types').ImportJob>('select * from platform.import_job where id=$1',[job.id]);
      if(receipt?.status!=='completed')throw new Error(`Fixture import failed: ${receipt?.error??receipt?.status}`);
      if(receipt.result?.mapped!==1100||receipt.result?.paths!==1100)throw new Error(`Fixture import count mismatch: ${JSON.stringify(receipt.result)}`);
      return receipt.result;
    });
  }
} finally {
  if(server.listening)await new Promise<void>(resolve=>server.close(()=>resolve()));
  await db.close();await rm(root,{recursive:true,force:true});
}
