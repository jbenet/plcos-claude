import { withRoute } from '@/lib/authz/route';
/**
 * One finished W1, W1c or W5 output, or a prospects file, from the Mac (docs/deploy/railway.md §7), sent by
 * scripts/cloud-push.sh with a push token (a Team member's or an Admin's). Validated, kept, recorded and
 * imported, or refused with every reason and nothing written. Idempotent by content hash.
 * GET ?job=<id> answers the state and counts of the import a push of yours queued.
 */
export const dynamic = 'force-dynamic';

export const POST = withRoute('app/api/sync/push/route.ts#POST', async function(request: Request, context: { caller: import('@/lib/sync/auth').SyncCaller }) {
  const { acceptPush } = await import('@/lib/sync/push');
  const { status, body } = await acceptPush(context.caller, request);
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
});

export const GET = withRoute('app/api/sync/push/route.ts#GET', async function(request: Request, context: { caller: import('@/lib/sync/auth').SyncCaller }) {
  const { pushStatus } = await import('@/lib/sync/push');
  const { status, body } = await pushStatus(context.caller, request);
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
});
