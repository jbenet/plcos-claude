import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import type { enrichmentFileSummary } from './file-summary';
type Summary=Awaited<ReturnType<typeof enrichmentFileSummary>>;
export async function readEnrichmentSummary(dir:string):Promise<Summary> {
  const worker=new Worker(join(process.cwd(),'scripts/enrichment-summary-worker.mjs'),{workerData:{dir},execArgv:[]});
  try {
    return await new Promise<Summary>((resolve,reject)=>{
      worker.once('error',()=>reject(new Error('Enrichment file summary is unavailable.')));
      worker.once('exit',()=>reject(new Error('Enrichment summary worker stopped.')));
      worker.once('message',(message:{result?:Summary;error?:boolean})=>message.result?resolve(message.result):reject(new Error('Enrichment file summary is unavailable.')));
    });
  } finally {await worker.terminate();}
}
