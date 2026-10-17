import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '@/config/deployment';
import type { AppUser } from '@/modules/platform';

/**
 * Pairing the desktop app with a person (docs/31 §2), as an OAuth loopback flow. The app starts a pairing with a PKCE
 * challenge and its loopback port and gets a short code; the person opens /desktop/pair?code=<short code> in the
 * browser where they are signed in and allows it; the browser is then sent to the app's own loopback address with a
 * one-time grant, which the app exchanges, with the verifier only it holds, for a session of theirs, signed exactly as
 * Google sign-in signs one. So the app acts as the person, never as a token.
 *
 * Why loopback and not polling: with polling, whoever started a pairing could send someone else the link and collect
 * their session when they press Allow. Here the grant goes only to the browser's own machine, and only the app that
 * started the pairing holds the verifier.
 *
 * Pending pairings live in this process's memory for ten minutes: a deploy in between only means pairing again.
 */

const TTL_MS = 10 * 60_000;
/** The app's own loopback port (desktop/plcos/core/core.mjs): the only one a grant is sent to (security review, 17 Oct 2026). */
export const DESKTOP_PORT = 47100;
const MAX_PENDING = 50;
/** Unanswered pairings one address may hold at once; a person needs one. */
export const PENDING_PER_ADDRESS = 3;

export interface Pending {
  userCode: string;
  challenge: string;
  port: number;
  device: string;
  /** The address that started it, as the trusted proxy reports it; null when unknown. */
  ip: string | null;
  created: number;
  approvedBy: AppUser | null;
  grantHash: string | null;
  denied: boolean;
}

const g = globalThis as typeof globalThis & { __desktopPairs?: Map<string, Pending> };
const pairs = (): Map<string, Pending> => (g.__desktopPairs ??= new Map());
const sha = (s: string) => createHash('sha256').update(s).digest();
const b64 = (b: Buffer) => b.toString('base64url');

function sweep(now = Date.now()): void {
  for (const [code, p] of pairs()) if (now - p.created > TTL_MS) pairs().delete(code);
}

/** Letters that cannot be mistaken for one another, in two groups of four: "KDTP-WMRX". */
const ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
function shortCode(): string {
  const b = randomBytes(8);
  const c = [...b].map((x) => ALPHABET[x % ALPHABET.length]).join('');
  return `${c.slice(0, 4)}-${c.slice(4, 8)}`;
}

export const normalizeCode = (s: string | null | undefined): string | null => {
  const t = (s ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  return t.length === 8 ? `${t.slice(0, 4)}-${t.slice(4)}` : null;
};

/** A plain device label, from what the app says it is. */
const deviceLabel = (s: unknown): string => (typeof s === 'string' ? s.replace(/[^\p{L}\p{N} ._'’()-]/gu, '').trim().slice(0, 60) : '') || 'a Mac';

/**
 * Anyone may start a pairing (nobody is signed in on the app yet), so one address holds at most a few unanswered
 * ones, and when the whole table is full the oldest unanswered one makes room: a stream of starts can delay a
 * pairing, never block everyone's.
 */
export function startPairing(device: unknown, challenge: unknown, port: unknown, now = Date.now(), ip: string | null = null): { userCode: string; expiresIn: number } {
  sweep(now);
  if (typeof challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw new Error('A PKCE challenge (S256, base64url) is required.');
  const p = Number(port);
  if (p !== DESKTOP_PORT) throw new Error(`The app's loopback port is ${DESKTOP_PORT}.`);
  const open = [...pairs().values()].filter((x) => !x.approvedBy);
  if (ip && open.filter((x) => x.ip === ip).length >= PENDING_PER_ADDRESS) throw new Error('Too many pairings are waiting from this address. Finish one or try again in a few minutes.');
  if (pairs().size >= MAX_PENDING) {
    const oldest = open.sort((a, b) => a.created - b.created)[0];
    if (!oldest) throw new Error('Too many pairings are waiting. Try again in a few minutes.');
    pairs().delete(oldest.userCode);
  }
  let userCode = shortCode();
  while (pairs().has(userCode)) userCode = shortCode();
  pairs().set(userCode, { userCode, challenge, port: p, device: deviceLabel(device), ip, created: now, approvedBy: null, grantHash: null, denied: false });
  return { userCode, expiresIn: TTL_MS / 1000 };
}

/** The pending pairing a short code names, for the page that asks the person. */
export function pendingPairing(userCode: string | null, now = Date.now()): Pending | null {
  sweep(now);
  return (userCode ? pairs().get(userCode) : undefined) ?? null;
}

/**
 * Allow or refuse. Allowing returns where to send the browser: the app's loopback address, with a one-time grant.
 * Refusing forgets the pairing. A pairing is allowed only from the address that started it, when both are known
 * (security review, 17 Oct 2026: someone else's app, started elsewhere, sent as a link): `elsewhere` then, and it is
 * forgotten.
 */
export function decidePairing(userCode: string, user: AppUser, allow: boolean, now = Date.now(), ip: string | null = null): { pending: Pending; redirect: string | null; elsewhere?: true } | null {
  const p = pendingPairing(userCode, now);
  if (!p || p.approvedBy || p.denied) return null;
  if (allow && p.ip && ip && p.ip !== ip) { p.denied = true; pairs().delete(userCode); return { pending: p, redirect: null, elsewhere: true }; }
  if (!allow) { p.denied = true; pairs().delete(userCode); return { pending: p, redirect: null }; }
  const grant = b64(randomBytes(32));
  p.approvedBy = user;
  p.grantHash = b64(sha(grant));
  return { pending: p, redirect: `http://127.0.0.1:${p.port}/__desktop/callback?grant=${encodeURIComponent(grant)}&code=${encodeURIComponent(p.userCode)}` };
}

/** The app's exchange: the grant the browser carried and the verifier only the app has. Once. */
export function claimPairing(grant: unknown, verifier: unknown, now = Date.now()): { user: AppUser; device: string } | null {
  sweep(now);
  if (typeof grant !== 'string' || typeof verifier !== 'string' || grant.length > 100 || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier)) return null;
  const want = Buffer.from(b64(sha(grant)));
  for (const p of pairs().values()) {
    if (!p.grantHash || !p.approvedBy || want.length !== p.grantHash.length || !timingSafeEqual(Buffer.from(p.grantHash), want)) continue;
    pairs().delete(p.userCode);
    const challenge = Buffer.from(b64(sha(verifier)));
    if (challenge.length !== p.challenge.length || !timingSafeEqual(challenge, Buffer.from(p.challenge))) return null;
    return { user: p.approvedBy, device: p.device };
  }
  return null;
}

/** Only tests reset this. */
export function resetPairings(): void { pairs().clear(); }

/** The cookie that makes the app act as `user`, named and signed as this server's own sign-in names and signs it. */
export async function pairedCookie(user: AppUser, secure: boolean): Promise<{ name: string; value: string; maxAge: number }> {
  if (config.auth.provider === 'google') {
    const { sessionCookie, sessionValue } = await import('@/lib/auth/session');
    const { sessionUser } = await import('@/modules/platform');
    const { settingValue } = await import('@/lib/settings/store');
    const { SESSION_DAYS_SETTING } = await import('@/lib/settings/registry');
    const row = await sessionUser(user.id);
    if (!row) throw new Error('That person is no longer active.');
    const days = Number(settingValue(SESSION_DAYS_SETTING.key) ?? config.auth.sessionDays) || config.auth.sessionDays;
    const s = sessionValue(row, days);
    return { name: sessionCookie(secure), value: s.value, maxAge: s.maxAge };
  }
  if (config.auth.provider === 'labos') throw new Error('Pairing is not available with LabOS sign-in.');
  // The local switcher (the Mac's own servers, tests): who you are is the user cookie.
  const { USER_COOKIE } = await import('@/lib/auth/cookie');
  return { name: USER_COOKIE, value: user.handle, maxAge: 30 * 86_400 };
}
