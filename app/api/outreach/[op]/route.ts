import { withRoute } from '@/lib/authz/route';
/**
 * The mail desk's outreach API (docs/27-outreach-api.md), a thin REST wrapper over MCP tools (lib/outreach/http.ts):
 *   GET  /api/outreach/vehicles, /queue, /trace, /audit, /connectors, /routes-to, /routes-through
 *   POST /api/outreach/update, /tickets, /contacts, /link, /comms, and /sent (deprecated: the old name of /link)
 * A bearer token with the tool's scope (outreach:read, outreach:write; the route reads need their tool's name); each
 * op runs as the token's owner through the authorization layer and the UI's own services (lib/outreach/).
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
