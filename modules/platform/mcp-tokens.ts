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
}

const PREFIX = 'plcos_mcp_';
export const hashToken = (secret: string) => createHash('sha256').update(secret, 'utf8').digest('hex');
/** 32 random bytes; the visible prefix says what the string is if it turns up somewhere. */
export const newTokenSecret = () => `${PREFIX}${randomBytes(32).toString('base64url')}`;
export const looksLikeToken = (s: string) => s.startsWith(PREFIX) && /^[A-Za-z0-9_-]{40,80}$/.test(s);

const cols = (t = '') => `${t}token_id::text "tokenId", ${t}user_id::text "userId", ${t}label, ${t}prefix, ${t}tools,
  ${t}vehicles::text[] vehicles, ${t}calls_per_day "callsPerDay", ${t}created_at "createdAt", ${t}expires_at "expiresAt",
  ${t}last_used_at "lastUsedAt", ${t}revoked_at "revokedAt"`;

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
