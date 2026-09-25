'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { proposeAsk } from '@/modules/coordination';
import { listVehicles } from '@/modules/platform';
import { getEntity } from '@/modules/identity';

/**
 * Turn a route into a proposed ask. This contacts nobody: it writes the ask, runs the four
 * guards, opens an INTRO_ASK ticket with a stated scope, and opens a conflict case if
 * another vehicle is already in the way. Then it hands you to the queue.
 */
export async function proposeFromRoute(formData: FormData): Promise<void> {
  const user = await (await auth()).currentUser();
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

  const { ticketId } = await proposeAsk(user.id, {
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

  redirect(`/approvals?t=${ticketId}`);
}

/**
 * A person says whether a tie the research found is real (N82, rule 6): confirmed, a C or D tie can
 * carry a route, held; turned down, it is ended and no route walks it.
 */
export async function reviewEdgeAction(formData: FormData): Promise<void> {
  const { reviewEdge } = await import('@/modules/network');
  const user = await (await auth()).currentUser();
  const decision = String(formData.get('decision')) === 'confirm' ? 'confirm' : 'decline';
  await reviewEdge(user.id, String(formData.get('edgeId')), decision, String(formData.get('note') ?? '').trim() || null);
  revalidatePath('/routes');
}

/** Link the team to the graph and build its ties from our records and the research (N82). */
export async function buildNetworkAction(formData: FormData): Promise<void> {
  const { buildNetwork } = await import('@/modules/network');
  const { appendAudit } = await import('@/modules/platform');
  const user = await (await auth()).currentUser();
  const r = await buildNetwork();
  await appendAudit({ actorId: user.id, action: 'network.built', subjectType: 'network', detail: { ...r } });
  const target = String(formData.get('target') ?? '');
  revalidatePath('/routes');
  redirect(`/routes${target ? `?target=${target}` : ''}`);
}
