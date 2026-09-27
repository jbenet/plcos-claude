import { parentPort,workerData } from 'node:worker_threads';
import { withDb } from '../lib/db';
import { connectJobDb } from '../lib/db/job-bridge';
import { executeImportJob } from '../lib/import-jobs/store';
import { runImportOperation } from '../lib/import-jobs/operations';
import { config } from '../config/deployment';
import type { ImportJob } from '../lib/import-jobs/types';

const db=connectJobDb(workerData.port,'pglite');
async function main() {
  // Explicit fixture roots are only an internal benchmark capability, never action input.
  if(workerData.demoRoot){if(config.data.profile!=='demo')throw new Error('Fixture override requires demo.');(config.data as {root:string}).root=workerData.demoRoot;}
  await withDb(db,()=>executeImportJob(db,workerData.id,runImportOperation.bind(null,db),job=>parentPort?.postMessage({job})));
  const job=await db.one<ImportJob>('select * from platform.import_job where id=$1',[workerData.id]);
  parentPort?.postMessage({job});
}
void main().catch(()=>{process.exitCode=1;}).finally(async()=>{await db.close();parentPort?.close();});
