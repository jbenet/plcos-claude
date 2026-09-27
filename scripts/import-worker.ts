import { config } from '../config/deployment';
import { withDb } from '../lib/db';
import { openPostgres } from '../lib/db/postgres';
import { withImportLock } from '../lib/db/advisory';
import { executeImportJob } from '../lib/import-jobs/store';
import { runImportOperation } from '../lib/import-jobs/operations';
import type { ImportJob } from '../lib/import-jobs/types';

async function main() {
  const id=process.argv[2];
  if(!config.db.url||process.env.PLCOS_IMPORT_WORKER!=='1'||!id||!/^[0-9a-f-]{36}$/i.test(id))throw new Error('Invalid worker launch.');
  // Parent has already migrated and initialized. No boot, seeding, PGlite handle or init file here.
  const db=await openPostgres(config.db.url,{statementTimeoutMs:0,max:2});
  try {
    const job=await db.one<ImportJob>('select * from platform.import_job where id=$1',[id]);
    if(!job||job.status!=='queued')return;
    await withImportLock(config.db.url,job.kind,()=>withDb(db,()=>executeImportJob(db,id,(j,p)=>runImportOperation(db,j,p))),()=>process.exit(1));
  } finally {await db.close();}
}
void main().catch(()=>{process.exitCode=1;});
