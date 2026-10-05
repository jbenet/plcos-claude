import { withRoute } from '@/lib/authz/route';
/**
 * The mail desk's outreach API (docs/27-outreach-api.md): GET /api/outreach/vehicles and /queue; POST
 * /api/outreach/update, /tickets, /contacts and /sent. A bearer token with the outreach scope; each op runs
 * as the token's owner through the authorization layer and the UI's own services (lib/outreach/).
 */
export const dynamic = 'force-dynamic';

type Context = { params: Promise<{ op: string }> };

export const GET = withRoute('app/api/outreach/[op]/route.ts#GET', async function(request: Request, context: Context) {
  const { serveOutreach } = await import('@/lib/outreach');
  return serveOutreach(request, (await context.params).op, 'GET');
});

export const POST = withRoute('app/api/outreach/[op]/route.ts#POST', async function(request: Request, context: Context) {
  const { serveOutreach } = await import('@/lib/outreach');
  return serveOutreach(request, (await context.params).op, 'POST');
});

export const OPTIONS = withRoute('app/api/outreach/[op]/route.ts#OPTIONS', async function(request: Request) {
  const { preflight } = await import('@/lib/outreach');
  return preflight(request);
});
