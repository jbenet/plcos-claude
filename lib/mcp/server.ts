import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { config } from '@/config/deployment';
import { actAs } from '@/lib/auth/acting';
import { getDb } from '@/lib/db';
import { MutationGuardError } from '@/lib/mutation-policy';
import { appendAudit, findMcpToken } from '@/modules/platform';
import { admitCall, auditArgs, envelopeFor, type Envelope } from './envelope';
import { render, DATA_NOTICE } from './output';
import { ToolRefused } from './reads';
import { findTool, listing } from './tools';

/**
 * Capital OS over MCP (docs/26-mcp.md): Streamable HTTP at /api/mcp, stateless — each POST is a
 * whole exchange, answered as JSON — inside the Next server, so one process serves the app and MCP.
 */

export const INSTRUCTIONS = [
  'Capital OS: fundraising records for PLC\'s vehicles. These tools read records and write drafts; none sends an email,',
  'approves or accepts anything, changes a status, or moves money. A person does those in the app.',
  'You act as the person who made your token, with their access: what it does not cover is withheld and says so.',
  DATA_NOTICE,
  'Every search says what it covered; an empty result means none recorded here, not none in the world.',
].join(' ');

/** Token, origin and size: before any tool. Answers a refusal as an HTTP response. */
export async function mcpGuard(request: Request): Promise<{ env: Envelope } | { response: Response }> {
  const deny = (status: number, error: string, headers: Record<string, string> = {}) =>
    ({ response: Response.json({ jsonrpc: '2.0', error: { code: -32001, message: error }, id: null }, { status, headers }) });
  if (!config.mcp.enabled) return deny(404, 'MCP is off on this server.');
  // A browser page on another site must not drive this endpoint (DNS rebinding); MCP clients send no Origin.
  const origin = request.headers.get('origin');
  if (origin) {
    const url = new URL(request.url);
    if (origin !== `${url.protocol}//${request.headers.get('host') || url.host}`) return deny(403, 'Cross-site requests are refused.');
  }
  if (Number(request.headers.get('content-length') ?? 0) > config.mcp.maxRequestBytes) return deny(413, 'The request is too large.');
  const challenge = { 'WWW-Authenticate': 'Bearer realm="capital-os"' };
  const secret = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!secret) return deny(401, 'Send your MCP token as "Authorization: Bearer <token>". Make one in Preferences.', challenge);
  const db = await getDb();
  const found = await findMcpToken(secret, db);
  if (!found) return deny(401, 'That token is not known here.', challenge);
  if (found.state !== 'live') {
    await appendAudit({ actorId: found.user.id, action: 'mcp.refused', subjectType: 'mcp_token', subjectId: found.token.tokenId, detail: { reason: found.state } }, db);
    return deny(401, `That token is ${found.state === 'inactive' ? 'for someone no longer active' : found.state}. Make a new one in Preferences.`, challenge);
  }
  return { env: envelopeFor(found.token, found.user) };
}

type Outcome = 'ok' | 'refused' | 'rate_limited' | 'invalid' | 'error';

/** One tool call: envelope, input, the tool as its owner, the marked answer — and always an audit entry. */
export async function callTool(env: Envelope, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const started = Date.now();
  const db = await getDb();
  const tool = findTool(name);
  let outcome: Outcome = 'ok', reason: string | null = null, bytes = 0, truncated = false;
  const fail = (o: Outcome, message: string): CallToolResult => {
    outcome = o; reason = message.slice(0, 300);
    return { isError: true, content: [{ type: 'text', text: message }] };
  };
  try {
    if (!tool) return fail('refused', `There is no tool "${name}". The server decides which tools exist.`);
    const refusal = await admitCall(env, tool.name, db);
    if (refusal) return fail(refusal.startsWith('More than') || refusal.includes('budget') ? 'rate_limited' : 'refused', refusal);
    const parsed = tool.input.safeParse(args ?? {});
    if (!parsed.success) return fail('invalid', `Arguments not accepted: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`);
    const answer = await actAs(env.principal, () => tool.run(env, parsed.data));
    const out = render(tool.name, answer);
    bytes = out.bytes; truncated = out.truncated;
    return { content: [{ type: 'text', text: out.text }] };
  } catch (e) {
    if (e instanceof ToolRefused || e instanceof MutationGuardError) return fail('refused', e.message);
    console.error('[mcp]', name, e instanceof Error ? e.message : e);
    return fail('error', 'The tool failed on the server. Nothing was changed by this call unless it says otherwise; try again, or use the app.');
  } finally {
    await appendAudit({
      actorId: env.owner.id, action: 'mcp.call', subjectType: 'mcp_token', subjectId: env.tokenId,
      detail: { tool: name.slice(0, 60), kind: tool?.kind ?? null, outcome, reason, ms: Date.now() - started, bytes, truncated, args: auditArgs(args) },
    }, db).catch((err) => console.error('[mcp] audit failed', err instanceof Error ? err.message : err));
  }
}

/** Serve one Streamable HTTP request with a fresh, stateless server bound to this token's envelope. */
export async function serveMcp(request: Request, env: Envelope): Promise<Response> {
  const server = new Server({ name: 'capital-os', title: 'Capital OS', version: '1.0.0' }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listing(env) }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => callTool(env, req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: config.mcp.maxRequestBytes });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close().catch(() => undefined);
  }
}
