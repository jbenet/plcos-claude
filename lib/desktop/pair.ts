import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '@/config/deployment';
import type { AppUser } from '@/modules/platform';

/**
 * Pairing the desktop app with a person (docs/31 §2). The app starts a pairing and gets a secret device code and a
 * short code; the person opens /desktop/pair?code=<short code> in the browser where they are signed in and allows it;
 * the app's next poll receives a session of theirs, signed exactly as Google sign-in signs one. So the app acts as
 * the person, never as a token.
 *
 * Pending pairings live in this process's memory for ten minutes: a deploy in between only means pairing again.
 * The device code is kept as a hash; the short code is what the person compares by eye.
 */

const TTL_MS = 10 * 60_000;
const MAX_PENDING = 50;

export interface Pending {
  deviceHash: string;
  userCode: string;
  device: string;
  created: number;
  approvedBy: AppUser | null;
  denied: boolean;
  /** Set once the poll has handed the session over: a second poll gets nothing. */
  claimed: boolean;
}

const g = globalThis as typeof globalThis & { __desktopPairs?: Map<string, Pending> };
const pairs = (): Map<string, Pending> => (g.__desktopPairs ??= new Map());
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

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

export function startPairing(device: unknown, now = Date.now()): { deviceCode: string; userCode: string; expiresIn: number } {
  sweep(now);
  if (pairs().size >= MAX_PENDING) throw new Error('Too many pairings are waiting. Try again in a few minutes.');
  const deviceCode = randomBytes(32).toString('base64url');
  let userCode = shortCode();
  while (pairs().has(userCode)) userCode = shortCode();
  pairs().set(userCode, { deviceHash: hash(deviceCode), userCode, device: deviceLabel(device), created: now, approvedBy: null, denied: false, claimed: false });
  return { deviceCode, userCode, expiresIn: TTL_MS / 1000 };
}

/** The pending pairing a short code names, for the page that asks the person. */
export function pendingPairing(userCode: string | null, now = Date.now()): Pending | null {
  sweep(now);
  const p = userCode ? pairs().get(userCode) : undefined;
  return p && !p.claimed ? p : null;
}

export function decidePairing(userCode: string, user: AppUser, allow: boolean, now = Date.now()): Pending | null {
  const p = pendingPairing(userCode, now);
  if (!p || p.approvedBy || p.denied) return null;
  if (allow) p.approvedBy = user; else p.denied = true;
  return p;
}

export type PollAnswer =
  | { state: 'pending' }
  | { state: 'denied' }
  | { state: 'expired' }
  | { state: 'approved'; user: AppUser; userCode: string; device: string };

/** What the app's poll learns. An approved pairing is answered once, then forgotten. */
export function pollPairing(deviceCode: unknown, now = Date.now()): PollAnswer {
  sweep(now);
  if (typeof deviceCode !== 'string' || deviceCode.length < 20 || deviceCode.length > 100) return { state: 'expired' };
  const want = Buffer.from(hash(deviceCode));
  for (const p of pairs().values()) {
    if (!timingSafeEqual(Buffer.from(p.deviceHash), want)) continue;
    if (p.denied) { pairs().delete(p.userCode); return { state: 'denied' }; }
    if (!p.approvedBy || p.claimed) return p.claimed ? { state: 'expired' } : { state: 'pending' };
    p.claimed = true;
    pairs().delete(p.userCode);
    return { state: 'approved', user: p.approvedBy, userCode: p.userCode, device: p.device };
  }
  return { state: 'expired' };
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
