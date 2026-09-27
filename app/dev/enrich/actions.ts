'use server';

import { queueImportJob } from '@/lib/import-jobs/server';
import { mergeImportDuplicates, type ImportDuplicateReport } from '@/lib/enrich/import-dupes';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { enrichDir, exportResearchSet } from '@/lib/enrich/candidates';
import { importFindings } from '@/lib/enrich/import';
import { appendAudit } from '@/modules/platform';
import { getDb } from '@/lib/db';
import { consolidatePursuits, reversePursuitMerge, type PursuitMergeReport } from '@/modules/strategy';
import { startRun, finishRun } from '@/modules/sources';
import { config } from '@/config/deployment';
import { readLayout } from '@/config/ports';
import { addProspects, readProspectFiles, type ProspectResult } from '@/lib/enrich/prospects';

export async function addProspectsAction(): Promise<{ result?: ProspectResult; error?: string; message?: string }> {
  // A dev checkout must never open the real DB for an import; demo uses fictional files.
  if (config.data.profile === 'real' && !(config.db.url && process.env.POSTGRES_REHEARSAL === '1') && (config.data.copyTakenAt || readLayout().role !== 'live')) {
    return { error: 'Add prospects from Developer → Enrich on the live server.' };
  }
  let result: ProspectResult;
  try {
    const user = await (await auth()).currentUser();
    const db = await getDb();
    if (db.kind === 'postgres') { await queueImportJob(db,'prospects',user.id); return {message:'Prospect import queued. Progress appears above.'}; }
    const files = await readProspectFiles();
    result = await addProspects(await getDb(), user.id, files);
    await appendAudit({ actorId: user.id, action: 'enrich.prospects', subjectType: 'enrich', detail: {
      files: result.files, added: result.added, existing: result.existing, ambiguous: result.ambiguous, invalid: result.invalid.length, inProgress: result.inProgress.length,
      moved: result.moved, toSourcing: result.toSourcing, toPassed: result.toPassed, kept: result.kept,
      lost: result.losers.length, perFile: result.perFile,
    } });
  } catch {
    return { error: 'The import could not finish. Check the local prospect files and retry; person-set statuses are preserved on retry.' };
  }
  revalidatePath('/dev/enrich');
  revalidatePath('/targets', 'layout');
  return { result };
}

/**
 * Write the research set to data/<profile>/enrich/ (N64). Counts go to the audit log and the
 * address; the names stay in the files, which git ignores for the real profile. Imported at the
 * top, not on demand: the dev server kept serving a stale copy of an on-demand import.
 */
export async function exportResearchSetAction(): Promise<void> {
  const user = await (await auth()).currentUser();
  const r = await exportResearchSet();
  await appendAudit({ actorId: user.id, action: 'enrich.exported', subjectType: 'enrich', detail: { candidates: r.candidates, people: r.people, orgs: r.orgs } });
  revalidatePath('/dev/enrich');
  redirect(`/developer/enrich?exported=${r.candidates}`);
}

/** Map the findings in (N64): claims with provenance, profiles, connection candidates. Counts only. */
export async function importFindingsAction(): Promise<void> {
  const user = await (await auth()).currentUser();
  const db = await getDb();
  if (db.kind === 'postgres') {
    await queueImportJob(db,'findings',user.id);
    revalidatePath('/dev/enrich');
    redirect('/developer/enrich');
  }
  // Repair team aliases before the identity pass consolidates their pursuits.
  const { readNetworkNodeInput } = await import('@/modules/network/nodes');
  const { repairTeamIdentities } = await import('@/modules/identity/team');
  const inputs = await readNetworkNodeInput(enrichDir());
  if (inputs) await repairTeamIdentities(await getDb(), inputs);
  const r = await importFindings(user.id);
  await appendAudit({ actorId: user.id, action: 'enrich.imported', subjectType: 'enrich', detail: { mapped: r.mapped, claims: r.claims, rejected: r.rejected, paths: r.paths, organizationLps: r.organizationLps, duplicateIdentities: { merged: r.duplicateIdentities?.merged ?? 0, ambiguous: r.duplicateIdentities?.ambiguous.length ?? 0 }, entityTypes: { corrected: r.entityTypes?.corrected.length ?? 0, ambiguous: r.entityTypes?.ambiguous.length ?? 0 } } });
  // Research paths become ties with their evidence tiers.
  const { buildNetwork } = await import('@/modules/network');
  await buildNetwork();
  revalidatePath('/dev/enrich');
  revalidatePath('/targets');
  redirect(`/developer/enrich?imported=${r.mapped}&claims=${r.claims}&refused=${r.rejected}`);
}

/**
 * Where LPs added in a bulk import came from (N81): one answer for the whole day, and any row's own
 * answer over it. Each is saved as the team's context on the LP — what the strategy step reads first,
 * and what makes its strategy due again. Blank rows are left alone.
 */
export async function sourceBulkAction(formData: FormData): Promise<void> {
  const { addTeamContext } = await import('@/modules/research');
  const user = await (await auth()).currentUser();
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
  if (config.data.profile === 'real' && !config.data.copyTakenAt && readLayout().role !== 'live') return { error: 'Import on the live server or a marked preview copy.' };
  try {
    const { readPortfolioFile, importPortfolio } = await import('@/lib/enrich/portfolio');
    const input = await readPortfolioFile();
    if (!input) return { error: 'No portfolio file found. Add the sourced portfolio.json file, then retry.' };
    const user = await (await auth()).currentUser();
    const result = await importPortfolio(await getDb(), input);
    await appendAudit({actorId:user.id,action:'enrich.portfolio',subjectType:'enrich',detail:{...result}});
    revalidatePath('/portfolio'); revalidatePath('/routes'); revalidatePath('/dev/enrich');
    return {result};
  } catch { return {error:'Portfolio import failed. Check the file’s required sources, vehicle slugs and stable row IDs, then retry.'}; }
}

/** Return a queued receipt; the local worker commits progress independently. */
export async function importDakotaAction(): Promise<{job?:import('@/lib/connectors/dakota/translate').DakotaStatus|null;error?:string}> {
  const {dakotaLiveServer,resumeDakotaJob}=await import('@/lib/connectors/dakota/job');
  if(!dakotaLiveServer())return {error:'Import Dakota from Developer → Enrichment on the live server.'};
  try {
    const {queueDakota,dakotaStatus}=await import('@/lib/connectors/dakota/translate');
    const user=await (await auth()).currentUser(),db=await getDb();
    await queueDakota(db,user.id);
    const job=await dakotaStatus(db);
    if (db.kind === 'postgres') await queueImportJob(db,'dakota',user.id);
    else resumeDakotaJob(db);
    return {job};
  } catch {return {error:'Dakota could not be queued. Try again; committed batches are preserved.'};}
}

/** The existing server handle is the only live writer. No DB-opening CLI. */
export async function consolidatePursuitsAction(): Promise<{ result?: PursuitMergeReport; error?: string; message?: string }> {
  if (config.data.profile === 'real' && !(config.db.url && process.env.POSTGRES_REHEARSAL === '1') && (config.data.copyTakenAt || readLayout().role !== 'live')) {
    return { error: 'Consolidate pursuits on the live server.' };
  }
  const user = await (await auth()).currentUser();
  const db = await getDb();
  if (db.kind === 'postgres') {
    try { await queueImportJob(db,'pursuits',user.id); return {message:'Pursuit consolidation queued. Progress appears above.'}; }
    catch { return {error:'Pursuit consolidation could not be queued. Retry after the active import finishes.'}; }
  }
  const run = await startRun('enrich', 'pursuit-merge', user.id);
  try {
    const result = await consolidatePursuits(await getDb(), user.id);
    await finishRun(run, { status: 'ok', requests: 0, records: result.merged, newRecords: 0,
      note: `${result.merged} pursuits merged, ${result.ambiguous.length} ambiguous`, detail: { ...result } });
    revalidatePath('/dev/enrich');
    revalidatePath('/targets', 'layout');
    return { result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Pursuit consolidation failed.';
    await finishRun(run, { status: 'failed', requests: 0, records: 0, newRecords: 0, note: message });
    return { error: message };
  }
}

export async function reversePursuitMergeAction(id: string, reason: string): Promise<{ error?: string }> {
  if (config.data.profile === 'real' && !(config.db.url && process.env.POSTGRES_REHEARSAL === '1') && (config.data.copyTakenAt || readLayout().role !== 'live')) {
    return { error: 'Reverse pursuit merges on the live server.' };
  }
  try {
    const user = await (await auth()).currentUser();
    await reversePursuitMerge(await getDb(), id, user.id, reason);
    revalidatePath('/dev/enrich');
    revalidatePath('/targets', 'layout');
    return {};
  } catch (error) { return { error: error instanceof Error ? error.message : 'Reversal failed.' }; }
}

/** Uses the server handle and local decision file; no external connector traffic. */
export async function mergeImportDuplicatesAction(): Promise<{ result?: ImportDuplicateReport; error?: string; message?: string }> {
  if (config.data.profile === 'real' && !(config.db.url && process.env.POSTGRES_REHEARSAL === '1') && (config.data.copyTakenAt || readLayout().role !== 'live')) {
    return { error: 'Merge duplicate identities on the live server.' };
  }
  const user = await (await auth()).currentUser();
  const db = await getDb();
  if (db.kind === 'postgres') {
    try { await queueImportJob(db,'duplicates',user.id); return {message:'Duplicate identity import queued. Progress appears above.'}; }
    catch { return {error:'Duplicate import could not be queued. Retry after the active import finishes.'}; }
  }
  const run = await startRun('enrich', 'import-duplicates', user.id);
  try {
    const result = await mergeImportDuplicates(await getDb(), user.id);
    await finishRun(run, { status: 'ok', requests: 0, records: result.merged, newRecords: 0,
      note: `${result.merged} duplicate identities merged, ${result.ambiguous.length} ambiguous`, detail: { ...result } });
    revalidatePath('/dev/enrich'); revalidatePath('/orgs', 'layout'); revalidatePath('/targets', 'layout');
    return { result };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Duplicate identity pass failed.';
    await finishRun(run, { status: 'failed', requests: 0, records: 0, newRecords: 0, note: message });
    return { error: message };
  }
}

export async function reverseImportDuplicateAction(assertionId: string, reason: string): Promise<{ error?: string }> {
  if (config.data.profile === 'real' && !(config.db.url && process.env.POSTGRES_REHEARSAL === '1') && (config.data.copyTakenAt || readLayout().role !== 'live')) {
    return { error: 'Reverse duplicate identities on the live server.' };
  }
  try {
    const { undoIdentityMergeInTransaction } = await import('@/modules/identity/resolution');
    const db = await getDb();
    const user = await (await auth()).currentUser();
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
  if (config.data.profile === 'real' && !(config.db.url && process.env.POSTGRES_REHEARSAL === '1') && (config.data.copyTakenAt || readLayout().role !== 'live')) {
    return { error: 'Reverse identity separations on the live server.' };
  }
  try {
    const user = await (await auth()).currentUser();
    const { reverseIdentitySeparation } = await import('@/lib/enrich/identity-decisions');
    await reverseIdentitySeparation(await getDb(), assertionId, user.id, reason);
    revalidatePath('/dev/enrich');
    return {};
  } catch (error) { return { error: error instanceof Error ? error.message : 'Reversal failed.' }; }
}
