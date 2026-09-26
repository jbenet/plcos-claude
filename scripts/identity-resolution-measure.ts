/** Aggregate-only measurement on a disposable APFS clone. Never opens the live database. */
import { spawnSync } from 'node:child_process';
import { mkdir, realpath, rm, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { openPglite } from '../lib/db/pglite';
import { migrate } from '../lib/db/migrate';
import { withDb } from '../lib/db';
import { resolveIdentities } from '../modules/identity/resolution';
import { identityEvidence } from '../modules/identity/resolution-input';
import { readNetworkNodeInput } from '../modules/network/nodes';
import { readProspectFiles } from '../lib/enrich/prospects';
import { planRoutes } from '../modules/network/service';

async function main(){
  const source=await realpath(resolve('../plcos-data/real'));
  const root=resolve('data/real');await mkdir(root,{recursive:true});
  if((await lstat(root)).isSymbolicLink()||await realpath(root)===source)throw new Error('Measurement requires a worktree-local real-data directory');
  const copy=join(root,`idres-measure-${process.pid}`);await mkdir(copy);
  let db:Awaited<ReturnType<typeof openPglite>>|undefined;
  try{
    for(const name of ['database','enrich']){
      const result=spawnSync('/bin/cp',['-cR',join(source,name),join(copy,name)],{stdio:'ignore'});
      if(result.status!==0)throw new Error('APFS clone failed');
    }
    db=await openPglite(join(copy,'database'));await migrate(db);
    await withDb(db,async()=>{
      const targets=await db!.query<{id:string;kind:string}>(`select distinct p.entity_id::text id,v.kind::text from strategy.pursuit p join platform.vehicle v on v.id=p.vehicle_id order by id,kind`);
      const at=new Date();
      console.log(JSON.stringify({phase:'before',total:targets.length}));
      const measure=async()=>{
        const result=new Map<string,{exists:boolean;score:number}>();let done=0;
        for(const t of targets){const r=await planRoutes('',t.id,3,t.kind,'team',at);
          const routes=r?.routes.filter(x=>x.verdict==='recommend')??[];
          result.set(`${t.id}:${t.kind}`,{exists:routes.length>0,score:Math.max(0,...routes.map(x=>x.score?.value ?? 0))});
          if(++done%100===0)console.log(JSON.stringify({measured:done,total:targets.length}));}
        return result;
      };
      const countsOnly=process.argv.includes('--counts-only');
      const before=countsOnly?new Map<string,{exists:boolean;score:number}>():await measure();console.log(JSON.stringify({phase:'resolve'}));const start=performance.now();
      let lastBeat=performance.now(),maximumLoopDelayMs=0;
      const heartbeat=setInterval(()=>{const now=performance.now();maximumLoopDelayMs=Math.max(maximumLoopDelayMs,now-lastBeat-10);lastBeat=now;},10);heartbeat.unref();
      const inputs=identityEvidence(await readNetworkNodeInput(join(copy,'enrich')),await readProspectFiles(join(copy,'enrich/prospects')));
      console.log(JSON.stringify({phase:'inputs',count:inputs.length}));
      const counts=await resolveIdentities(db!,inputs,(phase,count)=>console.log(JSON.stringify({phase,count})));
      const milliseconds=Math.round(performance.now()-start);clearInterval(heartbeat);maximumLoopDelayMs=Math.round(maximumLoopDelayMs);
      console.log(JSON.stringify({phase:'after',counts,milliseconds,maximumLoopDelayMs}));
      // Measure corroborated redirects separately from speculative name-only bridges.
      await db!.query('update identity.possible_match set active=false where active');
      if(countsOnly)return;
      const after=await measure();
      const gained=new Set<string>(),stronger=new Set<string>();
      for(const t of targets){const key=`${t.id}:${t.kind}`,a=before.get(key)!,b=after.get(key)!;if(!a.exists&&b.exists)gained.add(t.id);else if(a.exists&&b.score>a.score+1e-9)stronger.add(t.id);}
      console.log(JSON.stringify({counts,milliseconds,maximumLoopDelayMs,lpEntities:new Set(targets.map(t=>t.id)).size,vehicleSearches:targets.length,gainRoute:gained.size,strongerBestRoute:stronger.size,routeMetric:'recommended best route score.value; same date, all pursuit entities; no graph rebuild; name-only bridges excluded from route gains'},null,2));
    });
  }finally{if(db)await db.close();await rm(copy,{recursive:true,force:true});console.log('Disposable real-data clone deleted.');}
}
main().catch(()=>{console.error('Identity measurement failed; no record details printed.');process.exitCode=1;});
