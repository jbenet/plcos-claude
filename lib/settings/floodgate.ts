/**
 * Wrong setup codes, limited (MailGuard's floodgate.ts). The code has 48 random bits. Per address, so one
 * stranger cannot lock the operator out of a fresh server; in total, which only bounds guessing from many
 * addresses (10,000 an hour for a year is still about a one-in-three-million chance). In memory: a restart
 * prints a new code anyway.
 */
import { isIP } from 'node:net';
import { PROXY_HOPS_SETTING } from './registry';
import { settingValue } from './store';

export const SETUP_FAILS_PER_ADDRESS = 10;
export const SETUP_FAILS_TOTAL = 10_000;
const HOUR = 3_600_000;

interface Window { start: number; n: number }
const g = globalThis as typeof globalThis & { __plcosSetupFails?: { all: Window; by: Map<string, Window> } };
const state = () => (g.__plcosSetupFails ??= { all: { start: 0, n: 0 }, by: new Map() });
const current = (w: Window | undefined, now: number) => (w && w.start > now - HOUR ? w : { start: now, n: 0 });

/** The eight groups of an IPv6 address, expanded; null when it is not one. */
function ipv6Groups(ip: string): string[] | null {
  if (isIP(ip) !== 6) return null;
  let text = ip.toLowerCase().split('%')[0]!;
  // An IPv4 tail (::ffff:1.2.3.4) becomes two groups.
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (v4) {
    const b = v4[1]!.split('.').map(Number);
    text = text.slice(0, -v4[1]!.length) + `${((b[0]! << 8) | b[1]!).toString(16)}:${((b[2]! << 8) | b[3]!).toString(16)}`;
  }
  const [head, tail] = text.split('::') as [string, string | undefined];
  const left = head ? head.split(':') : [];
  const right = tail === undefined ? [] : tail ? tail.split(':') : [];
  const fill = tail === undefined ? [] : Array(8 - left.length - right.length).fill('0');
  const groups = [...left, ...fill, ...right].map((x) => x.replace(/^0+(?=.)/, ''));
  return groups.length === 8 ? groups : null;
}

/** One bucket per IPv4 address, and per IPv6 /64: a client usually holds a whole /64. */
export function addressKey(ip: string | null): string {
  if (!ip) return 'unknown';
  const v6 = ipv6Groups(ip);
  if (v6) {
    // An IPv4 address written as IPv6 is that IPv4 address.
    if (v6.slice(0, 6).join(':') === '0:0:0:0:0:ffff') return `${parseInt(v6[6]!, 16) >> 8}.${parseInt(v6[6]!, 16) & 255}.${parseInt(v6[7]!, 16) >> 8}.${parseInt(v6[7]!, 16) & 255}`;
    return `${v6.slice(0, 4).join(':')}::/64`;
  }
  return ip;
}

/**
 * Has this address had too many wrong codes this hour? Past the total cap, only an address with no wrong
 * code this hour may still try: guessing from many addresses then gets one try per new address an hour,
 * and the operator, who has made no mistakes, is never locked out by strangers filling the total. A request
 * with no address is refused while the total is over: it cannot be told apart.
 */
export function setupBlocked(ip: string | null, now = Date.now()): boolean {
  const st = state();
  const mine = ip ? current(st.by.get(addressKey(ip)), now).n : 0;
  if (mine >= SETUP_FAILS_PER_ADDRESS) return true;
  if (current(st.all, now).n >= SETUP_FAILS_TOTAL) return !ip || mine > 0;
  return false;
}

export function noteSetupFailure(ip: string | null, now = Date.now()): void {
  const st = state();
  if (st.by.size > 10_000) for (const [k, w] of st.by) if (w.start <= now - HOUR) st.by.delete(k);
  st.all = current(st.all, now);
  st.all.n++;
  if (!ip) return;
  const w = current(st.by.get(addressKey(ip)), now);
  w.n++;
  st.by.set(addressKey(ip), w);
}

export function resetSetupFloodgate() {
  delete g.__plcosSetupFails;
  delete (globalThis as typeof globalThis & { __plcosRefusals?: unknown }).__plcosRefusals;
}

/**
 * How many proxies in front of this server append to X-Forwarded-For. Railway's edge is one. GUESS: the
 * rehearsal must confirm how Railway's edge sets the header (docs/deploy/railway.md §4). Settings →
 * Connections, or PLCOS_TRUSTED_PROXY_HOPS, overrides it; 0 trusts the header not at all.
 */
export const TRUSTED_PROXY_HOPS = 1; // GUESS

export function trustedHops(): number {
  const v = Number(settingValue(PROXY_HOPS_SETTING.key) ?? TRUSTED_PROXY_HOPS);
  return Number.isInteger(v) && v >= 0 && v <= 5 ? v : TRUSTED_PROXY_HOPS;
}

/**
 * The client's address: the entry the outermost trusted proxy appended, counted from the right. Everything
 * to its left came from the client and could say anything. With fewer entries than trusted hops the request
 * did not come through the proxies, and with 0 hops the header is not trusted: no address, so only the
 * total limits apply.
 */
export function clientIp(h: Pick<Headers, 'get'>, hops = trustedHops()): string | null {
  if (hops <= 0) return null;
  const entries = (h.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim().replace(/^\[|\](:\d+)?$/g, ''));
  const ip = entries.length >= hops ? entries[entries.length - hops]! : '';
  return isIP(ip) ? ip.slice(0, 64) : null;
}

/**
 * Anyone can hit the sign-in callback, and every refusal is logged; past this many in a minute from one
 * address the refusals are still refused, but no longer written to the audit log (MailGuard's noteFailure).
 */
export const LOGGED_REFUSALS_PER_MINUTE = 30;
const r = globalThis as typeof globalThis & { __plcosRefusals?: Map<string, Window> };

/** Count one refusal; true while it should still be logged. */
export function logThisRefusal(ip: string | null, now = Date.now()): boolean {
  const m = (r.__plcosRefusals ??= new Map());
  if (m.size > 10_000) for (const [k, w] of m) if (w.start < now - 60_000) m.delete(k);
  const key = addressKey(ip);
  let w = m.get(key);
  if (!w || w.start < now - 60_000) m.set(key, (w = { start: now, n: 0 }));
  w.n++;
  return w.n <= LOGGED_REFUSALS_PER_MINUTE;
}
