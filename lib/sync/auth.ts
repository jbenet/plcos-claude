import { getDb } from '@/lib/db';
import { appendAudit, findMcpToken, maySyncScope, type AppUser, type McpToken } from '@/modules/platform';

/**
 * Who may use the cloud sync endpoints (docs/deploy/railway.md §6–§7; Juan, 4 Oct 2026, decision G: no
 * public database port, so pulls and pushes go through the app and its own auth). A bearer token of the
 * endpoint's own scope, live, whose owner is active and still holds the access the scope needs — an
 * Admin for a snapshot, a GP or an Admin for a push — checked on every use, not only when it was made.
 * No cookie is read, and a request from a browser page (any Origin) is refused.
 *
 * Every use is audit-logged as `sync.call`, the shape of `mcp.call`: the token, its owner, the endpoint,
 * the outcome, time and bytes — never content. A refused known token is `sync.refused`.
 */
export type SyncScope = 'snapshot' | 'push';
export interface SyncCaller { token: McpToken; user: AppUser }
export type SyncOutcome = 'ok' | 'refused' | 'rejected' | 'duplicate' | 'busy' | 'error';

const json = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
export const syncError = (status: number, error: string, extra: Record<string, unknown> = {}) => json(status, { ok: false, error, ...extra });

export async function syncGuard(request: Request, scope: SyncScope): Promise<{ caller: SyncCaller } | { response: Response }> {
  if (request.headers.get('origin')) return { response: syncError(403, 'The sync endpoints take no browser requests; use scripts/cloud-pull.sh or scripts/cloud-push.sh.') };
  const challenge = { 'WWW-Authenticate': 'Bearer realm="capital-os-sync"' };
  const secret = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!secret) return { response: json(401, { ok: false, error: `Send a ${scope} token as "Authorization: Bearer <token>". An ${scope === 'snapshot' ? 'Admin' : 'Admin or a GP'} makes one in Preferences → MCP access.` }, challenge) };
  const db = await getDb();
  const found = await findMcpToken(secret, db);
  if (!found) return { response: json(401, { ok: false, error: 'That token is not known here.' }, challenge) };
  const refuse = async (status: number, reason: string, error: string) => {
    await appendAudit({ actorId: found.user.id, action: 'sync.refused', subjectType: 'mcp_token', subjectId: found.token.tokenId,
      detail: { endpoint: scope, reason, scope: found.token.scope } }, db);
    return { response: json(status, { ok: false, error }, status === 401 ? challenge : {}) };
  };
  if (found.state !== 'live') return refuse(401, found.state, `That token is ${found.state === 'inactive' ? 'for someone no longer active' : found.state}. Make a new one in Preferences.`);
  if (found.token.scope !== scope) return refuse(403, 'scope', `That token is not a ${scope} token.`);
  if (!maySyncScope(found.user, scope)) return refuse(403, 'role', scope === 'snapshot' ? 'A snapshot token works only while its owner is an Admin.' : 'A push token works only while its owner is a GP or an Admin.');
  return { caller: { token: found.token, user: found.user } };
}

/** One `sync.call` entry. Detail carries counts, codes and hashes; never file content, names or the secret. */
export async function auditSync(caller: SyncCaller, endpoint: SyncScope, outcome: SyncOutcome, detail: Record<string, unknown>): Promise<void> {
  const db = await getDb();
  await appendAudit({ actorId: caller.user.id, action: 'sync.call', subjectType: 'mcp_token', subjectId: caller.token.tokenId,
    detail: { endpoint, outcome, ...detail } }, db).catch((err) => console.error('[sync] audit failed', err instanceof Error ? err.message : err));
}
