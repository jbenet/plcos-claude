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

export interface HttpAnswer { status: number; text(): Promise<string> }
export type OAuthTransport = (url: string, init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: string }) => Promise<HttpAnswer>;

export const httpsOAuth: OAuthTransport = (url, init) =>
  fetch(allowedUrl(url), { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) });

async function json(t: OAuthTransport, url: string, init: Parameters<OAuthTransport>[1]): Promise<Record<string, unknown> | null> {
  const res = await t(allowedUrl(url), init);
  if (res.status >= 400) return null;
  try { return JSON.parse(await res.text()) as Record<string, unknown>; } catch { return null; }
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
  const prm = await json(t, `${s.origin}/.well-known/oauth-protected-resource${s.pathname}`, get)
    ?? await json(t, `${s.origin}/.well-known/oauth-protected-resource`, get);
  const issuer = (prm?.authorization_servers as string[] | undefined)?.[0] ?? s.origin;
  const i = new URL(allowedUrl(issuer));
  const path = i.pathname === '/' ? '' : i.pathname;
  const asm = await json(t, `${i.origin}/.well-known/oauth-authorization-server${path}`, get)
    ?? await json(t, `${i.origin}/.well-known/openid-configuration${path}`, get);
  if (!asm?.authorization_endpoint || !asm.token_endpoint) throw new DocsendSignInError('DocSend sign-in: the server published no authorization endpoints');
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
export async function register(t: OAuthTransport, meta: ServerMeta, redirectUri: string): Promise<string> {
  const body = await json(t, meta.registrationEndpoint, {
    method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'PLC OS', redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'], token_endpoint_auth_method: 'none',
    }),
  });
  const id = body?.client_id;
  if (typeof id !== 'string' || !id) throw new DocsendSignInError('DocSend sign-in: registration was refused');
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
