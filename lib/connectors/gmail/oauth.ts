import { createHash, randomBytes } from 'node:crypto';
import { GOOGLE_REVOKE_URL, GOOGLE_TOKEN_URL, HARMLESS_SCOPES, SCOPES } from './allowlist';
import { DraftOnlyViolation, type GoogleRequest, type GoogleResponse } from './fetch';

/**
 * Per-user OAuth for Gmail drafts (docs/25 §Per-user OAuth): the authorization-code flow with
 * PKCE, offline access for a refresh token, and nothing granted beyond compose (plus metadata
 * when someone turns on replies in a thread). A grant that comes back wider is revoked at once
 * and refused — `include_granted_scopes=false` asks Google not to merge older grants in.
 */

export type GuardedFetch = (url: URL, init: GoogleRequest) => Promise<GoogleResponse>;

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface Pkce { verifier: string; challenge: string }

export function newPkce(): Pkce {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export const newState = () => randomBytes(24).toString('base64url');

export function wantedScopes(threads: boolean): string[] {
  return threads ? [SCOPES.compose, SCOPES.metadata] : [SCOPES.compose];
}

/** The consent page's address. `authorizeUrl` is Google's, or the fake's in the demo. */
export function consentUrl(authorizeUrl: string, c: Pick<OAuthClient, 'clientId' | 'redirectUri'>, state: string, pkce: Pkce, scopes: string[], loginHint?: string | null): string {
  const u = new URL(authorizeUrl);
  u.searchParams.set('client_id', c.clientId);
  u.searchParams.set('redirect_uri', c.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', scopes.join(' '));
  u.searchParams.set('access_type', 'offline');
  // Without it, a second connect returns no refresh token.
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'false');
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', pkce.challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  if (loginHint) u.searchParams.set('login_hint', loginHint);
  return u.toString();
}

export interface Tokens {
  accessToken: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  refreshToken: string | null;
  scopes: string[];
}

export class OAuthError extends Error {
  constructor(message: string, readonly status: number | null = null) {
    super(message);
    this.name = 'OAuthError';
  }
}

const form = (fields: Record<string, string>): GoogleRequest => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields).toString(),
});

/** Never echo Google's body: an error answer can carry the code or a token. Its error name is enough. */
async function tokenAnswer(res: GoogleResponse, now: number): Promise<Tokens> {
  const text = await res.text();
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(text) as Record<string, unknown>; } catch { /* not JSON */ }
  if (res.status !== 200 || typeof j.access_token !== 'string') {
    const name = typeof j.error === 'string' && /^[a-z_]{1,40}$/.test(j.error) ? j.error : 'no access token';
    throw new OAuthError(`Google refused the token request (${res.status}: ${name}).`, res.status);
  }
  const expiresIn = Number(j.expires_in);
  return {
    accessToken: j.access_token,
    // A minute early, so a token is never used in its last seconds.
    expiresAt: now + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600) * 1000 - 60_000,
    refreshToken: typeof j.refresh_token === 'string' ? j.refresh_token : null,
    scopes: typeof j.scope === 'string' ? j.scope.split(/\s+/).filter(Boolean) : [],
  };
}

/** What a grant allows beyond what we asked for, if anything. */
export function excessScopes(granted: string[], asked: string[]): string[] {
  return granted.filter((s) => !asked.includes(s) && !HARMLESS_SCOPES.has(s));
}

export async function exchangeCode(send: GuardedFetch, c: OAuthClient, code: string, pkce: Pkce, asked: string[], now = Date.now()): Promise<Tokens & { refreshToken: string }> {
  if (!/^[\w\-./~]{4,2048}$/.test(code)) throw new OAuthError('The answer from Google carried no usable code.');
  const t = await tokenAnswer(await send(new URL(GOOGLE_TOKEN_URL), form({
    grant_type: 'authorization_code', code, client_id: c.clientId, client_secret: c.clientSecret,
    redirect_uri: c.redirectUri, code_verifier: pkce.verifier,
  })), now);
  const extra = excessScopes(t.scopes, asked);
  if (extra.length) {
    await revokeToken(send, t.refreshToken ?? t.accessToken).catch(() => undefined);
    throw new DraftOnlyViolation(`a grant wider than asked (${extra.join(', ')}); it was revoked`);
  }
  if (!t.scopes.includes(SCOPES.compose)) {
    await revokeToken(send, t.refreshToken ?? t.accessToken).catch(() => undefined);
    throw new OAuthError('Google granted no permission to make drafts. Connect again and leave the Gmail box ticked.');
  }
  if (!t.refreshToken) throw new OAuthError('Google sent no refresh token. Disconnect this tool in your Google account’s security page, then connect again.');
  return { ...t, refreshToken: t.refreshToken };
}

export async function refreshAccess(send: GuardedFetch, c: Omit<OAuthClient, 'redirectUri'>, refreshToken: string, now = Date.now()): Promise<Tokens> {
  return tokenAnswer(await send(new URL(GOOGLE_TOKEN_URL), form({
    grant_type: 'refresh_token', refresh_token: refreshToken, client_id: c.clientId, client_secret: c.clientSecret,
  })), now);
}

/** Revoke a grant. The token goes in the form body, never in the URL. */
export async function revokeToken(send: GuardedFetch, token: string): Promise<boolean> {
  const res = await send(new URL(GOOGLE_REVOKE_URL), form({ token }));
  // 400 invalid_token means it was revoked already, which is what was wanted.
  return res.status === 200 || res.status === 400;
}
