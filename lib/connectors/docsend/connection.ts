import { randomBytes } from 'node:crypto';
import { clearPersonSecret, personSecret, setPersonSecret } from '@/lib/settings/person-secrets';
import type { Queryable } from '@/lib/db';
import { clearConnection, docsendConnection, noteConnectionError, setConnection } from '@/modules/docsend';
import { docsendClient, httpsTransport, NotSignedIn, type DocsendClient, type McpTransport } from './mcp';
import { authorizeUrl, discover, DocsendSignInError, exchangeCode, httpsOAuth, pkce, refreshTokens, register, type OAuthTransport, type ServerMeta, type Tokens } from './oauth';

/**
 * The DocSend sign-in (docs/32-docsend.md §4 E). The Admin who connects it signs in as themselves; their
 * registration and tokens are their own secret (platform.person_secret, purpose 'docsend', encrypted and bound to
 * them), and docsend.connection says whose the sync uses. Nothing here is ever shown or logged: not a token, not
 * the client id.
 */
export const DOCSEND_PURPOSE = 'docsend';

interface Stored { meta: ServerMeta; clientId: string; redirectUri: string; tokens: Tokens | null }

async function stored(userId: string): Promise<Stored | null> {
  const raw = await personSecret(userId, DOCSEND_PURPOSE);
  if (!raw) return null;
  try { return JSON.parse(raw) as Stored; } catch { return null; }
}
const save = (userId: string, s: Stored) => setPersonSecret(userId, DOCSEND_PURPOSE, JSON.stringify(s));

export const redirectUriFor = (base: string) => `${base}/api/connectors/docsend/callback`;

/** Step one: find DocSend's sign-in, register this server, and return where to send the browser. */
export async function startConnect(userId: string, base: string, t: OAuthTransport = httpsOAuth): Promise<{ url: string; state: string; verifier: string }> {
  const redirectUri = redirectUriFor(base);
  const prior = await stored(userId);
  const meta = await discover(t);
  // Register again when the address changed; the registration is bound to the redirect URI.
  const clientId = prior && prior.redirectUri === redirectUri && prior.meta.registrationEndpoint === meta.registrationEndpoint
    ? prior.clientId : await register(t, meta, redirectUri);
  await save(userId, { meta, clientId, redirectUri, tokens: prior?.clientId === clientId ? prior.tokens : null });
  const state = randomBytes(24).toString('base64url');
  const { verifier, challenge } = pkce();
  return { url: authorizeUrl(meta, clientId, redirectUri, state, challenge), state, verifier };
}

/** Step two: DocSend sent the browser back with a code. The sync then uses this person's sign-in. */
export async function finishConnect(userId: string, code: string, verifier: string, q: Queryable, t: OAuthTransport = httpsOAuth): Promise<void> {
  const s = await stored(userId);
  if (!s) throw new DocsendSignInError('DocSend sign-in: start again from Settings → Connections');
  const tokens = await exchangeCode(t, s.meta, s.clientId, s.redirectUri, code, verifier);
  await save(userId, { ...s, tokens });
  await setConnection(userId, q);
}

/** Forget the sign-in: the connection row and the stored tokens. Visits already read stay. */
export async function disconnect(q: Queryable): Promise<void> {
  const userId = await clearConnection(q);
  if (userId) await clearPersonSecret(userId, DOCSEND_PURPOSE);
}

/** A fresh token, refreshed when it runs out within a minute (or `force`). Null when not connected. */
async function accessToken(userId: string, force: boolean, t: OAuthTransport): Promise<string | null> {
  const s = await stored(userId);
  if (!s?.tokens) return null;
  const stale = force || (s.tokens.expiresAt !== null && s.tokens.expiresAt - Date.now() < 60_000);
  if (!stale) return s.tokens.accessToken;
  if (!s.tokens.refreshToken) return null;
  const next = await refreshTokens(t, s.meta, s.clientId, s.tokens.refreshToken);
  await save(userId, { ...s, tokens: { ...next, refreshToken: next.refreshToken ?? s.tokens.refreshToken } });
  return next.accessToken;
}

/**
 * The client for the connected sign-in, or null when nobody has connected DocSend. A refused token is refreshed
 * once; a second refusal is written on the connection for Settings to show, and thrown.
 */
export async function connectedClient(q: Queryable, opts: { transport?: McpTransport; oauth?: OAuthTransport } = {}): Promise<DocsendClient | null> {
  const conn = await docsendConnection(q);
  if (!conn) return null;
  const t = opts.oauth ?? httpsOAuth;
  const open = async (force: boolean) => {
    const token = await accessToken(conn.userId, force, t);
    if (!token) throw new NotSignedIn();
    return docsendClient({ transport: opts.transport ?? httpsTransport(), token });
  };
  let client = await open(false).catch(async (e) => { await noteConnectionError(String((e as Error).message), q); throw e; });
  let retried = false;
  return {
    get stats() { return client.stats; },
    async call(tool, args) {
      try { return await client.call(tool, args); } catch (e) {
        if (!(e instanceof NotSignedIn) || retried) { await noteConnectionError(String((e as Error).message), q); throw e; }
        retried = true;
        client = await open(true).catch(async (err) => { await noteConnectionError(String((err as Error).message), q); throw err; });
        return client.call(tool, args);
      }
    },
  };
}
