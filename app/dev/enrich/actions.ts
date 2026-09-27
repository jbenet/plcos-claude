'use server';

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

export async function addProspectsAction(): Promise<{ result?: ProspectResult; error?: string }> {
  // A dev checkout must never open the real DB for an import; demo uses fictional files.
  if (config.data.profile === 'real' && (config.data.copyTakenAt || readLayout().role !== 'live')) {
    return { error: 'Add prospects from Developer → Enrich on the live server.' };
  }
  let result: ProspectResult;
  try {
    const user = await (await auth()).currentUser();
    const files = await readProspectFiles();
    result = await addProspects(await getDb(), user.id, files);
    await appendAudit({ actorId: user.id, action: 'enrich.prospects', subjectType: 'enrich', detail: {
      files: result.files, added: result.added, existing: result.existing, ambiguous: result.ambiguous, invalid: result.invalid.length, inProgress: result.inProgress.length,
      moved: result.moved, toSourcing: result.toSourcing, toPassed: result.toPassed, kept: result.kept,
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
  // Repair team aliases before the identity pass consolidates their pursuits.
  const { readNetworkNodeInput } = await import('@/modules/network/nodes');
  const { repairTeamIdentities } = await import('@/modules/identity/team');
  const inputs = await readNetworkNodeInput(enrichDir());
  if (inputs) await repairTeamIdentities(await getDb(), inputs);
  const r = await importFindings(user.id);
  await appendAudit({ actorId: user.id, action: 'enrich.imported', subjectType: 'enrich', detail: { mapped: r.mapped, claims: r.claims, rejected: r.rejected, paths: r.paths, organizationLps: r.organizationLps, entityTypes: { corrected: r.entityTypes?.corrected.length ?? 0, ambiguous: r.entityTypes?.ambiguous.length ?? 0 } } });
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
    resumeDakotaJob(db);
    return {job};
  } catch {return {error:'Dakota could not be queued. Try again; committed batches are preserved.'};}
}

/** The existing server handle is the only live writer. No DB-opening CLI. */
export async function consolidatePursuitsAction(): Promise<{ result?: PursuitMergeReport; error?: string }> {
  if (config.data.profile === 'real' && (config.data.copyTakenAt || readLayout().role !== 'live')) {
    return { error: 'Consolidate pursuits on the live server.' };
  }
  const user = await (await auth()).currentUser();
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
  if (config.data.profile === 'real' && (config.data.copyTakenAt || readLayout().role !== 'live')) {
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
