import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { config } from '@/config/deployment';
import { actAs } from '@/lib/auth/acting';
import { getDb } from '@/lib/db';
import { MutationGuardError } from '@/lib/mutation-policy';
import { appendAudit, findMcpToken } from '@/modules/platform';
import { admitCall, envelopeFor, type Envelope } from './envelope';
import { render as renderAnswer, DATA_NOTICE, type Answer } from './output';
import { auditDetail, autonomousOf, correlationOf, type CallMeta } from './audit';
import { AuthorizationError } from '@/lib/authz';
import { ToolRefused } from './reads';
import { OutreachRefused } from '@/lib/outreach/reads';
import { allowed, findTool, listing } from './tools';

/**
 * Capital OS over MCP (docs/26-mcp.md): Streamable HTTP at /api/mcp, stateless — each POST is a
 * whole exchange, answered as JSON — inside the Next server, so one process serves the app and MCP.
 */

export const INSTRUCTIONS = [
  'Capital OS: fundraising records for PLC\'s vehicles. These tools read records, write drafts and proposals, and — with the',
  'outreach scope — record what a person ticked through the app\'s own guards, and the mail trace. None sends an email, approves or',
  'accepts anything, records a ladder rung, or moves money. A person does those in the app.',
  'When no person is in the loop for a call, say so (_meta.autonomous: true): an autonomous send or intro ask needs an approved ticket.',
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
  const found = await findMcpToken(secret, db, request.headers.get('user-agent'));
  if (!found) return deny(401, 'That token is not known here.', challenge);
  if (found.state !== 'live') {
    await appendAudit({ actorId: found.user.id, action: 'mcp.refused', subjectType: 'mcp_token', subjectId: found.token.tokenId, detail: { reason: found.state } }, db);
    return deny(401, `That token is ${found.state === 'inactive' ? 'for someone no longer active' : found.state}. Make a new one in Preferences.`, challenge);
  }
  return { env: envelopeFor(found.token, found.user) };
}

export type Outcome = 'ok' | 'refused' | 'rate_limited' | 'invalid' | 'error';
export type RunResult = { ok: true; answer: Answer; text: string | null } | { ok: false; outcome: Outcome; status: number; message: string };

/**
 * One tool call, from MCP or the outreach REST wrapper: the policy, the envelope, the input, the tool as its
 * owner — and always one audit record (lib/mcp/audit.ts). `render` (MCP) marks and size-limits the answer.
 */
export async function runTool(env0: Envelope, name: string, args: Record<string, unknown>, meta: CallMeta, render = false): Promise<RunResult> {
  const started = Date.now();
  // A call may add autonomy, never remove it (modules/governance/autonomy.ts).
  const env: Envelope = { ...env0, via: meta.via, autonomous: env0.autonomous || meta.autonomous === true };
  const db = await getDb();
  const tool = findTool(name);
  let outcome: Outcome = 'ok', reason: string | null = null, bytes = 0, truncated = false, answer: Answer | null = null;
  const fail = (o: Outcome, status: number, message: string): RunResult => {
    outcome = o; reason = message.slice(0, 300);
    return { ok: false, outcome: o, status, message };
  };
  try {
    if (!tool) return fail('refused', 404, `There is no tool "${name}". The server decides which tools exist.`);
    const refusal = await admitCall(env, tool.name, db, Date.now(), allowed(env, tool));
    if (refusal) {
      const limited = refusal.startsWith('More than') || refusal.includes('budget');
      const scoped = tool.policy.scopes.length ? `This token does not carry the ${tool.policy.scopes.join(' and ')} scope.` : refusal;
      return fail(limited ? 'rate_limited' : 'refused', limited ? 429 : 403, limited || allowed(env, tool) ? refusal : scoped);
    }
    const parsed = tool.input.safeParse(args ?? {});
    if (!parsed.success) return fail('invalid', 400, `Arguments not accepted: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`.slice(0, 600));
    answer = await actAs(env.principal, () => tool.run(env, parsed.data));
    if (render) {
      const out = renderAnswer(tool.name, answer);
      bytes = out.bytes; truncated = out.truncated;
      return { ok: true, answer, text: out.text };
    }
    bytes = Buffer.byteLength(JSON.stringify(answer.data ?? null));
    return { ok: true, answer, text: null };
  } catch (e) {
    if (e instanceof OutreachRefused) return fail('refused', e.status, e.message);
    if (e instanceof ToolRefused) return fail('refused', 404, e.message);
    if (e instanceof MutationGuardError) return fail('refused', e.status, e.message);
    if (e instanceof AuthorizationError) return fail('refused', 403, 'You may not do that for this LP or vehicle.');
    console.error('[mcp]', name, e instanceof Error ? e.message : e);
    return fail('error', 500, 'The tool failed on the server. Nothing was changed by this call unless it says otherwise; try again, or use the app.');
  } finally {
    await appendAudit({
      actorId: env.owner.id, action: 'mcp.call', subjectType: 'mcp_token', subjectId: env.tokenId,
      detail: auditDetail(env, { tool: name, risk: tool?.policy.risk ?? null, scopes: tool?.policy.scopes ?? [], meta, outcome, reason,
        ms: Date.now() - started, bytes, truncated, args, answer }),
    }, db).catch((err) => console.error('[mcp] audit failed', err instanceof Error ? err.message : err));
  }
}

/** One MCP tool call: runTool, answered as MCP content. */
export async function callTool(env: Envelope, name: string, args: Record<string, unknown>, meta: CallMeta = { via: 'mcp', correlationId: null }): Promise<CallToolResult> {
  const r = await runTool(env, name, args, meta, true);
  // An error carries the same HTTP-style status REST answers (400, 403, 404, 409, 422, 429…) in _meta.status (docs/26 §3).
  return r.ok ? { content: [{ type: 'text', text: r.text! }] } : { isError: true, content: [{ type: 'text', text: r.message }], _meta: { status: r.status } };
}

/** Serve one Streamable HTTP request with a fresh, stateless server bound to this token's envelope. */
export async function serveMcp(request: Request, env: Envelope): Promise<Response> {
  const server = new Server({ name: 'capital-os', title: 'Capital OS', version: '1.0.0' }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: listing(env) }));
  // A client may tie a chain of calls together: _meta.correlationId on the call, or an X-Correlation-Id header.
  const header = correlationOf(request.headers.get('x-correlation-id'));
  const autonomousHeader = autonomousOf(request.headers.get('x-autonomous'));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const m = req.params._meta as Record<string, unknown> | undefined;
    return callTool(env, req.params.name, (req.params.arguments ?? {}) as Record<string, unknown>,
      { via: 'mcp', correlationId: correlationOf(m?.correlationId) ?? header, autonomous: autonomousOf(m?.autonomous) || autonomousHeader });
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: config.mcp.maxRequestBytes });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close().catch(() => undefined);
  }
}
