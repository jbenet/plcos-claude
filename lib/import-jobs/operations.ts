import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from '@/lib/db';
import { config } from '@/config/deployment';
import { appendAudit } from '@/modules/platform';
import { startRun, finishRun } from '@/modules/sources';
import type { ImportJob, ImportProgress } from './types';

/** Re-point pursuits to their LP (docs/23), recorded as its own run so the enrichment page shows it. */
async function repointJob(db: Db, actor: string): Promise<Record<string, unknown>> {
  const run = await startRun('enrich','lp-units',actor);
  try {
    const { readLpUnitDecisions, repointWithLpUnitDecisions } = await import('@/lib/enrich/lp-unit-decisions');
    const { enrichDir } = await import('@/lib/enrich/candidates');
    const r = await repointWithLpUnitDecisions(db,actor,await readLpUnitDecisions(enrichDir()));
    await finishRun(run,{status:'ok',requests:0,records:r.moved+r.personal+r.review,newRecords:r.created,
      note:`${r.fileDecisions.applied} file decisions applied, ${r.fileDecisions.refused.length} refused · ${r.moved} moved to their organisation (${r.created} organisation pursuits created), ${r.personal} individual LPs, ${r.review} to review, ${r.unchanged} unchanged`,
      detail:{...r}});
    return {examined:r.examined,moved:r.moved,created:r.created,personal:r.personal,review:r.review,unchanged:r.unchanged,unaffiliated:r.unaffiliated,fileDecisions:r.fileDecisions};
  } catch (err) {
    await finishRun(run,{status:'failed',requests:0,records:0,newRecords:0,note:'Re-point stopped; nothing from this pass was kept.'});
    throw err;
  }
}

/** Derive SPV stance (Juan, 27 Sep 2026): our SPVs, Dakota's flag and research text, as its own run. */
async function spvJob(db: Db, actor: string): Promise<Record<string, unknown>> {
  const run = await startRun('enrich','spv-stance',actor);
  try {
    const r = await (await import('@/modules/strategy')).deriveSpvStance(db);
    await finishRun(run,{status:'ok',requests:0,records:r.lps,newRecords:r.pipeline+r.dakota+r.text,
      note:`${r.lps} LPs read: ${r.stances.does} do SPVs, ${r.stances['does-not']} don't, ${r.stances.unknown} unknown · signals: ${r.pipeline} from our SPVs, ${r.dakota} from Dakota, ${r.text} from research text${r.conflicts ? ` · ${r.conflicts} in conflict` : ''}`,
      detail:{...r}});
    return {...r};
  } catch (err) {
    await finishRun(run,{status:'failed',requests:0,records:0,newRecords:0,note:'SPV stance stopped; nothing from this pass was kept.'});
    throw err;
  }
}

/**
 * Add prospects (docs/prospects-import.md): every settled file in enrich/prospects, as `actor`. A cloud push
 * (lib/sync/push.ts) names in `input.settled` the files it wrote whole, so they are read now rather than after
 * the two-minute settle wait; only names of the pushed form count (settledNames), and every other file in the
 * folder is read as the button reads it. `dir` is for the properties, which run it on a scratch folder.
 */
export async function prospectsJob(db: Db, actor: string, input: Record<string, unknown>, progress: ImportProgress, dir?: string): Promise<Record<string, unknown>> {
  await progress('Reading prospect files',0,2);
  const { readProspectFiles,addProspects } = await import('@/lib/enrich/prospects');
  const { settledNames } = await import('@/lib/enrich/prospect-rows');
  const files = await readProspectFiles(dir,settledNames(input.settled));
  await progress('Adding prospects',1,2);
  const r = await addProspects(db,actor,files);
  const counts = {files:r.files,added:r.added,existing:r.existing,ambiguous:r.ambiguous,invalid:r.invalid.length,inProgress:r.inProgress.length,
    moved:r.moved,toSourcing:r.toSourcing,toPassed:r.toPassed,kept:r.kept,lost:r.losers.length};
  await appendAudit({actorId:actor,action:'enrich.prospects',subjectType:'enrich',detail:{...counts,perFile:r.perFile}});
  return {...counts,precedence:{perFile:r.perFile,losers:r.losers.slice(0,5),lost:r.losers.length}};
}

/** Worker operations use the actor captured by the human's request, never a cookie or action context. */
export async function runImportOperation(db: Db, job: ImportJob, progress: ImportProgress): Promise<Record<string, unknown>> {
  const actor = job.actor;
  switch (job.kind) {
    case 'workflow':
      // The cloud fact check (docs/28) has its own runner: envelope, cited pages only, no model tools.
      if (job.input.protocol === 'w1c-cloud') return { ...await (await import('@/lib/workflows/cloud-w1c')).runCloudFactCheck(job.input, actor) };
      if (job.input.protocol === 'w5-cloud') return { ...await (await import('@/lib/workflows/cloud-w5')).runCloudStrategy(job.input, actor) };
      if (job.input.protocol === 'sourcing-cloud') return { ...await (await import('@/lib/workflows/cloud-sourcing')).runCloudSourcing(job.input, actor) };
      if (job.input.protocol === 'w1-cloud') return { ...await (await import('@/lib/workflows/cloud-w1')).runCloudProfile(job.input, actor) };
      return (await import('@/lib/workflows/api')).runWorkflow(job.input);
    case 'network': {
      await progress('Building relationship ties',0,1);
      const result=await (await import('@/modules/network')).buildNetwork({awaitBackground:true});
      await appendAudit({actorId:actor,action:'network.built',subjectType:'network',detail:{...result}});
      return {...result};
    }
    case 'export': {
      await progress('Building research export',0,1);
      const result=await (await import('@/lib/enrich/candidates')).exportResearchSet();
      await appendAudit({actorId:actor,action:'enrich.exported',subjectType:'enrich',detail:{candidates:result.candidates,people:result.people,orgs:result.orgs,identityReviewError:result.identityReviewError ?? null}});
      return {...result};
    }
    case 'findings': {
      await progress('Repairing team identities',0,5);
      const { enrichDir } = await import('@/lib/enrich/candidates');
      const { readNetworkNodeInput } = await import('@/modules/network/nodes');
      const { repairTeamIdentities } = await import('@/modules/identity/team');
      const input = await readNetworkNodeInput(enrichDir());
      if (input) await repairTeamIdentities(db,input);
      await progress('Importing findings',1,5);
      const { importFindings } = await import('@/lib/enrich/import');
      const r = await importFindings(actor);
      const counts = { mapped:r.mapped,claims:r.claims,rejected:r.rejected,paths:r.paths,organizationLps:r.organizationLps,
        duplicateIdentities:{merged:r.duplicateIdentities?.merged??0,ambiguous:r.duplicateIdentities?.ambiguous.length??0},
        entityTypes:{corrected:r.entityTypes?.corrected.length??0,ambiguous:r.entityTypes?.ambiguous.length??0} };
      await appendAudit({actorId:actor,action:'enrich.imported',subjectType:'enrich',detail:counts});
      // The LP is the committing unit (docs/23): new findings can settle whose pursuit a person's is.
      await progress('Re-pointing pursuits to their LP',2,5);
      // Its own transaction: a failure here keeps the imported findings and says so.
      const lpUnits = await repointJob(db,actor).catch(() => ({error:'Re-point stopped; run it again from Developer → Enrich.'}));
      // SPV stance: research facts are in; derived signals follow the LP units just settled.
      await progress('Deriving SPV stance',3,5);
      const spv = await spvJob(db,actor).catch(() => ({error:'SPV stance stopped; run Derive SPV stance from Developer → Enrich.'}));
      await progress('Rebuilding research ties',4,5);
      await (await import('@/modules/network')).buildNetwork({awaitBackground:true});
      return {...counts,lpUnits,spv};
    }
    case 'lp-units': {
      await progress('Re-pointing pursuits to their LP',0,1);
      return repointJob(db,actor);
    }
    case 'spv-stance': {
      await progress('Deriving SPV stance',0,1);
      return spvJob(db,actor);
    }
    case 'prospects': return prospectsJob(db,actor,job.input,progress);
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
        // Which proposals applied and why any did not, so a token's caller (cloud-job.sh) can tell without the Developer page.
        const d=(result as {decisions?:import('@/lib/enrich/identity-decisions').IdentityDecisionReport}).decisions;
        return {merged:result.merged,ambiguous:result.ambiguous.length,
          // The newest lines first (issue 0138: the first 50 were all old lines, and a new proposal's refusal was cut off).
          ...(d?{decisions:{applied:d.applied,skipped:d.skipped,refusedCount:d.refused.length,
            refused:[...d.refused].sort((a,b)=>b.line-a.line).slice(0,50),superseded:d.superseded.length,
            supersededLines:[...d.superseded].sort((a,b)=>b.line-a.line).slice(0,50),separations:d.separations.length}}:{})};
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
    case 'linear': {
      // Read-only: queries only (lib/connectors/linear/client.ts), then the local translation.
      const { syncLinear } = await import('@/lib/connectors/linear/sync');
      return {...await syncLinear(db,actor,{full:job.input.full===true,progress})};
    }
    case 'linear-rebuild': {
      const { rebuildLinear } = await import('@/lib/connectors/linear/sync');
      return {...await rebuildLinear(db,actor,{progress})};
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
        : operation==='history' ? await (await import('@/lib/connectors/affinity/history')).readHistory(actor,options)
        : operation==='translate' ? await (await import('@/lib/connectors/affinity/translate')).translate(actor)
        : null;
      // A read that stopped at its request cap finished its chunk: the receipt keeps the resume point, and the job
      // completes. Any other held or failed connector receipt is not a successful import.
      // History marks a cap stop 'held' (resumable), the other reads 'failed'; both are a finished chunk (2 Oct 2026).
      const capped = (run?.status==='failed' || run?.status==='held') && Boolean((run.detail as {stoppedAtCap?:boolean}|null)?.stoppedAtCap);
      if (capped) return {records:run!.records,requests:run!.requests,stoppedAtCap:true};
      if (!run || run.status!=='ok') throw new Error('Affinity operation stopped; inspect its run receipt.');
      if (operation==='translate') {
        await progress('Proposing evidenced ladder changes',1,3);
        await (await import('@/lib/reconcile')).reconcile(actor);
        await progress('Building relationship ties',2,3);
        await (await import('@/modules/network')).buildNetwork({awaitBackground:true});
      }
      return {records:run.records,requests:run.requests};
    }
  }
}
