'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { exportResearchSet } from '@/lib/enrich/candidates';
import { importFindings } from '@/lib/enrich/import';
import { appendAudit } from '@/modules/platform';

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
  const r = await importFindings(user.id);
  await appendAudit({ actorId: user.id, action: 'enrich.imported', subjectType: 'enrich', detail: { mapped: r.mapped, claims: r.claims, rejected: r.rejected, paths: r.paths } });
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
