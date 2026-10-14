import { config } from '@/config/deployment';
import { getDb } from '@/lib/db';
import { withQueryTimings } from '@/lib/db/timing';
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

/**
 * `rename`: a query parameter the REST op names differently from the tool's argument (routes take entityId).
 * `get`: the tool a GET of a POST op runs instead (/contacts: POST proposes an address, GET reads every LP's).
 * `del`: the tool a DELETE of a POST op runs, with its arguments in the query string (/lps: POST adds, DELETE undoes).
 */
type Method = 'GET' | 'POST' | 'DELETE';
type Op = { tool: string; method: Method; rename?: Record<string, string>; get?: { tool: string }; del?: { tool: string } };
const OPS: Record<string, Op> = {
  vehicles: { tool: 'outreach_vehicles', method: 'GET' },
  queue: { tool: 'outreach_queue', method: 'GET' },
  // With entityId, one connector's targets (docs/27 §4c): the same tool, which answers that list instead.
  connectors: { tool: 'top_connectors', method: 'GET' },
  // Thin wrappers over the MCP route tools (docs/27 §4a): the same tool, its own scopes, the same answer.
  'routes-to': { tool: 'routes_to', method: 'GET', rename: { entityId: 'targetId' } },
  'routes-through': { tool: 'routes_through', method: 'GET', rename: { entityId: 'nodeId' } },
  // The MCP search tool over REST (7 Oct 2026, juanmail's Intros page): find a person or organisation by name.
  search: { tool: 'search', method: 'GET' },
  update: { tool: 'outreach_update', method: 'POST' },
  tickets: { tool: 'outreach_request_ticket', method: 'POST' },
  // GET reads every LP's pursuit, status and addresses (docs/27 §4d); POST records one address confirmed in Gmail.
  contacts: { tool: 'outreach_propose_contact', method: 'POST', get: { tool: 'outreach_contacts' } },
  link: { tool: 'outreach_link_message', method: 'POST' },
  // Deprecated for one release (5 Oct 2026): /sent runs the old name, an alias of outreach_link_message.
  sent: { tool: 'outreach_record_send', method: 'POST' },
  comms: { tool: 'comms_ingest', method: 'POST' },
  // What the mail says (docs/29): POST records a message's signals, GET reads one LP's.
  signals: { tool: 'outreach_record_signals', method: 'POST', get: { tool: 'outreach_signals' } },
  insights: { tool: 'outreach_insights', method: 'GET' },
  playbook: { tool: 'outreach_playbook', method: 'GET' },
  // An LP added from mail (docs/27 §5); DELETE ?pursuitId= undoes one this op added, within a day.
  lps: { tool: 'outreach_add_lp', method: 'POST', del: { tool: 'outreach_undo_add_lp' } },
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
    ...corsHeaders(origin), 'Access-Control-Allow-Methods': 'GET, POST, DELETE',
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
    out[k] = /^(limit|offset|maxWaitMs|sinceDays|examples)$/.test(k) && /^\d+$/.test(v) ? Number(v)
      : /^(includePassed|firstHopOnly|details)$/.test(k) && /^(1|true|0|false)$/.test(v) ? v === '1' || v === 'true' : v;
  }
  return out;
}

/** GUESS: a call this slow gets a line in the server log, with where its time went. */
export const SLOW_OUTREACH_MS = 1_000;

/**
 * Each outreach call that is slow or fails, as one line in the server log: the op, the status, the
 * time, how many queries it ran and their time (which includes waiting for a connection), its slowest
 * query, and the connection pool as it began and ended. No token, arguments, SQL or data. It tells a
 * slow query from a pool that was full (JuanMail, 7 Oct 2026: /vehicles sometimes over 15 s).
 */
export async function serveOutreach(request: Request, op: string, method: Method): Promise<Response> {
  const start = performance.now();
  const db = await getDb();
  const poolAt = db.poolState?.();
  let queries = 0, sqlMs = 0, slowest = 0;
  const response = await withQueryTimings(({ milliseconds }) => { queries += 1; sqlMs += milliseconds; slowest = Math.max(slowest, milliseconds); },
    () => serve(request, op, method));
  const ms = Math.round(performance.now() - start);
  if (ms >= SLOW_OUTREACH_MS || response.status >= 500) {
    const pool = (p?: { total: number; idle: number; waiting: number }) => (p ? `${p.total - p.idle}/${p.total} busy, ${p.waiting} waiting` : 'n/a');
    console.info(`[outreach] ${method} ${op.slice(0, 40).replace(/[^\w-]/g, '?')} ${response.status} ${ms}ms · ${queries} queries, ${Math.round(sqlMs)}ms in them, slowest ${Math.round(slowest)}ms · pool at start ${pool(poolAt)}, at end ${pool(db.poolState?.())}`);
  }
  return response;
}

async function serve(request: Request, op: string, method: Method): Promise<Response> {
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
  const entry = Object.hasOwn(OPS, op) ? OPS[op]! : null;
  const spec: Op | null = entry?.get && method === 'GET' ? { tool: entry.get.tool, method: 'GET' }
    : entry?.del && method === 'DELETE' ? { tool: entry.del.tool, method: 'DELETE' } : entry;
  // An unknown op or the wrong method is still a call: logged under its own name, refused.
  if (!spec || spec.method !== method) {
    const r = await runTool(env, `rest:${op.slice(0, 40)}`, {}, meta);
    const allow = [spec?.get ? 'GET' : null, spec?.method, spec?.del ? 'DELETE' : null].filter(Boolean).join(', ');
    const msg = !spec ? `No operation "${op.slice(0, 40)}".` : `${op} takes ${allow}.`;
    return r.ok ? fail(500, 'Unexpected.') : fail(spec ? 405 : 404, msg, spec ? { Allow: allow } : {});
  }
  let args: Record<string, unknown>;
  if (method === 'GET' || method === 'DELETE') args = queryArgs(new URL(request.url), spec.rename);
  else {
    try { args = (await request.json()) as Record<string, unknown>; } catch { return fail(400, 'The body is not JSON.'); }
    if (!args || typeof args !== 'object' || Array.isArray(args)) return fail(400, 'The body is a JSON object.');
  }
  const r = await runTool(env, spec.tool, args, meta);
  if (!r.ok) return fail(r.status, r.message);
  return json(200, { about: DATA_NOTICE, op, tool: spec.tool, asOf: r.answer.asOf ?? new Date().toISOString(), coverage: r.answer.coverage ?? null, data: r.answer.data }, cors);
}
