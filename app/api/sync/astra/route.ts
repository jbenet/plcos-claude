import { withRoute } from '@/lib/authz/route';
/**
 * The Mac's Astra runner polls for runs and reports their counts with an Admin's token (lib/sync/astra.ts).
 */
export const dynamic = 'force-dynamic';

export const POST = withRoute('app/api/sync/astra/route.ts#POST', async function(request: Request, context: { caller: import('@/lib/sync/auth').SyncCaller }) {
  const { astraCall } = await import('@/lib/sync/astra');
  const { status, body } = await astraCall(context.caller, request);
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
});
