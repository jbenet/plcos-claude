import { config } from '@/config/deployment';
import { getDb } from '@/lib/db';
import { autonomousOf, correlationOf } from '@/lib/mcp/audit';
import { envelopeFor } from '@/lib/mcp/envelope';
import { DATA_NOTICE } from '@/lib/mcp/output';
import { runTool } from '@/lib/mcp/server';
import { appendAudit, findMcpToken } from '@/modules/platform';

/**
 * /api/outreach/* (docs/27-outreach-api.md): a thin REST wrapper over the MCP outreach tools, for a client that
 * would rather speak HTTP+JSON than MCP. MCP is the primary interface; each REST op is one MCP tool, run by the
 * same runTool — the same policy, scopes, envelope, budget and audit record (via 'rest'). This file adds only
 * what HTTP needs: the bearer token, CORS, the method, and the query string.
 *
 * CORS: a request with an Origin is refused unless it is this server's own or listed in
 * config.outreach.corsOrigins (empty by default; exact origins, never a wildcard). Never Allow-Credentials:
 * the API reads no cookie.
 */

/** `rename`: a query parameter the REST op names differently from the tool's argument (routes take entityId). */
const OPS: Record<string, { tool: string; method: 'GET' | 'POST'; rename?: Record<string, string> }> = {
  vehicles: { tool: 'outreach_vehicles', method: 'GET' },
  queue: { tool: 'outreach_queue', method: 'GET' },
  connectors: { tool: 'top_connectors', method: 'GET' },
  // Thin wrappers over the MCP route tools (docs/27 §4a): the same tool, its own scopes, the same answer.
  'routes-to': { tool: 'routes_to', method: 'GET', rename: { entityId: 'targetId' } },
  'routes-through': { tool: 'routes_through', method: 'GET', rename: { entityId: 'nodeId' } },
  update: { tool: 'outreach_update', method: 'POST' },
  tickets: { tool: 'outreach_request_ticket', method: 'POST' },
  contacts: { tool: 'outreach_propose_contact', method: 'POST' },
  link: { tool: 'outreach_link_message', method: 'POST' },
  // Deprecated for one release (5 Oct 2026): /sent runs the old name, an alias of outreach_link_message.
  sent: { tool: 'outreach_record_send', method: 'POST' },
  comms: { tool: 'comms_ingest', method: 'POST' },
  trace: { tool: 'comms_trace', method: 'GET' },
  audit: { tool: 'audit_recent', method: 'GET' },
};

/** null: no Origin (a device or a server) or same-origin; a string: an allowlisted origin; false: refused. */
export function corsOrigin(request: Request): string | null | false {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  const url = new URL(request.url);
  if (origin === `${url.protocol}//${request.headers.get('host') || url.host}`) return null;
  return config.outreach.corsOrigins.includes(origin) ? origin : false;
}

function corsHeaders(origin: string | null): Record<string, string> {
  return origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Expose-Headers': 'Retry-After' } : { Vary: 'Origin' };
}

export function preflight(request: Request): Response {
  const origin = corsOrigin(request);
  if (!origin) return new Response(null, { status: 403, headers: { Vary: 'Origin' } });
  return new Response(null, { status: 204, headers: {
    ...corsHeaders(origin), 'Access-Control-Allow-Methods': 'GET, POST',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Correlation-Id, X-Autonomous', 'Access-Control-Max-Age': '600',
  } });
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

/** Query strings are text; the tools take numbers and booleans where they mean them. */
function queryArgs(url: URL, rename: Record<string, string> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k0, v] of url.searchParams) {
    const k = Object.hasOwn(rename, k0) ? rename[k0]! : k0;
    out[k] = /^(limit|offset)$/.test(k) && /^\d+$/.test(v) ? Number(v)
      : k === 'includePassed' && /^(1|true|0|false)$/.test(v) ? v === '1' || v === 'true' : v;
  }
  return out;
}

export async function serveOutreach(request: Request, op: string, method: 'GET' | 'POST'): Promise<Response> {
  const origin = corsOrigin(request);
  const cors = corsHeaders(origin || null);
  const fail = (status: number, error: string, extra: Record<string, string> = {}) => json(status, { error }, { ...cors, ...extra });
  if (!config.outreach.enabled) return fail(404, 'The outreach API is off on this server.');
  if (origin === false) return json(403, { error: 'Cross-site requests are refused. A browser client needs its origin on the allowlist (docs/27 §6).' }, { Vary: 'Origin' });
  if (Number(request.headers.get('content-length') ?? 0) > config.mcp.maxRequestBytes) return fail(413, 'The request is too large.');
  const challenge = { 'WWW-Authenticate': 'Bearer realm="capital-os"' };
  const secret = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!secret) return fail(401, 'Send your token as "Authorization: Bearer <token>". An Admin makes one in Preferences → MCP access.', challenge);
  const db = await getDb();
  const found = await findMcpToken(secret, db, request.headers.get('user-agent'));
  if (!found) return fail(401, 'That token is not known here.', challenge);
  if (found.state !== 'live') {
    await appendAudit({ actorId: found.user.id, action: 'mcp.refused', subjectType: 'mcp_token', subjectId: found.token.tokenId, detail: { reason: found.state, via: 'rest' } }, db);
    return fail(401, `That token is ${found.state === 'inactive' ? 'for someone no longer active' : found.state}.`, challenge);
  }
  const env = envelopeFor(found.token, found.user);
  const meta = { via: 'rest' as const, correlationId: correlationOf(request.headers.get('x-correlation-id')), origin: origin || null,
    autonomous: autonomousOf(request.headers.get('x-autonomous')) };
  const spec = Object.hasOwn(OPS, op) ? OPS[op]! : null;
  // An unknown op or the wrong method is still a call: logged under its own name, refused.
  if (!spec || spec.method !== method) {
    const r = await runTool(env, `rest:${op.slice(0, 40)}`, {}, meta);
    const msg = !spec ? `No operation "${op.slice(0, 40)}".` : `${op} takes ${spec.method}.`;
    return r.ok ? fail(500, 'Unexpected.') : fail(spec ? 405 : 404, msg, spec ? { Allow: spec.method } : {});
  }
  let args: Record<string, unknown>;
  if (method === 'GET') args = queryArgs(new URL(request.url), spec.rename);
  else {
    try { args = (await request.json()) as Record<string, unknown>; } catch { return fail(400, 'The body is not JSON.'); }
    if (!args || typeof args !== 'object' || Array.isArray(args)) return fail(400, 'The body is a JSON object.');
  }
  const r = await runTool(env, spec.tool, args, meta);
  if (!r.ok) return fail(r.status, r.message, r.status === 429 ? { 'Retry-After': '60' } : {});
  return json(200, { about: DATA_NOTICE, op, tool: spec.tool, asOf: r.answer.asOf ?? new Date().toISOString(), coverage: r.answer.coverage ?? null, data: r.answer.data }, cors);
}
