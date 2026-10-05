/**
 * Google sign-in sessions (docs/deploy/railway.md §3), copied from MailGuard's session.ts: a signed cookie
 * `uid.epoch.expires.sig`, HMAC-SHA256 under the session subkey of PLCOS_SECRET. There is no session table:
 * raising the person's session_epoch (platform.app_user) signs them out everywhere.
 *
 * The OAuth round trip carries its own cookie, `state.verifier.sig`, signed under a different subkey and
 * living ten minutes, so a state cookie is never a session and a session is never a state.
 */
import { config } from '@/config/deployment';
import type { Queryable } from '@/lib/db';
import { sign, verifySignature } from '@/lib/settings/crypto';
import type { AppUser } from '@/modules/platform';

export const SESSION_COOKIE = `${config.data.cookiePrefix}session`;
export const OAUTH_COOKIE = `${config.data.cookiePrefix}oauth`;

/** The cookie for a person who just signed in. `days` comes from Settings (session.days), default 30. */
export function sessionValue(user: { id: string; sessionEpoch: number }, days: number, now = Date.now()): { value: string; maxAge: number } {
  const maxAge = Math.round(days * 86_400);
  const payload = `${user.id}.${user.sessionEpoch}.${now + maxAge * 1000}`;
  return { value: `${payload}.${sign(payload, 'session')}`, maxAge };
}

export interface SessionClaims { uid: string; epoch: number; expires: number }

/**
 * The cookie's claims when its signature holds and it has not expired; null otherwise. No database: a
 * route that must not wait on one (the feedback box) can still tell a signed-in person from a stranger.
 */
export function sessionClaims(value: string | undefined | null, now = Date.now()): SessionClaims | null {
  if (!value || value.length > 400) return null;
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const [uid, epoch, exp, sig] = parts as [string, string, string, string];
  if (!/^[0-9a-f-]{36}$/i.test(uid) || !/^\d{1,9}$/.test(epoch) || !/^\d{1,15}$/.test(exp)) return null;
  if (!verifySignature(`${uid}.${epoch}.${exp}`, sig, 'session')) return null;
  if (Number(exp) <= now) return null;
  return { uid, epoch: Number(epoch), expires: Number(exp) };
}

/** The signed-in person, or null: a bad signature, an expired cookie, an inactive person or a raised epoch. */
export async function userFromSession(value: string | undefined | null, q?: Queryable, now = Date.now()): Promise<AppUser | null> {
  const claims = sessionClaims(value, now);
  if (!claims) return null;
  const { sessionUser } = await import('@/modules/platform');
  const user = await sessionUser(claims.uid, q);
  if (!user || user.sessionEpoch !== claims.epoch) return null;
  const { sessionEpoch: _, ...person } = user;
  return person;
}

/** One cookie's value out of a Cookie header. */
export function cookieFrom(header: string | null, name: string): string | null {
  for (const part of (header ?? '').split(/;\s*/)) {
    if (part.startsWith(`${name}=`)) {
      try { return decodeURIComponent(part.slice(name.length + 1)); } catch { return null; }
    }
  }
  return null;
}

/** The OAuth state cookie: the state, the PKCE verifier and when it runs out, signed. */
export function stateCookie(state: string, verifier: string, now = Date.now()): string {
  const payload = `${state}.${verifier}.${now + config.auth.stateSeconds * 1000}`;
  return `${payload}.${sign(payload, 'oauth')}`;
}

export function readStateCookie(value: string | null, now = Date.now()): { state: string; verifier: string } | null {
  const parts = (value ?? '').split('.');
  if (parts.length !== 4) return null;
  const [state, verifier, exp, sig] = parts as [string, string, string, string];
  if (!/^[\w-]{16,128}$/.test(state) || !/^[\w-]{43,128}$/.test(verifier) || !/^\d{1,15}$/.test(exp)) return null;
  if (!verifySignature(`${state}.${verifier}.${exp}`, sig, 'oauth')) return null;
  if (Number(exp) <= now) return null;
  return { state, verifier };
}

/** Secure when the public address is https; SameSite=Lax so Google's redirect back carries the state cookie. */
export function cookieAttributes(name: string, value: string, maxAge: number, secure: boolean): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}
