import { createHash, randomBytes } from 'node:crypto';
import { getDb, type Db, type Queryable } from '@/lib/db';
import { appendAudit } from './repo';
import type { AppUser } from './types';

/**
 * MCP tokens (docs/26-mcp.md). A token is shown once, when it is made; only its SHA-256 is kept.
 * Each row is also the token's work envelope: tools, vehicles (narrowing its owner's), a daily
 * call budget and an expiry. Every make and revoke is audit-logged with the token's id and
 * prefix, never the secret.
 */

export interface McpToken {
  tokenId: string;
  userId: string;
  label: string;
  prefix: string;
  tools: string[];
  vehicles: string[] | null;
  callsPerDay: number;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  /** What the token is for (migration 015): the MCP endpoint, a database snapshot, or a research push. */
  scope: TokenScope;
}

/**
 * One scope per token. 'snapshot' and 'push' are the cloud sync tokens (docs/deploy/railway.md §6–§7):
 * they reach only /api/sync/snapshot and /api/sync/push, and the MCP endpoint refuses them.
 */
export type TokenScope = 'mcp' | 'snapshot' | 'push';
export const TOKEN_SCOPES: readonly TokenScope[] = ['mcp', 'snapshot', 'push'];
const PREFIXES: Record<TokenScope, string> = { mcp: 'plcos_mcp_', snapshot: 'plcos_snap_', push: 'plcos_push_' };
const PREFIX = PREFIXES.mcp;
export const hashToken = (secret: string) => createHash('sha256').update(secret, 'utf8').digest('hex');
/** 32 random bytes; the visible prefix says what the string is if it turns up somewhere. */
export const newTokenSecret = (scope: TokenScope = 'mcp') => `${PREFIXES[scope]}${randomBytes(32).toString('base64url')}`;
export const looksLikeToken = (s: string) => Object.values(PREFIXES).some((p) => s.startsWith(p)) && /^[A-Za-z0-9_-]{40,80}$/.test(s);

const cols = (t = '') => `${t}token_id::text "tokenId", ${t}user_id::text "userId", ${t}label, ${t}prefix, ${t}tools,
  ${t}vehicles::text[] vehicles, ${t}calls_per_day "callsPerDay", ${t}created_at "createdAt", ${t}expires_at "expiresAt",
  ${t}last_used_at "lastUsedAt", ${t}revoked_at "revokedAt", ${t}scope`;

export interface NewToken { label: string; tools: string[]; vehicles: string[] | null; callsPerDay: number; days: number }

export async function createMcpToken(owner: AppUser, t: NewToken, q?: Db): Promise<{ token: McpToken; secret: string }> {
  const secret = newTokenSecret();
  const db = q ?? await getDb();
  const token = await db.transaction(async (tx) => {
    const token = (await tx.one<McpToken>(`insert into platform.mcp_token (user_id, label, token_hash, prefix, tools, vehicles, calls_per_day, expires_at)
      values ($1, $2, $3, $4, $5, $6::uuid[], $7, now() + make_interval(days => $8)) returning ${cols()}`,
    [owner.id, t.label, hashToken(secret), secret.slice(0, PREFIX.length + 4), t.tools, t.vehicles, t.callsPerDay, t.days]))!;
    await appendAudit({ actorId: owner.id, action: 'mcp.token_created', subjectType: 'mcp_token', subjectId: token.tokenId,
      detail: { prefix: token.prefix, tools: t.tools, vehicles: t.vehicles, callsPerDay: t.callsPerDay, days: t.days } }, tx);
    return token;
  });
  return { token, secret };
}

/** Who may make a sync token: a snapshot is the whole database, so Admins only; a push, a GP or an Admin. */
export function maySyncScope(owner: Pick<AppUser, 'access'>, scope: Exclude<TokenScope, 'mcp'>): boolean {
  return scope === 'snapshot' ? owner.access === 'admin' : owner.access === 'admin' || owner.access === 'gp';
}
export class TokenRefused extends Error {}

/**
 * A cloud sync token (docs/deploy/railway.md §6–§7). No tools and no vehicles: it reaches one sync
 * endpoint, checked again on every use against its owner's current access. The service refuses a
 * scope the owner may not have, whatever the caller checked first.
 */
export async function createSyncToken(owner: AppUser, t: { label: string; scope: Exclude<TokenScope, 'mcp'>; days: number }, q?: Db): Promise<{ token: McpToken; secret: string }> {
  if (!['snapshot', 'push'].includes(t.scope)) throw new TokenRefused('Unknown token scope.');
  if (!maySyncScope(owner, t.scope)) throw new TokenRefused(t.scope === 'snapshot' ? 'Only an Admin can make a snapshot token.' : 'Only a GP or an Admin can make a push token.');
  const secret = newTokenSecret(t.scope);
  const db = q ?? await getDb();
  const token = await db.transaction(async (tx) => {
    const token = (await tx.one<McpToken>(`insert into platform.mcp_token (user_id, label, token_hash, prefix, tools, vehicles, calls_per_day, expires_at, scope)
      values ($1, $2, $3, $4, '{}', null, 1, now() + make_interval(days => $5), $6) returning ${cols()}`,
    [owner.id, t.label, hashToken(secret), secret.slice(0, PREFIXES[t.scope].length + 4), t.days, t.scope]))!;
    await appendAudit({ actorId: owner.id, action: 'mcp.token_created', subjectType: 'mcp_token', subjectId: token.tokenId,
      detail: { prefix: token.prefix, scope: t.scope, days: t.days } }, tx);
    return token;
  });
  return { token, secret };
}

export async function listMcpTokens(userId: string, q?: Queryable): Promise<McpToken[]> {
  const db = q ?? await getDb();
  return db.query<McpToken>(`select ${cols()} from platform.mcp_token where user_id = $1 order by revoked_at is not null, created_at desc limit 50`, [userId]);
}

/** Revoke one of your own tokens. Revoking twice is harmless and logs nothing new. */
export async function revokeMcpToken(owner: AppUser, tokenId: string, q?: Queryable): Promise<boolean> {
  const db = q ?? await getDb();
  const row = await db.one<{ prefix: string }>(`update platform.mcp_token set revoked_at = now(), revoked_by = $2
    where token_id = $1 and user_id = $2 and revoked_at is null returning prefix`, [tokenId, owner.id]);
  if (!row) return false;
  await appendAudit({ actorId: owner.id, action: 'mcp.token_revoked', subjectType: 'mcp_token', subjectId: tokenId, detail: { prefix: row.prefix } }, db);
  return true;
}

/**
 * The token a secret names and whether it may be used: 'live', or why not. Null when no token has
 * that hash. Marks a live token used at most once a minute, so a busy client does not write a row a call.
 */
export type TokenState = 'live' | 'revoked' | 'expired' | 'inactive';
export async function findMcpToken(secret: string, q?: Queryable): Promise<{ token: McpToken; user: AppUser; state: TokenState } | null> {
  if (!looksLikeToken(secret)) return null;
  const db = q ?? await getDb();
  const row = await db.one<McpToken & { user: AppUser; active: boolean; expired: boolean }>(`select ${cols('t.')},
      json_build_object('id', u.id, 'handle', u.handle, 'name', u.name, 'initials', u.initials, 'role', u.role, 'email', u.email,
        'access', u.access::text, 'vehicles', u.vehicles, 'approves', u.approves) "user", u.active, t.expires_at <= now() expired
    from platform.mcp_token t join platform.app_user u on u.id = t.user_id
    where t.token_hash = $1`, [hashToken(secret)]);
  if (!row) return null;
  const { user, active, expired, ...token } = row;
  const state: TokenState = token.revokedAt ? 'revoked' : expired ? 'expired' : !active ? 'inactive' : 'live';
  if (state === 'live' && (!token.lastUsedAt || Date.now() - new Date(token.lastUsedAt).getTime() > 60_000)) {
    await db.query('update platform.mcp_token set last_used_at = now() where token_id = $1', [token.tokenId]);
  }
  return { token, state, user: { ...user, vehicles: user.vehicles ?? null, approves: user.approves ?? [] } };
}
