import { revalidatePath } from 'next/cache';
import { withRoute } from '@/lib/authz/route';
/**
 * An Admin adds a vehicle by token (lib/sync/vehicles.ts; docs/deploy/railway.md §7), sent by
 * scripts/cloud-vehicle.sh with an Admin (sync:admin) token. The same checks and audit as Settings → Vehicles.
 */
export const dynamic = 'force-dynamic';

export const POST = withRoute('app/api/sync/vehicles/route.ts#POST', async function(request: Request, context: { caller: import('@/lib/sync/auth').SyncCaller }) {
  const { addVehicle } = await import('@/lib/sync/vehicles');
  const { status, body } = await addVehicle(context.caller, request);
  if (status === 201) revalidatePath('/', 'layout');
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
});

/** An Admin moves an existing vehicle's raise window by token (lib/sync/vehicles.ts, moveRaiseWindow). */
export const PATCH = withRoute('app/api/sync/vehicles/route.ts#PATCH', async function(request: Request, context: { caller: import('@/lib/sync/auth').SyncCaller }) {
  const { moveRaiseWindow } = await import('@/lib/sync/vehicles');
  const { status, body } = await moveRaiseWindow(context.caller, request);
  if (status === 200) revalidatePath('/', 'layout');
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
});
