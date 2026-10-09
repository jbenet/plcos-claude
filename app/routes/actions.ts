'use server';
import { requireAction } from '@/lib/authz/server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { proposeAsk } from '@/modules/coordination';
import { listVehicles } from '@/modules/platform';
import { getEntity } from '@/modules/identity';

/**
 * Turn a route into an ask on record. This contacts nobody: it writes the ask with its owner, runs
 * the four guards, and opens a conflict case if another vehicle is already in the way. A person
 * needs no INTRO_ASK ticket (Juan, 5 Oct 2026: tickets are for autonomous agents only); the owner
 * makes the ask by sending the email, and the guards' findings are on the asks page and the email
 * box. Then it hands you to the asks.
 */
export async function proposeFromRoute(formData: FormData): Promise<void> {
  const authorizedUser = await requireAction('app/routes/actions.ts#proposeFromRoute', formData);
  const user = authorizedUser;
  const targetId = String(formData.get('targetId'));
  const connectorId = String(formData.get('connectorId') || '') || null;
  const vehicleSlug = String(formData.get('vehicleSlug'));
  const ownerId = String(formData.get('ownerId') || '') || user.id;

  const [target, connector, vehicles] = await Promise.all([
    getEntity(targetId),
    connectorId ? getEntity(connectorId) : Promise.resolve(null),
    listVehicles(),
  ]);
  const vehicle = vehicles.find((v) => v.slug === vehicleSlug);
  if (!target || !vehicle) throw new Error('Unknown target or vehicle.');

  const { askId, ticketId } = await proposeAsk(user.id, {
    entityId: target.entityId,
    entityName: target.displayName,
    connectorId: connector?.entityId ?? null,
    connectorName: connector?.displayName ?? null,
    vehicleId: vehicle.id,
    vehicleName: vehicle.name,
    purpose: connector
      ? `Ask ${connector.displayName} for an opt-in from ${target.displayName}.`
      : `Approach ${target.displayName} directly.`,
    carries: connector
      ? `One opt-in request to ${connector.displayName} regarding ${target.displayName}, carrying ` +
        `the approved ${vehicle.name} material and nothing else.`
      : `One direct approach to ${target.displayName} on behalf of ${vehicle.name}.`,
    ownerId,
  });

  revalidatePath('/asks');
  // A person's ask opens no ticket; an ask only ever opens one for an autonomous agent.
  redirect(ticketId ? `/approvals?t=${ticketId}` : `/asks?ask=${askId}`);
}

/**
 * Legacy voluntary correction endpoint. Review status never controls route eligibility.
 * New feedback is recorded through the connection feedback box.
 */
export async function reviewEdgeAction(formData: FormData): Promise<void> {
  const authorizedUser = await requireAction('app/routes/actions.ts#reviewEdgeAction', formData);
  const { reviewEdge } = await import('@/modules/network');
  const user = authorizedUser;
  const decision = String(formData.get('decision')) === 'confirm' ? 'confirm' : 'decline';
  await reviewEdge(user.id, String(formData.get('edgeId')), decision, String(formData.get('note') ?? '').trim() || null);
  revalidatePath('/routes');
}

/** Issue 0143: two people on bad terms. Every route that would ask one of them about the other is excluded. */
export async function markBadTermsAction(formData: FormData): Promise<void> {
  const user = await requireAction('app/routes/actions.ts#markBadTermsAction', formData);
  const { markBadTerms } = await import('@/modules/network');
  await markBadTerms(user.id, String(formData.get('a')), String(formData.get('b')), String(formData.get('note') ?? '').trim().slice(0, 500) || null);
  revalidatePath('/routes');
}

export async function undoBadTermsAction(formData: FormData): Promise<void> {
  const user = await requireAction('app/routes/actions.ts#undoBadTermsAction', formData);
  const { undoBadTerms } = await import('@/modules/network');
  await undoBadTerms(user.id, String(formData.get('markId')));
  revalidatePath('/routes');
}

/** Issue 0144: the signed-in team member's own tie to someone, which the graph cannot derive from a shared organisation. */
export async function recordOwnTieAction(formData: FormData): Promise<void> {
  const user = await requireAction('app/routes/actions.ts#recordOwnTieAction', formData);
  const { recordOwnTie } = await import('@/modules/network');
  const last = String(formData.get('last') ?? '').trim();
  await recordOwnTie(user, String(formData.get('target')), String(formData.get('kind')) as never,
    String(formData.get('note') ?? '').trim().slice(0, 300) || null, /^\d{4}-\d{2}-\d{2}$/.test(last) ? last : null);
  revalidatePath('/routes');
}

export async function removeOwnTieAction(formData: FormData): Promise<void> {
  const user = await requireAction('app/routes/actions.ts#removeOwnTieAction', formData);
  const { ownTies, reviewEdge } = await import('@/modules/network');
  const edgeId = String(formData.get('edgeId'));
  // Only your own stated tie, never someone else's edge.
  if (!(await ownTies(user.handle, String(formData.get('target')))).some((t) => t.edgeId === edgeId)) throw new Error('Not your recorded tie.');
  await reviewEdge(user.id, edgeId, 'decline', 'Removed by the person who recorded it');
  revalidatePath('/routes');
}

/** Link the team to the graph and build its ties from our records and the research (N82). */
export async function buildNetworkAction(formData: FormData): Promise<void> {
  const authorizedUser = await requireAction('app/routes/actions.ts#buildNetworkAction', formData);
  const { queueImportJob } = await import('@/lib/import-jobs/server');
  const { getDb } = await import('@/lib/db');
  const user = authorizedUser;
  await queueImportJob(await getDb(),'network',user.id);
  const target = String(formData.get('target') ?? '');
  revalidatePath('/routes');
  redirect(`/routes${target ? `?target=${target}` : ''}`);
}
