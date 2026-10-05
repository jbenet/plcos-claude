import { withRoute } from '@/lib/authz/route';
/**
 * A snapshot of this server's database, or with ?files=1 its working files (docs/deploy/railway.md §6).
 * Read by scripts/cloud-pull.sh with a snapshot token, which only an Admin makes; withRoute checks the
 * token and its owner before this runs. One at a time: 409 while another streams.
 */
export const dynamic = 'force-dynamic';

export const GET = withRoute('app/api/sync/snapshot/route.ts#GET', async function(request: Request, context: { caller: import('@/lib/sync/auth').SyncCaller }) {
  const { snapshotResponse } = await import('@/lib/sync/snapshot');
  return snapshotResponse(context.caller, new URL(request.url).searchParams.get('files') === '1');
});
