import { createHash, randomBytes } from 'node:crypto';
import { config } from '@/config/deployment';
import { googleClientId, googleClientSecret } from './client-settings';

/**
 * Signing in with Google (docs/deploy/railway.md §3), MailGuard's flow: the authorization code with PKCE
 * (S256), scopes openid, email and profile only — no Gmail scope, so a sign-in grants nothing to read or
 * send mail (mail goes through mailguard, docs/25 §12). The only code that talks to Google's OAuth hosts
 * (npm run boundaries), and it may make exactly one kind of request: a form POST of an authorization code
 * to the token endpoint. The browser is sent to the consent page; the server never fetches it.
 *
 * The ID token comes straight back from Google's token endpoint over TLS, so its signature need not be
 * checked (OpenID Connect Core §3.1.3.7); its audience must still be our client, and its issuer Google.
 */
export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const SIGN_IN_SCOPES = ['openid', 'email', 'profile'] as const;

export class SignInError extends Error {
  constructor(message: string, readonly status: number | null = null) { super(message); this.name = 'SignInError'; }
}

export interface SignInClient { clientId: string; clientSecret: string; redirectUri: string }

/** The configured client, with the redirect URI for this public address; null until /setup has run. */
export function signInClient(publicUrl: string): SignInClient | null {
  const clientId = googleClientId(), clientSecret = googleClientSecret();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: `${publicUrl}/auth/google/callback` };
}

export function signInUrl(c: Pick<SignInClient, 'clientId' | 'redirectUri'>, state: string, challenge: string): string {
  const u = new URL(GOOGLE_AUTHORIZE_URL);
  u.search = new URLSearchParams({
    client_id: c.clientId, redirect_uri: c.redirectUri, response_type: 'code', scope: SIGN_IN_SCOPES.join(' '),
    state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
  }).toString();
  return u.toString();
}

export interface GoogleIdentity { email: string; emailVerified: boolean; hd: string | null; sub: string; name: string }

/** What carries the one request: Google over HTTPS, or the properties' fake. */
export type TokenTransport = (form: URLSearchParams) => Promise<{ status: number; text(): Promise<string> }>;

const httpsTransport: TokenTransport = async (form) => {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString(),
    redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  return { status: res.status, text: () => res.text() };
};

// ── The fake Google, for the properties ─────────────────────────────────────────────────────────────────
export interface FakeAccount { sub: string; email: string; email_verified: boolean; hd?: string; name?: string }
type FakeCode = { challenge: string; redirectUri: string; clientId: string; clientSecret: string; account: FakeAccount; expiresAt: number };
const g = globalThis as typeof globalThis & { __plcosFakeGoogle?: { secret: string; codes: Map<string, FakeCode> } | null };

/**
 * Answer sign-ins with a fake Google: `consent` plays Google's consent screen for an invented account and
 * returns the code it would have put in the redirect. Honoured only on the demo profile outside
 * production, so a deployed server always talks to Google itself.
 */
export function useFakeGoogle(on: { clientSecret: string } | null) {
  g.__plcosFakeGoogle = on ? { secret: on.clientSecret, codes: new Map() } : null;
}

export function fakeConsent(consentUrl: string, account: FakeAccount): string {
  const fake = g.__plcosFakeGoogle;
  if (!fake) throw new Error('The fake Google is off.');
  const q = new URL(consentUrl).searchParams;
  if (q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge')) throw new Error('PKCE is required.');
  if (q.get('scope') !== SIGN_IN_SCOPES.join(' ')) throw new Error('Sign-in asks for openid, email and profile only.');
  const code = `fake-code-${randomBytes(8).toString('hex')}`;
  fake.codes.set(code, { challenge: q.get('code_challenge')!, redirectUri: q.get('redirect_uri') ?? '', clientId: q.get('client_id') ?? '', clientSecret: fake.secret, account, expiresAt: Date.now() + 5 * 60_000 });
  return code;
}

const fakeTransport: TokenTransport = async (form) => {
  const json = (status: number, body: unknown) => ({ status, text: async () => JSON.stringify(body) });
  const fake = g.__plcosFakeGoogle!;
  const c = fake.codes.get(form.get('code') ?? '');
  fake.codes.delete(form.get('code') ?? '');
  if (!c) return json(400, { error: 'invalid_grant' });
  if (form.get('client_id') !== c.clientId || form.get('client_secret') !== c.clientSecret) return json(401, { error: 'invalid_client' });
  if (c.expiresAt < Date.now() || c.redirectUri !== form.get('redirect_uri')
    || createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') !== c.challenge) return json(400, { error: 'invalid_grant' });
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const idToken = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iss: 'https://accounts.google.com', aud: c.clientId, iat: now, exp: now + 3600, ...c.account })}.fake-signature`;
  return json(200, { access_token: `fake-at-${randomBytes(8).toString('hex')}`, expires_in: 3599, scope: SIGN_IN_SCOPES.join(' '), token_type: 'Bearer', id_token: idToken });
};

function transport(): TokenTransport {
  if (g.__plcosFakeGoogle && config.data.profile === 'demo' && process.env.NODE_ENV !== 'production') return fakeTransport;
  return httpsTransport;
}

/** Exchange the code (with the PKCE verifier) and read who Google says this is. Never echoes Google's body. */
export async function exchangeSignIn(c: SignInClient, code: string, verifier: string): Promise<GoogleIdentity> {
  if (!/^[\w\-./~]{4,2048}$/.test(code)) throw new SignInError('The answer from Google carried no usable code.');
  const res = await transport()(new URLSearchParams({
    grant_type: 'authorization_code', code, client_id: c.clientId, client_secret: c.clientSecret,
    redirect_uri: c.redirectUri, code_verifier: verifier,
  }));
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(await res.text()) as Record<string, unknown>; } catch { /* not JSON */ }
  if (res.status !== 200 || typeof j.id_token !== 'string') {
    const name = typeof j.error === 'string' && /^[a-z_]{1,40}$/.test(j.error) ? j.error : 'no ID token';
    throw new SignInError(`Google refused the sign-in (${res.status}: ${name}).`, res.status);
  }
  let claims: Record<string, unknown>;
  try { claims = JSON.parse(Buffer.from(j.id_token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>; }
  catch { throw new SignInError('Google’s ID token could not be read.'); }
  if (claims.aud !== c.clientId) throw new SignInError('Google’s ID token names another client.');
  if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') throw new SignInError('The ID token is not from Google.');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new SignInError('Google’s ID token has no subject.');
  return {
    email: typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '',
    emailVerified: claims.email_verified === true,
    hd: typeof claims.hd === 'string' && claims.hd ? claims.hd.toLowerCase() : null,
    sub: claims.sub,
    name: typeof claims.name === 'string' ? claims.name.slice(0, 200) : '',
  };
}
