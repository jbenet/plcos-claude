import { withRoute } from '@/lib/authz/route';
/**
 * A record's local type by an Admin's token (lib/sync/entity-type.ts, issue 0063): list the pipeline people named
 * like an organisation, correct a record's type, or reverse a correction.
 */
export const dynamic = 'force-dynamic';

export const GET = withRoute('app/api/sync/entity-type/route.ts#GET', async function(request: Request, context: { caller: import('@/lib/sync/auth').SyncCaller }) {
  const { readEntityTypes } = await import('@/lib/sync/entity-type');
  const { status, body } = await readEntityTypes(context.caller, undefined, request);
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
});

export const POST = withRoute('app/api/sync/entity-type/route.ts#POST', async function(request: Request, context: { caller: import('@/lib/sync/auth').SyncCaller }) {
  const { writeEntityType } = await import('@/lib/sync/entity-type');
  const { status, body } = await writeEntityType(context.caller, request);
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
});
