/** Profile the actual default page data loaders; SQL timings exclude connection queue time. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { counts, fixtureAt, fixtureId, refuseRealEnvironment, safeFixtureDirectory } from './perf4-fixture';
import { withDb } from '../lib/db';
import { openPglite } from '../lib/db/pglite';
import { withQueryTimings, type QueryTiming } from '../lib/db/timing';
import { routeInputs } from '../lib/routes-data';
import { planRoutes } from '../modules/network';
import { floorState } from '../lib/floor';
import { boardState } from '../lib/board';
import { vehicleStrategy } from '../modules/strategy/vehicle';
import { boardFor } from '../modules/plays';
import { listMoves, moveHistory } from '../modules/strategy/moves';
import { pipelineData } from '../lib/pipeline-data';

// Freeze only the request clock, keeping every stored provenance timestamp in the hash.
const WallClockDate=Date;
globalThis.Date=class extends WallClockDate {
  constructor(...args: [] | [string | number | Date] | [number, number, ...number[]]) {
    super(...(args.length ? args : [fixtureAt]) as [string | number]);
  }
  static now() { return WallClockDate.parse(fixtureAt); }
} as DateConstructor;
const args=process.argv.slice(2);
const option=(flag:string)=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];};
refuseRealEnvironment();
if(!option('--dir')) throw new Error('Usage: npm run perf4:profile -- --dir MARKED_FIXTURE [--samples 3] [--invalidate yes] [--out FILE] [--compare FILE] [--check yes]');
const dir=await safeFixtureDirectory(option('--dir')!,true);
const samples=Number(option('--samples')??3);
if(!Number.isInteger(samples)||samples<1||samples>20) throw new Error('--samples must be an integer from 1 to 20.');
const output=await safeFixtureDirectory(option('--out')??join(dir,'profile.json'),false);
const db=await openPglite(join(dir,'db'));
const normalized=(value:unknown):unknown=>{
  if(value instanceof WallClockDate) return value.toISOString();
  if(value instanceof Map) return [...value].map(([k,v])=>[k,normalized(v)]).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  if(value instanceof Set) return [...value].sort();
  if(Array.isArray(value)) return value.map(normalized);
  if(value && typeof value==='object') return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,normalized(v)]));
  return value;
};
try {
  const vehicle=(await db.one<{id:string}>(`select id from platform.vehicle where slug='neurotech'`))!;
  const pages:Record<string,()=>Promise<unknown>>={
    routes:async()=>{const inputs=await routeInputs(vehicle.id);return {inputs,search:await planRoutes('juan',fixtureId(1),3,'fund','team',undefined,{vehicleId:vehicle.id})};},
    visualizations:async()=>{const state=await floorState('neurotech');return {state,board:await boardState('neurotech',state,'line')};},
    strategy:async()=>Promise.all([vehicleStrategy(vehicle.id,new Date(fixtureAt)),boardFor(vehicle.id),listMoves(db,vehicle.id),moveHistory(db,vehicle.id)]),
    selection:()=>pipelineData(vehicle.id),pipeline:()=>pipelineData(vehicle.id),
  };
  const results=[];
  for(const [page,load] of Object.entries(pages)) {
    const runs=[];
    // Include both first-after-data-write and steady-state requests: writes invalidate buildCache.
    for(let run=0;run<=samples;run++) {
      if(run===0 || option('--invalidate')==='yes') await db.query(`update network.read_revision set revision=revision+1 where singleton`);
      const queries:QueryTiming[]=[];
      const started=performance.now();
      const value=await withDb(db,()=>withQueryTimings(q=>queries.push(q),load));
      const milliseconds=performance.now()-started;
      const hash=createHash('sha256').update(JSON.stringify(normalized(value))).digest('hex');
      runs.push({warm:run>0,milliseconds,hash,maxQueryMs:Math.max(0,...queries.map(q=>q.milliseconds)),queries:queries.map(q=>({...q,sql:q.sql.replace(/\s+/g,' ').trim()}))});
      console.log(`${page} ${run===0?'cold memo':'warm '+run}: ${milliseconds.toFixed(1)} ms; ${queries.length} queries; max ${runs.at(-1)!.maxQueryMs.toFixed(1)} ms; hash ${hash.slice(0,12)}`);
      for(const q of [...queries].sort((a,b)=>b.milliseconds-a.milliseconds).slice(0,4))console.log(`  ${q.milliseconds.toFixed(1)} ms ${q.sql.replace(/\s+/g,' ').slice(0,150)}`);
    }
    const warm=runs.slice(1);results.push({page,medianMs:[...warm].map(x=>x.milliseconds).sort((a,b)=>a-b)[Math.floor(warm.length/2)],maxQueryMs:Math.max(...warm.map(x=>x.maxQueryMs)),runs});
  }
  const result={fixture:await counts(db),samples,invalidate:option('--invalidate')==='yes',results};
  await writeFile(output,JSON.stringify(result,null,2));
  if(option('--compare')) {
    const comparison=await safeFixtureDirectory(option('--compare')!,false);
    const before=JSON.parse(await readFile(comparison,'utf8')) as typeof result;
    for(const page of results){const prior=before.results.find(x=>x.page===page.page);if(prior?.runs.at(-1)?.hash!==page.runs.at(-1)?.hash)throw new Error(`Output hash changed for ${page.page}; inspect fixture output equivalence.`);}
    console.log('Output equivalence: all five page data hashes unchanged.');
  }
  if(option('--check')==='yes') {
    for(const page of results) for(const [i,run] of page.runs.entries()) {
      if(!run.warm) continue;
      if(run.milliseconds>=1500 || run.maxQueryMs>=500)
        throw new Error(`Warm budget exceeded: ${page.page} sample ${i}: ${run.milliseconds.toFixed(1)} ms total, ${run.maxQueryMs.toFixed(1)} ms slowest query (limits: <1500 / <500 ms).`);
    }
    console.log('Performance budgets passed: every warm sample <1500 ms; every warm query <500 ms.');
  }
  console.log(`Per-query report: ${output}`);
} finally { await db.close(); }
