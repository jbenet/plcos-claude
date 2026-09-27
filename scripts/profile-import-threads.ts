/** Invented-only operation smoke profile. Findings' large-file benchmark is responsiveness.ts. */
import { mkdtemp,mkdir,writeFile,utimes,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { openPglite } from '../lib/db/pglite';
import { migrate } from '../lib/db/migrate';
import { createImportJob } from '../lib/import-jobs/store';
import { launchImportJob } from '../lib/import-jobs/server';
import type { ImportJob,ImportKind } from '../lib/import-jobs/types';
if(process.env.DATA_PROFILE==='real'||process.env.DATABASE_URL)throw new Error('This profile requires invented PGlite data.');
const root=await mkdtemp(join(tmpdir(),'plcos-thread-profile-'));
const previousEnrich=process.env.ENRICH_DIR;process.env.ENRICH_DIR=join(root,'enrich');
const db=await openPglite(join(root,'db'));
try {
  await migrate(db);
  await mkdir(join(root,'enrich/prospects'),{recursive:true});
  const actor=randomUUID();
  await db.query(`insert into platform.app_user(id,handle,name,initials,role,email) values($1,'fixture-thread','Invented Thread','IT','admin','thread@example.test')`,[actor]);
  await db.query(`insert into platform.vehicle(slug,name,kind,exemption) values('fixture','Invented Fixture Fund','fund','506(c)')`);
  await db.exec(`insert into identity.entity(entity_type,display_name) select 'person','Invented Person '||n from generate_series(1,1100) n`);
  for(const kind of ['prospects','duplicates','pursuits','export','network'] as ImportKind[]) {
    if(kind==='prospects') {
      const text=Array.from({length:1100},(_,i)=>JSON.stringify({name:`Invented Prospect ${i}`,org:null,vehicle:'fixture',status:'new',capacity:{band:'unknown',basis:'Invented fixture',guess:true},reason:'Invented profile',strategic:false,route:null,sources:['https://example.test/fixture']})).join('\n');
      const file=join(root,'enrich/prospects/fixture.jsonl');await writeFile(file,text);await utimes(file,new Date(0),new Date(0));
    }
    if(kind==='duplicates') {
      // A hundred independently sourced duplicate organization pairs: real merge mutations.
      await db.exec(`insert into identity.entity(entity_type,display_name)
        select 'org','Invented Duplicate Group '||n from generate_series(1,100) n cross join generate_series(1,2) copy`);
      await db.exec(`insert into identity.source_record(source,source_id,entity_id,resolved_by)
        select 'network_org',entity_id::text,entity_id,'rule:invented-fixture' from identity.entity where display_name like 'Invented Duplicate Group %'`);
    }
    if(kind==='pursuits') {
      const vehicle=(await db.one<{id:string}>("select id::text from platform.vehicle where slug='fixture'"))!.id;
      // Identity redirects are already evidenced in this fixture; consolidate both pursuits.
      for(let n=0;n<100;n++) {
        const rootId=randomUUID(),aliasId=randomUUID();
        await db.query(`insert into identity.entity(entity_id,entity_type,display_name) values($1,'person',$2)`,[rootId,`Invented Pursuit Root ${n}`]);
        await db.query(`insert into identity.entity(entity_id,entity_type,display_name,merged_into) values($1,'person',$2,$3)`,[aliasId,`Invented Pursuit Alias ${n}`,rootId]);
        await db.query(`insert into strategy.pursuit(entity_id,vehicle_id,owner_id,status,status_source)
          values($1,$3,$4,'new','rule'),($2,$3,$4,'new','rule')`,[rootId,aliasId,vehicle,actor]);
      }
    }
    const job=await createImportJob(db,kind,actor),histogram=monitorEventLoopDelay({resolution:5});
    histogram.enable();const started=performance.now();launchImportJob(db,job.id,{demoRoot:root});
    let result:ImportJob|null=null;
    while(performance.now()-started<180000) {
      result=await db.one<ImportJob>('select * from platform.import_job where id=$1',[job.id]);
      if(result&&['completed','failed'].includes(result.status))break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    histogram.disable();
    console.log(JSON.stringify({kind,status:result?.status,durationMs:Math.round(performance.now()-started),p99LagMs:histogram.percentile(99)/1e6,maxLagMs:histogram.max/1e6,result:result?.result?Object.fromEntries(Object.entries(result.result).filter(([key])=>key!=='dir')):null}));
    if((kind==='duplicates'||kind==='pursuits')&&result?.result?.merged!==100)throw new Error('Invented mutation fixture did not merge a hundred records.');
    if(result?.status!=='completed')throw new Error('Invented job did not complete.');
  }
}finally{await db.close();await rm(root,{recursive:true,force:true});if(previousEnrich===undefined)delete process.env.ENRICH_DIR;else process.env.ENRICH_DIR=previousEnrich;}
