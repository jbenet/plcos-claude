import { getDb } from '@/lib/db';
import { allowed } from '@/lib/mcp/tools';
import { appendAudit, findMcpToken, type AppUser, type McpToken } from '@/modules/platform';
import { grantRefusal, heldScopes, SYNC_ENDPOINTS } from './scopes';

/**
 * Who may use the cloud sync endpoints (docs/deploy/railway.md §6–§7; Juan, 4 Oct 2026, decision G: no
 * public database port, so pulls and pushes go through the app and its own auth). A bearer token of the
 * endpoint's scope in its `tools` (lib/sync/scopes.ts, checked by the MCP registry's own `allowed`), live,
 * whose owner is active and still holds the access the scope's grant needs — an Admin for a snapshot, a Team member
 * or an Admin for a push — checked on every use, not only when it was made.
 * No cookie is read, and a request from a browser page (any Origin) is refused.
 *
 * Every use is one `mcp.call` row in platform.audit_log, the shape lib/mcp/audit.ts gives MCP and outreach
 * calls (no second log): via 'sync', the token's name as client, the endpoint as tool with its risk and
 * scopes, outcome, reason, time, bytes, plus counts and hashes — never content. So Developer → Agent
 * activity and audit_recent show sync calls beside the rest. A revoked, expired or inactive token is
 * `mcp.refused`, as on /api/mcp.
 */
export type SyncScope = 'snapshot' | 'push' | 'vehicles' | 'jobs' | 'feedback';
export interface SyncCaller { token: McpToken; user: AppUser }
/** mcp.call's outcomes; a duplicate push is 'ok' with duplicate: true, a busy endpoint 'refused' with reason busy. */
export type SyncOutcome = 'ok' | 'refused' | 'invalid' | 'error';

const json = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
export const syncError = (status: number, error: string, extra: Record<string, unknown> = {}) => json(status, { ok: false, error, ...extra });

export async function syncGuard(request: Request, scope: SyncScope): Promise<{ caller: SyncCaller } | { response: Response }> {
  if (request.headers.get('origin')) return { response: syncError(403, 'The sync endpoints take no browser requests; use scripts/cloud-pull.sh or scripts/cloud-push.sh.') };
  const challenge = { 'WWW-Authenticate': 'Bearer realm="capital-os-sync"' };
  const secret = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!secret) return { response: json(401, { ok: false, error: `Send a ${scope} token as "Authorization: Bearer <token>". An ${scope === 'push' ? 'Admin or a Team member' : 'Admin'} makes one in Preferences → MCP access.` }, challenge) };
  const db = await getDb();
  const found = await findMcpToken(secret, db, request.headers.get('user-agent'));
  if (!found) return { response: json(401, { ok: false, error: 'That token is not known here.' }, challenge) };
  if (found.state !== 'live') {
    await appendAudit({ actorId: found.user.id, action: 'mcp.refused', subjectType: 'mcp_token', subjectId: found.token.tokenId, detail: { reason: found.state, via: 'sync', tool: SYNC_ENDPOINTS[scope].name } }, db);
    return { response: json(401, { ok: false, error: `That token is ${found.state === 'inactive' ? 'for someone no longer active' : found.state}. Make a new one in Preferences.` }, challenge) };
  }
  const refuse = async (status: number, reason: string, error: string) => {
    await auditSync({ token: found.token, user: found.user }, scope, 'refused', { reason });
    return { response: json(status, { ok: false, error }) };
  };
  const endpoint = SYNC_ENDPOINTS[scope];
  if (!allowed({ tools: heldScopes(found.token.tools) }, endpoint as never)) return refuse(403, 'scope', `That token does not carry the ${endpoint.policy.scopes.join(', ')} scope.`);
  // The token's own scopes, not only the endpoint's: an Admin token whose owner is no longer an Admin opens nothing.
  if (grantRefusal(found.user, [...endpoint.policy.scopes, ...found.token.tools])) return refuse(403, 'role', scope === 'push' ? 'A push token works only while its owner is a Team member or an Admin.' : `A ${scope} token works only while its owner is an Admin.`);
  return { caller: { token: found.token, user: found.user } };
}

/** One `mcp.call` row for a sync use. `detail` carries counts, codes and hashes; never file content, names or the secret. */
export async function auditSync(caller: SyncCaller, endpoint: SyncScope, outcome: SyncOutcome, detail: Record<string, unknown> & { reason?: string; ms?: number; bytes?: number }): Promise<void> {
  const db = await getDb();
  const e = SYNC_ENDPOINTS[endpoint];
  const { reason, ms, bytes, ...rest } = detail;
  await appendAudit({ actorId: caller.user.id, action: 'mcp.call', subjectType: 'mcp_token', subjectId: caller.token.tokenId,
    detail: { via: 'sync', client: caller.token.label, tool: e.name, risk: e.policy.risk, scopes: [...e.policy.scopes], outcome,
      reason: reason ?? null, ms: ms ?? null, bytes: bytes ?? 0, truncated: false, inputHash: typeof rest.hash === 'string' ? rest.hash : null, args: {},
      affected: typeof rest.runId === 'string' ? { runId: rest.runId } : {}, idempotencyKey: typeof rest.hash === 'string' ? rest.hash : null,
      correlationId: null, origin: null, ...rest } }, db).catch((err) => console.error('[sync] audit failed', err instanceof Error ? err.message : err));
}
