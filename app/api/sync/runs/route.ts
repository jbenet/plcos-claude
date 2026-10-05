import { withRoute } from '@/lib/authz/route';
/**
 * The workflow ledger in the cloud (docs/28-cloud-workflows.md §5): a run made on the Mac begins and finishes
 * here, by scripts/cloud-run.sh with a push token, now that the Mac's ledger is frozen. lib/sync/runs.ts.
 */
export const dynamic = 'force-dynamic';

export const POST = withRoute('app/api/sync/runs/route.ts#POST', async function(request: Request, context: { caller: import('@/lib/sync/auth').SyncCaller }) {
  const { recordRun } = await import('@/lib/sync/runs');
  const { status, body } = await recordRun(context.caller, request);
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
});
