import { withRoute } from '@/lib/authz/route';
/**
 * One finished W1, W1c or W5 output from the Mac (docs/deploy/railway.md §7), sent by scripts/cloud-push.sh
 * with a push token (a GP's or an Admin's). Validated, kept, recorded and imported, or refused with every
 * reason and nothing written. Idempotent by content hash.
 */
export const dynamic = 'force-dynamic';

export const POST = withRoute('app/api/sync/push/route.ts#POST', async function(request: Request, context: { caller: import('@/lib/sync/auth').SyncCaller }) {
  const { acceptPush } = await import('@/lib/sync/push');
  const { status, body } = await acceptPush(context.caller, request);
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
});
