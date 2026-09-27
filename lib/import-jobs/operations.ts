import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from '@/lib/db';
import { config } from '@/config/deployment';
import { appendAudit } from '@/modules/platform';
import { startRun, finishRun } from '@/modules/sources';
import type { ImportJob, ImportProgress } from './types';

/** Worker operations use the actor captured by the human's request, never a cookie or action context. */
export async function runImportOperation(db: Db, job: ImportJob, progress: ImportProgress): Promise<Record<string, unknown>> {
  const actor = job.actor;
  switch (job.kind) {
    case 'findings': {
      await progress('Repairing team identities',0,3);
      const { enrichDir } = await import('@/lib/enrich/candidates');
      const { readNetworkNodeInput } = await import('@/modules/network/nodes');
      const { repairTeamIdentities } = await import('@/modules/identity/team');
      const input = await readNetworkNodeInput(enrichDir());
      if (input) await repairTeamIdentities(db,input);
      await progress('Importing findings',1,3);
      const { importFindings } = await import('@/lib/enrich/import');
      const r = await importFindings(actor);
      const counts = { mapped:r.mapped,claims:r.claims,rejected:r.rejected,paths:r.paths,organizationLps:r.organizationLps,
        duplicateIdentities:{merged:r.duplicateIdentities?.merged??0,ambiguous:r.duplicateIdentities?.ambiguous.length??0},
        entityTypes:{corrected:r.entityTypes?.corrected.length??0,ambiguous:r.entityTypes?.ambiguous.length??0} };
      await appendAudit({actorId:actor,action:'enrich.imported',subjectType:'enrich',detail:counts});
      await progress('Rebuilding research ties',2,3);
      await (await import('@/modules/network')).buildNetwork();
      return counts;
    }
    case 'prospects': {
      await progress('Reading prospect files',0,2);
      const { readProspectFiles,addProspects } = await import('@/lib/enrich/prospects');
      const files = await readProspectFiles();
      await progress('Adding prospects',1,2);
      const r = await addProspects(db,actor,files);
      const counts = {files:r.files,added:r.added,existing:r.existing,ambiguous:r.ambiguous,invalid:r.invalid.length,inProgress:r.inProgress.length,
        moved:r.moved,toSourcing:r.toSourcing,toPassed:r.toPassed,kept:r.kept,lost:r.losers.length};
      await appendAudit({actorId:actor,action:'enrich.prospects',subjectType:'enrich',detail:{...counts,perFile:r.perFile}});
      return {...counts,precedence:{perFile:r.perFile,losers:r.losers.slice(0,5),lost:r.losers.length}};
    }
    case 'duplicates':
    case 'pursuits': {
      await progress(job.kind==='duplicates'?'Merging duplicate identities':'Consolidating pursuits',0,1);
      const run = await startRun('enrich',job.kind==='duplicates'?'import-duplicates':'pursuit-merge',actor);
      try {
        const result = job.kind==='duplicates'
          ? await (await import('@/lib/enrich/import-dupes')).mergeImportDuplicates(db,actor)
          : await (await import('@/modules/strategy')).consolidatePursuits(db,actor);
        await finishRun(run,{status:'ok',requests:0,records:result.merged,newRecords:0,
          note:`${result.merged} merged, ${result.ambiguous.length} ambiguous`,detail:{...result}});
        return {merged:result.merged,ambiguous:result.ambiguous.length};
      } catch {
        await finishRun(run,{status:'failed',requests:0,records:0,newRecords:0,note:'Import stopped; review committed results before retrying.'});
        throw new Error('Import stopped.');
      }
    }
    case 'dakota': {
      await progress('Reading complete replicas');
      try {
        const { readReplicas } = await import('@/lib/connectors/dakota/replica');
        const { translateDakota } = await import('@/lib/connectors/dakota/translate');
        const replicas = await readReplicas(join(config.data.root,'dakota/raw'));
        if (!replicas.length) throw new Error('No complete replicas.');
        return {...await translateDakota(db,actor,replicas,{afterBatch:p=>progress(p.phase,p.done,p.total)})};
      } catch {
        await db.query(`update dakota.translation_job set status='failed',error=$1 where singleton and status<>'completed'`,
          ['Dakota import stopped. Review local replicas, then resume from the last committed batch.']);
        throw new Error('Dakota import stopped.');
      }
    }
    case 'strategy-moves': {
      await progress('Validating strategy moves',0,1);
      const path = config.data.profile==='real' ? join(config.data.root,'strategy-moves/menu.json') : join(process.cwd(),'fixtures/strategy-moves.json');
      const { importMoves } = await import('@/modules/strategy/moves');
      return {...await importMoves(db,JSON.parse(await readFile(path,'utf8')),actor)};
    }
    case 'affinity': {
      const operation=job.input.operation;
      const options=job.input.options as {approvedUpTo?:number;full?:boolean;rest?:boolean}|undefined;
      await progress(operation==='translate'?'Translating local Affinity replica':'Reading Affinity',0,operation==='translate'?3:1);
      const run = operation==='slice' ? await (await import('@/lib/connectors/affinity/slice')).runSlice(actor,options)
        : operation==='notes' ? await (await import('@/lib/connectors/affinity/notes')).readNotes(actor,options)
        : operation==='meetings' ? await (await import('@/lib/connectors/affinity/meetings')).readMeetings(actor,options)
        : operation==='translate' ? await (await import('@/lib/connectors/affinity/translate')).translate(actor)
        : null;
      // A held or failed connector receipt is not a successful import.
      if (!run || run.status!=='ok') throw new Error('Affinity operation stopped; inspect its run receipt.');
      if (operation==='translate') {
        await progress('Proposing evidenced ladder changes',1,3);
        await (await import('@/lib/reconcile')).reconcile(actor);
        await progress('Building relationship ties',2,3);
        await (await import('@/modules/network')).buildNetwork();
      }
      return {records:run.records,requests:run.requests};
    }
  }
}
