import { Worker } from 'node:worker_threads';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { enrichmentFileSummary } from './file-summary';
type Summary=Awaited<ReturnType<typeof enrichmentFileSummary>>;

/**
 * What the summary reads, as names, sizes and modification times: the enrichment folder's own files (triage,
 * connectors, quality rounds, the research set and candidates), every finding in raw/ and the names in strategy/.
 * Any added, removed, rewritten or touched file changes it. Reads no file's contents.
 */
async function filesSignature(dir:string):Promise<string> {
  const listing=async(d:string,stats:boolean):Promise<string>=>{
    let names:string[];
    try {names=(await readdir(d)).sort();} catch {return '-';}
    if(!stats) return names.join('/');
    const rows=await Promise.all(names.map(async(name)=>{
      try {const s=await stat(join(d,name),{bigint:true}); return `${name}:${s.size}:${s.mtimeNs}:${s.ino}`;}
      catch {return `${name}:?`;}
    }));
    return rows.join('/');
  };
  const [top,raw,strategy]=await Promise.all([listing(dir,true),listing(join(dir,'raw'),true),listing(join(dir,'strategy'),false)]);
  return `${top}\n${raw}\n${strategy}`;
}

/**
 * The last summary per folder, kept while its files are unchanged (performance pass, 17 Oct 2026). Starting the
 * worker compiles the summary's TypeScript every time: about 240 ms on each view of Developer › Enrichment, with an
 * empty folder. A view now spawns it only when a file it reads has changed. The value is shared: treat it as immutable.
 */
const g=globalThis as typeof globalThis&{__capitalOsEnrichSummary?:Map<string,{signature:string;value:Summary}>};
const kept=g.__capitalOsEnrichSummary??=new Map();

function runWorker(dir:string):Promise<Summary> {
  const worker=new Worker(join(process.cwd(),'scripts/enrichment-summary-worker.mjs'),{workerData:{dir},execArgv:[]});
  return new Promise<Summary>((resolve,reject)=>{
    worker.once('error',()=>reject(new Error('Enrichment file summary is unavailable.')));
    worker.once('exit',()=>reject(new Error('Enrichment summary worker stopped.')));
    worker.once('message',(message:{result?:Summary;error?:boolean})=>message.result?resolve(message.result):reject(new Error('Enrichment file summary is unavailable.')));
  }).finally(()=>worker.terminate());
}

export async function readEnrichmentSummary(dir:string):Promise<Summary> {
  // Taken before the read: a file changed while the worker reads gives a newer value under an older signature,
  // which the next view's signature no longer matches, so it reads again.
  const signature=await filesSignature(dir);
  const prior=kept.get(dir);
  if(prior&&prior.signature===signature) return prior.value;
  const value=await runWorker(dir);
  kept.delete(dir);
  kept.set(dir,{signature,value});
  while(kept.size>4) kept.delete(kept.keys().next().value!);
  return value;
}
