import { withRoute } from '@/lib/authz/route';
/**
 * An Admin's token queues a research export or a findings import, and reads a job's state (lib/sync/jobs.ts).
 */
export const dynamic = 'force-dynamic';

export const POST = withRoute('app/api/sync/jobs/route.ts#POST', async function(request: Request, context: { caller: import('@/lib/sync/auth').SyncCaller }) {
  const { queueJob } = await import('@/lib/sync/jobs');
  const { status, body } = await queueJob(context.caller, request);
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
});

export const GET = withRoute('app/api/sync/jobs/route.ts#GET', async function(request: Request, context: { caller: import('@/lib/sync/auth').SyncCaller }) {
  const { jobState } = await import('@/lib/sync/jobs');
  const { status, body } = await jobState(context.caller, request);
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
});
