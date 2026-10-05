/**
 * The Google sign-in round trip (docs/deploy/railway.md §3), MailGuard's flow on our roster:
 *
 *   /auth/google           PKCE (S256) and a signed state cookie that lives ten minutes, then Google.
 *   /auth/google/callback  the state must match its cookie; the code is exchanged (lib/connectors/google-signin,
 *                          the only code that talks to Google); the ID token from the token endpoint says
 *                          who it is. Admitted only with a verified email, from a Workspace account (hd),
 *                          that is one active platform.app_user, ignoring case. No self-sign-up.
 *   /auth/signout          clears this browser's session. An admin's "Sign out everywhere" raises the
 *                          person's epoch instead (Settings → Connections).
 *
 * Every refusal is audit-logged with its reason (bounded per address, floodgate.ts). Nothing here logs a
 * code, a token or a cookie.
 */
import { createHash, randomBytes } from 'node:crypto';
import { config } from '@/config/deployment';
import { exchangeSignIn, signInClient, signInUrl } from '@/lib/connectors/google-signin/signin';
import { sameText } from '@/lib/settings/crypto';
import { clientIp, logThisRefusal } from '@/lib/settings/floodgate';
import { publicUrl, setupOpen } from '@/lib/settings/setup';
import { settingsReady, settingValue } from '@/lib/settings/store';
import { SESSION_DAYS_SETTING } from '@/lib/settings/registry';
import { cookieAttributes, cookieFrom, OAUTH_COOKIE, readStateCookie, SESSION_COOKIE, sessionClaims, sessionValue, stateCookie } from './session';

function redirect(to: string, cookies: string[] = []): Response {
  const headers = new Headers({ location: to, 'cache-control': 'no-store' });
  for (const c of cookies) headers.append('set-cookie', c);
  return new Response(null, { status: 303, headers });
}

/** Step one: off to Google, carrying the state and the PKCE challenge; the verifier stays in a signed cookie. */
export async function startSignIn(request: Request): Promise<Response> {
  await settingsReady().catch(() => undefined);
  const base = publicUrl(request.headers);
  if (config.auth.provider !== 'google') return redirect(`${base}/`);
  if (setupOpen()) return redirect(`${base}/setup`);
  const client = signInClient(base);
  if (!client) return redirect(`${base}/signin?error=not-configured`);
  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return redirect(signInUrl(client, state, challenge), [
    cookieAttributes(OAUTH_COOKIE, stateCookie(state, verifier), config.auth.stateSeconds, base.startsWith('https://')),
  ]);
}

export type SignInRefusal =
  | 'oauth-state' | 'oauth-code' | 'oauth-exchange' | 'google-error' | 'not-configured'
  | 'email-unverified' | 'not-workspace' | 'not-on-roster' | 'ambiguous-email';

/** Step two: Google sent the browser back. Every way out clears the state cookie. */
export async function finishSignIn(request: Request): Promise<Response> {
  await settingsReady().catch(() => undefined);
  const { appendAudit, activeUsersByEmail } = await import('@/modules/platform');
  const url = new URL(request.url);
  const base = publicUrl(request.headers);
  const secure = base.startsWith('https://');
  const clearState = cookieAttributes(OAUTH_COOKIE, '', 0, secure);
  const ip = clientIp(request.headers);

  const refuse = async (rule: SignInRefusal, extra: { email?: string; hd?: string | null; userId?: string } = {}) => {
    if (logThisRefusal(ip)) {
      await appendAudit({
        actorId: extra.userId ?? null, action: 'signin.refused', subjectType: 'signin', subjectId: null,
        detail: { rule, provider: 'google', ...(extra.email ? { email: extra.email } : {}), ...(extra.hd !== undefined ? { hd: extra.hd } : {}), ...(ip ? { ip } : {}) },
      }).catch(() => undefined);
    }
    return redirect(`${base}/signin?error=${rule}`, [clearState]);
  };

  if (config.auth.provider !== 'google') return redirect(`${base}/`, [clearState]);
  const pending = readStateCookie(cookieFrom(request.headers.get('cookie'), OAUTH_COOKIE));
  const state = url.searchParams.get('state') ?? '';
  if (!pending || !sameText(state, pending.state)) return refuse('oauth-state');
  // Google's error codes are short words; anything else is someone writing into the log and the URL.
  if (url.searchParams.get('error')) return refuse('google-error');
  const code = url.searchParams.get('code');
  if (!code) return refuse('oauth-code');
  const client = signInClient(base);
  if (!client) return refuse('not-configured');

  let who;
  try { who = await exchangeSignIn(client, code, pending.verifier); }
  catch { return refuse('oauth-exchange'); }
  if (!who.email || !who.emailVerified) return refuse('email-unverified', { email: who.email });
  // Anyone who once had a work address can make a personal Google account with it and keep it after they
  // leave. Only a Workspace organization that proved it owns a domain can manage accounts at it (hd).
  if (!who.hd) return refuse('not-workspace', { email: who.email, hd: null });
  const people = await activeUsersByEmail(who.email);
  if (people.length === 0) return refuse('not-on-roster', { email: who.email, hd: who.hd });
  if (people.length > 1) return refuse('ambiguous-email', { email: who.email, hd: who.hd });
  const person = people[0]!;

  const days = Number(settingValue(SESSION_DAYS_SETTING.key) ?? config.auth.sessionDays) || config.auth.sessionDays;
  const session = sessionValue(person, days);
  await appendAudit({ actorId: person.id, action: 'signin', subjectType: 'app_user', subjectId: person.id, detail: { provider: 'google', hd: who.hd, ...(ip ? { ip } : {}) } });
  return redirect(`${base}/today`, [clearState, cookieAttributes(SESSION_COOKIE, session.value, session.maxAge, secure)]);
}

/** Sign out this browser. The cookie goes whether or not it was valid. */
export async function signOut(request: Request): Promise<Response> {
  const base = publicUrl(request.headers);
  const claims = sessionClaims(cookieFrom(request.headers.get('cookie'), SESSION_COOKIE));
  if (claims) {
    const { appendAudit } = await import('@/modules/platform');
    await appendAudit({ actorId: claims.uid, action: 'signout', subjectType: 'app_user', subjectId: claims.uid, detail: { provider: 'google' } }).catch(() => undefined);
  }
  return redirect(`${base}/signin?signedOut=1`, [cookieAttributes(SESSION_COOKIE, '', 0, base.startsWith('https://'))]);
}
