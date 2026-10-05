/**
 * The page warm-up's pass behind Google sign-in (lib/page-warm.ts; 5 Oct 2026, the first Railway boot: every
 * loopback warm-up request answered 307 to /signin, so the page-speed fix did nothing in the cloud).
 *
 * It is not a session. The warmer mints it in this process, just before a warm-up, for the oldest active admin,
 * and revokes it as soon as the warm-up ends; it lives at most WARM_PASS_MS either way. It is accepted only
 * when all of these hold, and is refused everywhere else:
 *   - the request carries the exact value this process minted last, and it has not expired or been revoked;
 *   - its signature holds under the `warm` subkey of PLCOS_SECRET (never the session's, so no session cookie
 *     is a warm pass and no warm pass is a session);
 *   - the proxy's signed routing context says it is a GET for one of the paths the warmer asked to warm;
 *   - the Host header names this server's loopback address. A client sets that header, so this is defence in
 *     depth only: the gate is the unguessable value held in this process's memory, never Host alone;
 *   - the admin is still active, an admin, and at the epoch it was minted for.
 * The mutation guard and every server action refuse any request that carries one (lib/mutation-guard.ts), so
 * even a leaked pass could not write. Nothing here is reachable from a route, an action, a header or the
 * environment: only the warmer calls mintWarmPass. It is never logged, never written, never in a response.
 */
import { randomBytes } from 'node:crypto';
import { config } from '@/config/deployment';
import type { Queryable } from '@/lib/db';
import { routingContext } from '@/lib/internal-routing';
import { sameText, sign, verifySignature } from '@/lib/settings/crypto';
import type { AppUser } from '@/modules/platform';

/** The cookie the warmer sends over loopback. No browser is ever given one. */
export const WARM_COOKIE = `${config.data.cookiePrefix}warm`;
/** GUESS — a warm-up of ~14 pages takes well under a minute; the pass is revoked when it ends anyway. */
export const WARM_PASS_MS = 5 * 60_000;

interface Pass { value: string; expires: number; paths: Set<string> }
const g = globalThis as typeof globalThis & { __plcosWarmPass?: Pass | null };

/** Mint the pass for one warm-up: this admin, these paths. Replaces any earlier pass. In-process only. */
export function mintWarmPass(admin: { id: string; sessionEpoch: number }, paths: string[], now = Date.now()): string {
  const expires = now + WARM_PASS_MS;
  const payload = `${admin.id}.${admin.sessionEpoch}.${expires}.${randomBytes(12).toString('base64url')}`;
  const value = `${payload}.${sign(payload, 'warm')}`;
  g.__plcosWarmPass = { value, expires, paths: new Set(paths.map((p) => p.split('?')[0]!)) };
  return value;
}

/** End the pass now: called when each warm-up finishes, whatever happened. */
export function revokeWarmPass() { g.__plcosWarmPass = null; }

const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?$/i;

/**
 * The admin a warm pass stands for, or null. `h` is the request's headers: the routing context and Host.
 * Reads only: nothing is written or bumped, however often it is asked.
 */
export async function warmPassUser(value: string | undefined | null, h: Pick<Headers, 'get'>, q?: Queryable, now = Date.now()): Promise<AppUser | null> {
  const pass = g.__plcosWarmPass;
  if (!value || !pass || pass.expires <= now || !sameText(value, pass.value)) return null;
  const parts = value.split('.');
  if (parts.length !== 5) return null;
  const [uid, epoch, exp, nonce, sig] = parts as [string, string, string, string, string];
  if (!verifySignature(`${uid}.${epoch}.${exp}.${nonce}`, sig, 'warm') || Number(exp) <= now) return null;
  const routed = routingContext(h);
  if (!routed || routed.method !== 'GET' || !pass.paths.has(routed.asked)) return null;
  if (!LOOPBACK.test(h.get('host') ?? '')) return null;
  const { sessionUser } = await import('@/modules/platform');
  const user = await sessionUser(uid, q);
  if (!user || user.sessionEpoch !== Number(epoch) || user.access !== 'admin') return null;
  const { sessionEpoch: _, ...person } = user;
  return person;
}
