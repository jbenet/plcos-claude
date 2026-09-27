/** Invented corpus only. Run: node --import tsx scripts/bench-activity-responsiveness.ts
 * Before reproduces the former main-thread activity reader; after uses its worker.
 * This measures event-loop lag, not HTTP latency. Both produce identical daily counts.
 */
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {performance,monitorEventLoopDelay} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {backfill,readLog} from '../lib/activity/backfill';
import {aggregate} from '../lib/activity/model';
import {readActivityInWorker} from '../lib/activity/worker';
async function main(){
 if(process.env.DATA_PROFILE==='real')throw new Error('Activity benchmark refuses real profile.');
 const root=await mkdtemp(join(tmpdir(),'plcos-activity-scale-'));
 try {
 const raw=join(root,'enrich/raw'); await mkdir(raw,{recursive:true});
 const at='2026-09-27T12:00:00Z';
 const row=JSON.stringify({researched:{at},queries:['invented demo fixture'],facts:[{source:{url:'https://example.org/fixture'}}]});
 for(let n=0;n<1100;n+=50)await Promise.all(Array.from({length:50},(_,i)=>writeFile(join(raw,`demo-${n+i}.json`),row)));
 const connections=Array.from({length:45000},(_,i)=>({source:'https://example.org/fixture/'+i,description:'Invented fixture '.repeat(21)}));
 const large=JSON.stringify({researched:{at},connections});
 await writeFile(join(raw,'demo-connections.json'),large);
 let baseline: string | undefined;
 for(const mode of ['before','after']){
  const h=monitorEventLoopDelay({resolution:1}); h.enable(); await delay(20); h.reset();
  let maxTick=0,last=performance.now();const timer=setInterval(()=>{const now=performance.now();maxTick=Math.max(maxTick,now-last);last=now;},2);
  const began=performance.now();
  let result;
  if(mode==='before'){const log=await readLog(root),history=await backfill(root,log);result=aggregate([...history.points,...log.points],[...history.origins,...log.origins],new Date().toISOString());}
  else result=await readActivityInWorker(root);
  const totalMs=performance.now()-began;await delay(20);clearInterval(timer);h.disable();
  console.log(JSON.stringify({mode,files:1101,largeBytes:Buffer.byteLength(large),totalMs,p99LagMs:h.percentile(99)/1e6,maxLagMs:h.max/1e6,maxTickMs:maxTick}));
  const counts=JSON.stringify({...result,asOf:''});
  if(mode==='before')baseline=counts;
  else {
   if(counts!==baseline)throw new Error('Activity worker changed the aggregate.');
   if(h.percentile(99)/1e6>=200)throw new Error('Activity worker exceeded the requested 200 ms p99 lag budget.');
  }
 }
 }finally{await rm(root,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
