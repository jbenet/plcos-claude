import { revalidatePath } from 'next/cache';
import { withRoute } from '@/lib/authz/route';
/**
 * An Admin screens our records for a vehicle's field by token (lib/sync/screen.ts): a dry run gives counts only;
 * with add, the top matches go on the vehicle as New through Add prospects, ready for Selection.
 */
export const dynamic = 'force-dynamic';

export const POST = withRoute('app/api/sync/screen/route.ts#POST', async function(request: Request, context: { caller: import('@/lib/sync/auth').SyncCaller }) {
  const { screenVehicle } = await import('@/lib/sync/screen');
  const { status, body } = await screenVehicle(context.caller, request);
  if (status === 200 && body.added) revalidatePath('/', 'layout');
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
});
