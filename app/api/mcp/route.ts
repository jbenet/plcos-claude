import { withRoute } from '@/lib/authz/route';
/**
 * MCP over Streamable HTTP (docs/26-mcp.md). POST only: the server is stateless and answers each
 * exchange as JSON, so there is no stream to GET and no session to DELETE (Next answers 405).
 * withRoute checks the bearer token and builds the envelope before this runs.
 */
export const dynamic = 'force-dynamic';

export const POST = withRoute('app/api/mcp/route.ts#POST', async function(request: Request, context: { env: import('@/lib/mcp/envelope').Envelope }) {
  const { serveMcp } = await import('@/lib/mcp/server');
  return serveMcp(request, context.env);
});
