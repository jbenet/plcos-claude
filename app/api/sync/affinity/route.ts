import { withRoute } from '@/lib/authz/route';
/**
 * The Affinity writes by an Admin's token (lib/sync/affinity-writes.ts): read the open batch, or propose items from the
 * owner's sent mail PLC OS holds. A person still decides the batch in Approvals; nothing here reaches Affinity.
 */
export const dynamic = 'force-dynamic';

export const GET = withRoute('app/api/sync/affinity/route.ts#GET', async function(_request: Request, context: { caller: import('@/lib/sync/auth').SyncCaller }) {
  const { readAffinityBatch } = await import('@/lib/sync/affinity-writes');
  const { status, body } = await readAffinityBatch(context.caller);
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
});

export const POST = withRoute('app/api/sync/affinity/route.ts#POST', async function(request: Request, context: { caller: import('@/lib/sync/auth').SyncCaller }) {
  const { proposeFromSentMail } = await import('@/lib/sync/affinity-writes');
  const { status, body } = await proposeFromSentMail(context.caller, request);
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
});
