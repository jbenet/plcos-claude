'use server';
import { requireAction } from '@/lib/authz/server';

import { queueImportJob } from '@/lib/import-jobs/server';
import { type ImportDuplicateReport } from '@/lib/enrich/import-dupes';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { appendAudit } from '@/modules/platform';
import { getDb } from '@/lib/db';
import { reversePursuitMerge, type PursuitMergeReport } from '@/modules/strategy';
import { config } from '@/config/deployment';
import { readLayout } from '@/config/ports';
import { type ProspectResult } from '@/lib/enrich/prospects';

export async function addProspectsAction(): Promise<{ result?: ProspectResult; error?: string; message?: string }> {
  const authorizedUser = await requireAction('app/dev/enrich/actions.ts#addProspectsAction');
  // A dev checkout must never open the real DB for an import; demo uses fictional files.
  if (config.data.profile === 'real' && !(config.db.url && process.env.POSTGRES_REHEARSAL === '1') && (config.data.copyTakenAt || readLayout().role !== 'live')) {
    return { error: 'Add prospects from Developer → Enrich on the live server.' };
  }
  try {
    const user = authorizedUser;
    await queueImportJob(await getDb(),'prospects',user.id);
    return {message:'Prospect import queued. Progress appears above.'};
  } catch { return {error:'Prospect import could not be queued. Retry after the active import finishes.'}; }
}

/**
 * Write the research set to data/<profile>/enrich/ (N64). Counts go to the audit log and the
 * address; the names stay in the files, which git ignores for the real profile. Imported at the
 * top, not on demand: the dev server kept serving a stale copy of an on-demand import.
 */
export async function exportResearchSetAction(): Promise<void> {
  const authorizedUser = await requireAction('app/dev/enrich/actions.ts#exportResearchSetAction');
  const user = authorizedUser;
  await queueImportJob(await getDb(),'export',user.id);
  revalidatePath('/dev/enrich');
  redirect('/developer/enrich');
}

/** Map the findings in (N64): claims with provenance, profiles, connection candidates. Counts only. */
export async function importFindingsAction(): Promise<void> {
  const authorizedUser = await requireAction('app/dev/enrich/actions.ts#importFindingsAction');
  const user = authorizedUser;
  const db = await getDb();
  await queueImportJob(db,'findings',user.id);
  revalidatePath('/dev/enrich');
  redirect('/developer/enrich');
}

/**
 * Where LPs added in a bulk import came from (N81): one answer for the whole day, and any row's own
 * answer over it. Each is saved as the team's context on the LP — what the strategy step reads first,
 * and what makes its strategy due again. Blank rows are left alone.
 */
export async function sourceBulkAction(formData: FormData): Promise<void> {
  const authorizedUser = await requireAction('app/dev/enrich/actions.ts#sourceBulkAction', formData);
  const { addTeamContext } = await import('@/modules/research');
  const user = authorizedUser;
  const day = String(formData.get('day') ?? '');
  const all = String(formData.get('all') ?? '').trim();
  let saved = 0;
  for (const id of formData.getAll('pursuitId').map(String)) {
    const own = String(formData.get(`src:${id}`) ?? '').trim();
    const said = own || all;
    if (!said) continue;
    const entityId = String(formData.get(`ent:${id}`) ?? '');
    const vehicleId = String(formData.get(`veh:${id}`) ?? '') || null;
    await addTeamContext(entityId, user.id, `Where they came from (added to Affinity in the import of ${day}): ${said}`, { pursuitId: id, vehicleId, source: 'bulk-import', day });
    saved++;
  }
  await appendAudit({ actorId: user.id, action: 'enrich.sourced', subjectType: 'enrich', detail: { day, saved, forAll: Boolean(all) } });
  revalidatePath('/dev/enrich');
  redirect(`/developer/enrich?sourced=${saved}#bulk`);
}

// dev rev 19: bumped so the dev server rebuilds this action with the lib code it imports.

export async function importPortfolioAction(): Promise<{ result?: import('@/lib/enrich/portfolio').PortfolioResult; error?: string }> {
  const authorizedUser = await requireAction('app/dev/enrich/actions.ts#importPortfolioAction');
  if (config.data.profile === 'real' && !config.data.copyTakenAt && readLayout().role !== 'live') return { error: 'Import on the live server or a marked preview copy.' };
  try {
    const user = authorizedUser;
    const { readPortfolioFile, importPortfolio } = await import('@/lib/enrich/portfolio');
    const input = await readPortfolioFile();
    if (!input) return { error: 'No portfolio file found. Add the sourced portfolio.json file, then retry.' };
    const result = await importPortfolio(await getDb(), input);
    await appendAudit({actorId:user.id,action:'enrich.portfolio',subjectType:'enrich',detail:{...result}});
    revalidatePath('/portfolio'); revalidatePath('/routes'); revalidatePath('/dev/enrich');
    return {result};
  } catch { return {error:'Portfolio import failed. Check the file’s required sources, vehicle slugs and stable row IDs, then retry.'}; }
}

/** Return a queued receipt; the local worker commits progress independently. */
export async function importDakotaAction(): Promise<{job?:import('@/lib/connectors/dakota/translate').DakotaStatus|null;error?:string}> {
  const authorizedUser = await requireAction('app/dev/enrich/actions.ts#importDakotaAction');
  const {dakotaLiveServer}=await import('@/lib/connectors/dakota/job');
  if(!dakotaLiveServer())return {error:'Import Dakota from Developer → Enrichment on the live server.'};
  try {
    const {queueDakota,dakotaStatus}=await import('@/lib/connectors/dakota/translate');
    const user=authorizedUser,db=await getDb();
    await queueDakota(db,user.id);
    const job=await dakotaStatus(db);
    await queueImportJob(db,'dakota',user.id);
    return {job};
  } catch {return {error:'Dakota could not be queued. Try again; committed batches are preserved.'};}
}

/** The existing server handle is the only live writer. No DB-opening CLI. */
export async function consolidatePursuitsAction(): Promise<{ result?: PursuitMergeReport; error?: string; message?: string }> {
  const authorizedUser = await requireAction('app/dev/enrich/actions.ts#consolidatePursuitsAction');
  if (config.data.profile === 'real' && !(config.db.url && process.env.POSTGRES_REHEARSAL === '1') && (config.data.copyTakenAt || readLayout().role !== 'live')) {
    return { error: 'Consolidate pursuits on the live server.' };
  }
  const user = authorizedUser;
  const db = await getDb();
  try { await queueImportJob(db,'pursuits',user.id); return {message:'Pursuit consolidation queued. Progress appears above.'}; }
  catch { return {error:'Pursuit consolidation could not be queued. Retry after the active import finishes.'}; }
}

export async function reversePursuitMergeAction(id: string, reason: string): Promise<{ error?: string }> {
  const authorizedUser = await requireAction('app/dev/enrich/actions.ts#reversePursuitMergeAction', id, reason);
  if (config.data.profile === 'real' && !(config.db.url && process.env.POSTGRES_REHEARSAL === '1') && (config.data.copyTakenAt || readLayout().role !== 'live')) {
    return { error: 'Reverse pursuit merges on the live server.' };
  }
  try {
    const user = authorizedUser;
    await reversePursuitMerge(await getDb(), id, user.id, reason);
    revalidatePath('/dev/enrich');
    revalidatePath('/targets', 'layout');
    return {};
  } catch (error) { return { error: error instanceof Error ? error.message : 'Reversal failed.' }; }
}

/** Uses the server handle and local decision file; no external connector traffic. */
export async function mergeImportDuplicatesAction(): Promise<{ result?: ImportDuplicateReport; error?: string; message?: string }> {
  const authorizedUser = await requireAction('app/dev/enrich/actions.ts#mergeImportDuplicatesAction');
  if (config.data.profile === 'real' && !(config.db.url && process.env.POSTGRES_REHEARSAL === '1') && (config.data.copyTakenAt || readLayout().role !== 'live')) {
    return { error: 'Merge duplicate identities on the live server.' };
  }
  const user = authorizedUser;
  const db = await getDb();
  try { await queueImportJob(db,'duplicates',user.id); return {message:'Duplicate identity import queued. Progress appears above.'}; }
  catch { return {error:'Duplicate identity import could not be queued. Retry after the active import finishes.'}; }
}

export async function reverseImportDuplicateAction(assertionId: string, reason: string): Promise<{ error?: string }> {
  const authorizedUser = await requireAction('app/dev/enrich/actions.ts#reverseImportDuplicateAction', assertionId, reason);
  if (config.data.profile === 'real' && !(config.db.url && process.env.POSTGRES_REHEARSAL === '1') && (config.data.copyTakenAt || readLayout().role !== 'live')) {
    return { error: 'Reverse duplicate identities on the live server.' };
  }
  try {
    const { undoIdentityMergeInTransaction } = await import('@/modules/identity/resolution');
    const user = authorizedUser;
    const db = await getDb();
    await db.transaction(async tx => {
      await tx.exec('lock table identity.entity, identity.source_record in share row exclusive mode');
      const merge = await tx.one<{ loser: string; survivor: string }>(`select merged_entity::text loser,canonical_entity::text survivor
        from identity.match_assertion where assertion_id=$1 and kind='same_as'
          and (rule='identity:v1:import-duplicates' or rule like 'identity:v1:decision:%' or rule='decision:affinity-duplicate')`, [assertionId]);
      if (!merge) throw new Error('Duplicate merge not found.');
      const pursuit = await tx.one(`select id from strategy.pursuit_merge m where reversed_at is null
        and exists(select 1 from strategy.pursuit p where (p.pursuit_id=m.survivor_id or p.pursuit_id=any(m.loser_ids))
          and identity.canonical_entity_id(p.entity_id)=identity.canonical_entity_id($1::uuid)) limit 1`, [merge.survivor]);
      if (pursuit) throw new Error('Reverse the related pursuit consolidation first, below.');
      await undoIdentityMergeInTransaction(tx, assertionId, reason);
    });
    await appendAudit({ actorId: user.id, action: 'identity.import_duplicate_reversed', subjectType: 'identity', detail: { assertionId, reason } });
    revalidatePath('/dev/enrich'); revalidatePath('/orgs', 'layout'); revalidatePath('/targets', 'layout');
    return {};
  } catch (error) { return { error: error instanceof Error ? error.message : 'Reversal failed.' }; }
}

export async function reverseIdentitySeparationAction(assertionId: string, reason: string): Promise<{ error?: string }> {
  const authorizedUser = await requireAction('app/dev/enrich/actions.ts#reverseIdentitySeparationAction', assertionId, reason);
  if (config.data.profile === 'real' && !(config.db.url && process.env.POSTGRES_REHEARSAL === '1') && (config.data.copyTakenAt || readLayout().role !== 'live')) {
    return { error: 'Reverse identity separations on the live server.' };
  }
  try {
    const user = authorizedUser;
    const { reverseIdentitySeparation } = await import('@/lib/enrich/identity-decisions');
    await reverseIdentitySeparation(await getDb(), assertionId, user.id, reason);
    revalidatePath('/dev/enrich');
    return {};
  } catch (error) { return { error: error instanceof Error ? error.message : 'Reversal failed.' }; }
}

const liveOnly = () => config.data.profile === 'real' && !(config.db.url && process.env.POSTGRES_REHEARSAL === '1') && (config.data.copyTakenAt || readLayout().role !== 'live');

/** Re-point pursuits to their LP (issues 0111, 0112; docs/23): a queued job on the live server. */
export async function repointPursuitsAction(): Promise<{ error?: string; message?: string }> {
  const authorizedUser = await requireAction('app/dev/enrich/actions.ts#repointPursuitsAction');
  if (liveOnly()) return { error: 'Re-point pursuits on the live server.' };
  const user = authorizedUser;
  try { await queueImportJob(await getDb(), 'lp-units', user.id); return { message: 'Re-point queued. Progress appears above; reload for its decisions.' }; }
  catch { return { error: 'The re-point could not be queued. Retry after the active import finishes.' }; }
}

export async function reverseLpRepointAction(id: string, reason: string): Promise<{ error?: string }> {
  const authorizedUser = await requireAction('app/dev/enrich/actions.ts#reverseLpRepointAction', id, reason);
  if (liveOnly()) return { error: 'Reverse re-points on the live server.' };
  try {
    const { reverseLpRepoint } = await import('@/modules/strategy');
    const user = authorizedUser;
    await reverseLpRepoint(await getDb(), id, user.id, reason);
    revalidatePath('/dev/enrich');
    revalidatePath('/targets', 'layout');
    return {};
  } catch (error) { return { error: error instanceof Error ? error.message : 'Reversal failed.' }; }
}

/** Derive SPV stance (Juan, 27 Sep 2026): our SPVs, Dakota's flag and research text. A queued job on the live server. */
export async function deriveSpvStanceAction(): Promise<{ error?: string; message?: string }> {
  const authorizedUser = await requireAction('app/dev/enrich/actions.ts#deriveSpvStanceAction');
  if (liveOnly()) return { error: 'Derive SPV stance on the live server.' };
  const user = authorizedUser;
  try { await queueImportJob(await getDb(), 'spv-stance', user.id); return { message: 'SPV stance queued. Progress appears above; reload for its counts.' }; }
  catch { return { error: 'SPV stance could not be queued. Retry after the active import finishes.' }; }
}
