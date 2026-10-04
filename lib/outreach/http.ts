import { z } from 'zod';
import { config } from '@/config/deployment';
import { actAs } from '@/lib/auth/acting';
import { AuthorizationError } from '@/lib/authz';
import { getDb } from '@/lib/db';
import { admitCall, auditArgs, envelopeFor, type Envelope } from '@/lib/mcp/envelope';
import { DATA_NOTICE } from '@/lib/mcp/output';
import { MutationGuardError } from '@/lib/mutation-policy';
import { appendAudit, findMcpToken } from '@/modules/platform';
import { BUCKETS, OutreachRefused, outreachQueue, outreachVehicles } from './reads';
import { OUTREACH_READ, type OutreachScope } from './scopes';
import { WRITE_OPS } from './writes';

/**
 * /api/outreach/* for the mail desk (docs/27-outreach-api.md). A bearer token — an MCP token carrying the
 * outreach scope — not a cookie: a device app, a server elsewhere and (later) a browser client all send the
 * same header. Each call:
 *   1. CORS: a request with an Origin is refused unless it is this server's own origin or one listed in
 *      config.outreach.corsOrigins (empty by default; exact origins, never a wildcard);
 *   2. the token: known, live, its owner active; the envelope narrows the owner (lib/mcp/envelope.ts);
 *   3. the scope: outreach:read for GET, outreach:write for POST, granted apart;
 *   4. the budget: the token's calls a minute and a day, shared with its MCP calls;
 *   5. the service, as the token's principal (actAs), through lib/authz and the UI's own rules;
 *   6. an audit entry, always: `outreach.call` with the op, the outcome and the arguments as ids and lengths.
 */

export interface DeskContext { env: Envelope; request: Request }
type Handler = (ctx: DeskContext, input: Record<string, unknown>) => Promise<{ data: unknown; [k: string]: unknown }>;
export interface Op { method: 'GET' | 'POST'; scope: OutreachScope; input: z.ZodType; run: Handler }

const vehicleRef = z.string().min(1).max(80);
const READS: Record<string, Op> = {
  vehicles: { method: 'GET', scope: OUTREACH_READ, input: z.object({}).strict(), run: async ({ env }) => outreachVehicles(env.principal) },
  queue: {
    method: 'GET', scope: OUTREACH_READ,
    input: z.object({
      vehicle: vehicleRef, bucket: z.enum(BUCKETS as [string, ...string[]]).optional(),
      limit: z.coerce.number().int().min(1).max(1000).optional(), offset: z.coerce.number().int().min(0).max(100000).optional(),
      pursuitId: z.string().uuid().optional(),
    }).strict(),
    run: async ({ env }, a) => outreachQueue(env.principal, a as never),
  },
};

/** The operations: these and no others. A name absent here does not exist on the server. */
const OPS: Record<string, Op> = { ...READS, ...WRITE_OPS };

// ── CORS ────────────────────────────────────────────────────────────────────────────────

/** null: no Origin (a device or a server) or same-origin; a string: an allowlisted origin; false: refused. */
export function corsOrigin(request: Request): string | null | false {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  const url = new URL(request.url);
  if (origin === `${url.protocol}//${request.headers.get('host') || url.host}`) return null;
  return config.outreach.corsOrigins.includes(origin) ? origin : false;
}

/**
 * CORS headers for an allowlisted origin. No Allow-Credentials: the API never reads a cookie, and the token
 * travels in the Authorization header, which the preflight allows explicitly.
 */
function corsHeaders(origin: string | null): Record<string, string> {
  return origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Expose-Headers': 'Retry-After' } : { Vary: 'Origin' };
}

export function preflight(request: Request): Response {
  const origin = corsOrigin(request);
  if (!origin) return new Response(null, { status: 403, headers: { Vary: 'Origin' } });
  return new Response(null, { status: 204, headers: {
    ...corsHeaders(origin), 'Access-Control-Allow-Methods': 'GET, POST',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600',
  } });
}

// ── One call ────────────────────────────────────────────────────────────────────────────

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });

export async function serveOutreach(request: Request, op: string, method: 'GET' | 'POST'): Promise<Response> {
  const started = Date.now();
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
    await appendAudit({ actorId: found.user.id, action: 'mcp.refused', subjectType: 'mcp_token', subjectId: found.token.tokenId, detail: { reason: found.state, via: 'outreach' } }, db);
    return fail(401, `That token is ${found.state === 'inactive' ? 'for someone no longer active' : found.state}.`, challenge);
  }
  const env = envelopeFor(found.token, found.user);
  const spec = Object.hasOwn(OPS, op) ? OPS[op]! : null;

  let outcome: 'ok' | 'refused' | 'rate_limited' | 'invalid' | 'error' = 'ok', status = 200, reason: string | null = null;
  let args: Record<string, unknown> = {};
  try {
    if (!spec) { outcome = 'refused'; status = 404; reason = `No operation "${op.slice(0, 40)}".`; return fail(status, reason); }
    if (spec.method !== method) { outcome = 'refused'; status = 405; reason = `${op} takes ${spec.method}.`; return fail(status, reason, { Allow: spec.method }); }
    if (!env.tools.has(spec.scope)) {
      outcome = 'refused'; status = 403; reason = `This token does not carry the ${spec.scope} scope.`;
      return fail(status, reason);
    }
    const refusal = await admitCall(env, spec.scope, db);
    if (refusal) {
      const limited = refusal.startsWith('More than') || refusal.includes('budget');
      outcome = limited ? 'rate_limited' : 'refused'; status = limited ? 429 : 403; reason = refusal;
      return fail(status, refusal, limited ? { 'Retry-After': '60' } : {});
    }
    if (method === 'GET') args = Object.fromEntries(new URL(request.url).searchParams);
    else {
      try { args = (await request.json()) as Record<string, unknown>; } catch { outcome = 'invalid'; status = 400; reason = 'The body is not JSON.'; return fail(status, reason); }
      if (!args || typeof args !== 'object' || Array.isArray(args)) { outcome = 'invalid'; status = 400; reason = 'The body is a JSON object.'; return fail(status, reason); }
    }
    const parsed = spec.input.safeParse(args);
    if (!parsed.success) {
      outcome = 'invalid'; status = 400;
      reason = `Not accepted: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`.slice(0, 600);
      return fail(status, reason);
    }
    const answer = await actAs(env.principal, () => spec.run({ env, request }, parsed.data as Record<string, unknown>));
    const { data, ...rest } = answer;
    return json(200, { about: DATA_NOTICE, op, asOf: new Date().toISOString(), ...rest, data }, cors);
  } catch (e) {
    if (e instanceof OutreachRefused) { outcome = 'refused'; status = e.status; reason = e.message; return fail(status, e.message); }
    if (e instanceof AuthorizationError) { outcome = 'refused'; status = 403; reason = e.message; return fail(status, 'You may not do that for this LP or vehicle.'); }
    if (e instanceof MutationGuardError) { outcome = 'refused'; status = e.status; reason = e.message; return fail(status, e.message); }
    outcome = 'error'; status = 500;
    console.error('[outreach]', op, e instanceof Error ? e.message : e);
    return fail(500, 'The operation failed on the server. Nothing was changed by this call unless it says otherwise.');
  } finally {
    await appendAudit({
      actorId: env.owner.id, action: 'outreach.call', subjectType: 'mcp_token', subjectId: env.tokenId,
      detail: { op: op.slice(0, 40), method, outcome, status, reason: reason?.slice(0, 300) ?? null, ms: Date.now() - started, origin: origin || null, args: auditArgs(args) },
    }, db).catch((err) => console.error('[outreach] audit failed', err instanceof Error ? err.message : err));
  }
}
