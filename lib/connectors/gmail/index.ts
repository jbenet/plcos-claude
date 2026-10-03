import { config } from '@/config/deployment';
import { GOOGLE_AUTHORIZE_URL } from './allowlist';
import { gmailClient, type GmailClient, type GmailRequestLog } from './client';
import { FAKE_CLIENT, FAKE_DOMAIN, fakeTransport } from './fake';
import { guarded, httpsTransport, type GoogleTransport } from './fetch';
import { consentUrl, exchangeCode, newPkce, newState, refreshAccess, revokeToken, wantedScopes, type OAuthClient, type Pkce } from './oauth';
import { fileStore, keychainStore, type StoredGrant, type TokenStore } from './tokens';

/**
 * Which Google this server talks to, and where each person's grant is kept (docs/25).
 *
 *   google  the live server only, when config.email.gmail.enabled and the OAuth client's id and
 *           secret are in its environment (scripts/with-google-oauth.sh, from the Keychain).
 *   fake    the demo, always: lib/connectors/gmail/fake.ts, beside the demo database.
 *   off     everything else — a preview (a copy of the real data) above all, which never sees a
 *           token or the OAuth client.
 *
 * The OAuth client's variables are read here and nowhere else (npm run boundaries).
 */

export interface GmailRuntime {
  mode: 'google' | 'fake';
  authorizeUrl: string;
  client: OAuthClient;
  transport: GoogleTransport;
  store: TokenStore;
  scopes: string[];
  /** Where the fake keeps its mailbox; null for Google. */
  fakeDir: string | null;
}
export type RuntimeState = GmailRuntime | { mode: 'off'; why: string };

export const fakeDir = () => `${config.db.localDir.replace(/\/+$/, '')}.gmail-fake`;

/** `origin` is the server's own, for the demo's redirect; Google's is fixed in the config. */
export function gmailRuntime(origin: string, overrides: Partial<GmailRuntime> = {}): RuntimeState {
  const threads = config.email.gmail.threads;
  if (config.data.profile === 'demo') {
    const dir = overrides.fakeDir ?? fakeDir();
    return {
      mode: 'fake',
      authorizeUrl: `${origin}/api/email/google/fake-consent`,
      client: { ...FAKE_CLIENT, redirectUri: `${origin}/api/email/google/callback` },
      transport: fakeTransport(dir),
      store: fileStore(`${dir}/tokens.json`),
      scopes: wantedScopes(threads),
      fakeDir: dir,
      ...overrides,
    };
  }
  if (config.data.copyTakenAt) return { mode: 'off', why: 'This is a preview, a copy of the real data: it never holds anyone’s Gmail grant.' };
  if (!config.email.gmail.enabled) return { mode: 'off', why: 'Gmail drafts are off: config.email.gmail.enabled is false until the Google OAuth client exists (docs/25, Setup).' };
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return { mode: 'off', why: 'The Google OAuth client id and secret are not in this server’s environment (npm run secret:store -- google-oauth-client-id, then …-secret; docs/25).' };
  return {
    mode: 'google',
    authorizeUrl: GOOGLE_AUTHORIZE_URL,
    client: { clientId, clientSecret, redirectUri: config.email.gmail.redirectUri },
    transport: httpsTransport(),
    store: keychainStore(),
    scopes: wantedScopes(threads),
    fakeDir: null,
    ...overrides,
  };
}

/** What the consent round trip carries in its cookie: never a token. */
export interface PendingConnect { state: string; verifier: string; challenge: string; scopes: string[]; handle: string }

export function beginConnect(rt: GmailRuntime, handle: string, loginHint: string | null): { url: string; pending: PendingConnect } {
  const pkce = newPkce();
  const state = newState();
  const hint = rt.mode === 'fake' ? `${handle}@${FAKE_DOMAIN}` : loginHint;
  return { url: consentUrl(rt.authorizeUrl, rt.client, state, pkce, rt.scopes, hint), pending: { state, verifier: pkce.verifier, challenge: pkce.challenge, scopes: rt.scopes, handle } };
}

const cache = new Map<string, { token: string; expiresAt: number; scopes: string[] }>();
const cacheKey = (rt: GmailRuntime, handle: string) => `${rt.mode}:${rt.fakeDir ?? ''}:${handle}`;

export interface Connected { email: string; scopes: string[]; connectedAt: string }

export async function completeConnect(rt: GmailRuntime, handle: string, code: string, pending: PendingConnect): Promise<Connected> {
  const send = guarded(rt.transport);
  const pkce: Pkce = { verifier: pending.verifier, challenge: pending.challenge };
  const t = await exchangeCode(send, rt.client, code, pkce, pending.scopes);
  cache.set(cacheKey(rt, handle), { token: t.accessToken, expiresAt: t.expiresAt, scopes: t.scopes });
  const { emailAddress } = await gmailClient({ transport: rt.transport, accessToken: async () => t.accessToken }).profile();
  const grant: StoredGrant = { refreshToken: t.refreshToken, email: emailAddress, scopes: t.scopes, connectedAt: new Date().toISOString() };
  await rt.store.put(handle, grant);
  return { email: emailAddress, scopes: t.scopes, connectedAt: grant.connectedAt };
}

export async function connection(rt: GmailRuntime, handle: string): Promise<Connected | null> {
  const g = await rt.store.get(handle);
  return g ? { email: g.email, scopes: g.scopes, connectedAt: g.connectedAt } : null;
}

/** Revoke at Google, then forget. Forgets even when Google cannot be reached, and says so. */
export async function disconnect(rt: GmailRuntime, handle: string): Promise<{ revoked: boolean }> {
  const g = await rt.store.get(handle);
  cache.delete(cacheKey(rt, handle));
  let revoked = false;
  if (g) {
    try { revoked = await revokeToken(guarded(rt.transport), g.refreshToken); } catch { revoked = false; }
  }
  await rt.store.delete(handle);
  return { revoked };
}

export class NotConnected extends Error {
  constructor() { super('Connect your Gmail first, in Preferences.'); this.name = 'NotConnected'; }
}

/** A Gmail client acting as this person, refreshing their access token when it runs out. */
export async function draftClient(rt: GmailRuntime, handle: string, log?: (e: GmailRequestLog) => void): Promise<{ client: GmailClient; grant: Connected }> {
  const g = await rt.store.get(handle);
  if (!g) throw new NotConnected();
  const key = cacheKey(rt, handle);
  const accessToken = async (fresh: boolean) => {
    const hit = cache.get(key);
    if (!fresh && hit && hit.expiresAt > Date.now()) return hit.token;
    const t = await refreshAccess(guarded(rt.transport), rt.client, g.refreshToken);
    cache.set(key, { token: t.accessToken, expiresAt: t.expiresAt, scopes: t.scopes.length ? t.scopes : g.scopes });
    return t.accessToken;
  };
  return { client: gmailClient({ transport: rt.transport, accessToken, log }), grant: { email: g.email, scopes: g.scopes, connectedAt: g.connectedAt } };
}

export { ALLOWED, MUST_REFUSE, SCOPES } from './allowlist';
export type { GmailClient, GmailRequestLog } from './client';
export { GmailError } from './client';
export { DraftOnlyViolation } from './fetch';
export { OAuthError } from './oauth';
export { fakeConsent, readFake } from './fake';
