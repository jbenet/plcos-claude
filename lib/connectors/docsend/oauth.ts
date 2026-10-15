import { createHash, randomBytes } from 'node:crypto';
import { DOCSEND_MCP_URL } from './mcp';

/**
 * Signing PLC OS in to DocSend's MCP server (docs/32-docsend.md §4 E), the way any remote MCP client signs in
 * (the MCP authorization spec): the server's protected-resource metadata names its authorization server; that
 * server's metadata gives the endpoints; PLC OS registers itself as a public client (dynamic client
 * registration, no secret) and then uses the authorization code with PKCE (S256). The browser goes to the
 * consent page; the server only fetches metadata, registers, and exchanges or refreshes a code.
 *
 * Every URL fetched must be https on a DocSend or Dropbox host (OAUTH_HOSTS); anything else is refused, so a
 * metadata document cannot send the sign-in somewhere else.
 */

/** GUESS: DocSend belongs to Dropbox, so its authorization server may sit on either; nothing else is accepted. */
export const OAUTH_HOSTS = [/^(.+\.)?docsend\.com$/, /^(.+\.)?dropbox\.com$/, /^(.+\.)?dropboxapi\.com$/];

export class DocsendSignInError extends Error {
  constructor(message: string) { super(message); this.name = 'DocsendSignInError'; }
}

export function allowedUrl(raw: unknown): string {
  let u: URL;
  try { u = new URL(String(raw)); } catch { throw new DocsendSignInError('DocSend sign-in: not a URL'); }
  if (u.protocol !== 'https:' || !OAUTH_HOSTS.some((h) => h.test(u.hostname))) throw new DocsendSignInError(`DocSend sign-in: ${u.hostname} is not a DocSend host`);
  return u.toString();
}

export interface HttpAnswer { status: number; text(): Promise<string>; headers?: { get(name: string): string | null } }
export type OAuthTransport = (url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }) => Promise<HttpAnswer>;

/** Why a fetch failed, in words safe to log: the host and the network's error code, never a header or a body. */
function unreachable(url: string, e: unknown): DocsendSignInError {
  const cause = (e as { cause?: { code?: string; message?: string } })?.cause;
  const why = cause?.code ?? (e instanceof Error && e.name === 'TimeoutError' ? 'timed out' : cause?.message ?? (e instanceof Error ? e.message : 'error'));
  return new DocsendSignInError(`DocSend sign-in: ${new URL(url).hostname} could not be reached (${String(why).slice(0, 80)})`);
}

/**
 * Fetches with redirects followed by hand, at most three, each one checked against OAUTH_HOSTS (a GET follows any
 * redirect; a POST only a 307 or 308, which keep the method and body).
 */
export const httpsOAuth: OAuthTransport = async (url, init) => {
  let at = allowedUrl(url);
  for (let hop = 0; ; hop++) {
    let res: Response;
    try { res = await fetch(at, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15_000) }); } catch (e) { throw unreachable(at, e); }
    const to = res.headers.get('location');
    const follow = res.status >= 300 && res.status < 400 && to && (init.method === 'GET' || res.status === 307 || res.status === 308);
    if (!follow) return res;
    if (hop >= 2) throw new DocsendSignInError(`DocSend sign-in: too many redirects from ${new URL(at).hostname}`);
    at = allowedUrl(new URL(to, at).toString());
  }
};

async function json(t: OAuthTransport, url: string, init: Parameters<OAuthTransport>[1], seen?: string[]): Promise<Record<string, unknown> | null> {
  const res = await t(allowedUrl(url), init);
  const say = (what: string) => seen?.push(`${new URL(url).pathname} ${what}`);
  if (res.status >= 400) {
    // An OAuth error body (RFC 6749 §5.2, RFC 7591 §3.2.2) says what was wrong; it carries no secret.
    let why = '';
    try {
      const e = JSON.parse(await res.text()) as { error?: unknown; error_description?: unknown };
      why = [e.error, e.error_description].filter((x) => typeof x === 'string' && x).join(': ').slice(0, 200);
    } catch { /* not JSON */ }
    say(why ? `${res.status}, ${why}` : String(res.status));
    return null;
  }
  try { return JSON.parse(await res.text()) as Record<string, unknown>; } catch { say(`${res.status}, not JSON`); return null; }
}

/** Where an MCP server says its metadata is: the resource_metadata of the WWW-Authenticate on a request with no token. */
async function metadataFromChallenge(t: OAuthTransport, server: string): Promise<string | null> {
  const res = await t(allowedUrl(server), {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'plcos', version: '1' } } }),
  });
  const m = /resource_metadata="([^"]+)"/i.exec(res.headers?.get('www-authenticate') ?? '');
  return m ? m[1]! : null;
}

export interface ServerMeta {
  resource: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  scopes: string[];
}

/** The resource and authorization server metadata, by the well-known paths (RFC 9728, RFC 8414). */
export async function discover(t: OAuthTransport, server = DOCSEND_MCP_URL): Promise<ServerMeta> {
  const s = new URL(server);
  const get = { method: 'GET' as const, headers: { accept: 'application/json' } };
  const seen: string[] = [];
  let prm = await json(t, `${s.origin}/.well-known/oauth-protected-resource${s.pathname}`, get, seen)
    ?? await json(t, `${s.origin}/.well-known/oauth-protected-resource`, get, seen);
  if (!prm) {
    const at = await metadataFromChallenge(t, server);
    if (at) prm = await json(t, at, get, seen);
  }
  const issuer = (prm?.authorization_servers as string[] | undefined)?.[0] ?? s.origin;
  const i = new URL(allowedUrl(issuer));
  const path = i.pathname === '/' ? '' : i.pathname;
  const asm = await json(t, `${i.origin}/.well-known/oauth-authorization-server${path}`, get, seen)
    ?? await json(t, `${i.origin}/.well-known/openid-configuration${path}`, get, seen);
  if (!asm?.authorization_endpoint || !asm.token_endpoint) {
    throw new DocsendSignInError(`DocSend sign-in: ${i.hostname} published no authorization endpoints (${seen.join('; ').slice(0, 300) || 'no answer'})`);
  }
  if (!asm.registration_endpoint) throw new DocsendSignInError('DocSend sign-in: the server does not let clients register themselves');
  const methods = asm.code_challenge_methods_supported as string[] | undefined;
  if (methods && !methods.includes('S256')) throw new DocsendSignInError('DocSend sign-in: the server does not support PKCE with S256');
  return {
    resource: String(prm?.resource ?? server),
    authorizationEndpoint: allowedUrl(asm.authorization_endpoint),
    tokenEndpoint: allowedUrl(asm.token_endpoint),
    registrationEndpoint: allowedUrl(asm.registration_endpoint),
    scopes: ((prm?.scopes_supported ?? asm.scopes_supported) as string[] | undefined) ?? [],
  };
}

/** Register PLC OS as a public client for this redirect URI. Returns the client id. */
/**
 * Register PLC OS as a public client for this redirect URI. Returns the client id. Servers differ in which optional
 * fields they accept, so a refused registration is tried once more with only the required ones (RFC 7591 §2).
 */
export async function register(t: OAuthTransport, meta: ServerMeta, redirectUri: string): Promise<string> {
  const seen: string[] = [];
  const post = (fields: Record<string, unknown>) => json(t, meta.registrationEndpoint, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(fields),
  }, seen);
  const scope = meta.scopes.length ? { scope: meta.scopes.join(' ') } : {};
  const body = await post({
    client_name: 'PLC OS', redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'], token_endpoint_auth_method: 'none', ...scope,
  }) ?? await post({ client_name: 'PLC OS', redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' });
  const id = body?.client_id;
  if (typeof id !== 'string' || !id) throw new DocsendSignInError(`DocSend sign-in: registration was refused for ${redirectUri} (${seen.join('; ') || 'no client id'})`);
  return id;
}

export const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

export function authorizeUrl(meta: ServerMeta, clientId: string, redirectUri: string, state: string, challenge: string): string {
  const u = new URL(meta.authorizationEndpoint);
  const q = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: redirectUri, state,
    code_challenge: challenge, code_challenge_method: 'S256', resource: meta.resource,
  });
  if (meta.scopes.length) q.set('scope', meta.scopes.join(' '));
  u.search = q.toString();
  return u.toString();
}

export interface Tokens { accessToken: string; refreshToken: string | null; expiresAt: number | null }

async function tokenRequest(t: OAuthTransport, meta: Pick<ServerMeta, 'tokenEndpoint' | 'resource'>, form: Record<string, string>, now: number): Promise<Tokens> {
  const res = await t(allowedUrl(meta.tokenEndpoint), {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ ...form, resource: meta.resource }).toString(),
  });
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(await res.text()) as Record<string, unknown>; } catch { /* reported below */ }
  if (res.status >= 400 || typeof body.access_token !== 'string') {
    throw new DocsendSignInError(`DocSend sign-in: the token request was refused (${res.status}${typeof body.error === 'string' ? `, ${body.error.slice(0, 60)}` : ''})`);
  }
  const expires = Number(body.expires_in);
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
    expiresAt: Number.isFinite(expires) && expires > 0 ? now + expires * 1000 : null,
  };
}

export const exchangeCode = (t: OAuthTransport, meta: ServerMeta, clientId: string, redirectUri: string, code: string, verifier: string, now = Date.now()) =>
  tokenRequest(t, meta, { grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier }, now);

export const refreshTokens = (t: OAuthTransport, meta: Pick<ServerMeta, 'tokenEndpoint' | 'resource'>, clientId: string, refreshToken: string, now = Date.now()) =>
  tokenRequest(t, meta, { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId }, now);
