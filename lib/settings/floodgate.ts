/**
 * Wrong setup codes, limited (MailGuard's floodgate.ts). The code has 48 random bits. Per address, so one
 * stranger cannot lock the operator out of a fresh server; in total, which only bounds guessing from many
 * addresses (10,000 an hour for a year is still about a one-in-three-million chance). In memory: a restart
 * prints a new code anyway.
 */
import { isIP } from 'node:net';

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

/** Has this address, or everyone together, had too many wrong codes this hour? */
export function setupBlocked(ip: string | null, now = Date.now()): boolean {
  const st = state();
  if (current(st.all, now).n >= SETUP_FAILS_TOTAL) return true;
  // With no client address everyone would share one bucket, and anyone could fill it: total cap only.
  return !!ip && current(st.by.get(addressKey(ip)), now).n >= SETUP_FAILS_PER_ADDRESS;
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

const PRIVATE = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|169\.254\.|::1$|f[cd][0-9a-f]{2}:|fe80:)/i;

/**
 * The client's address. The proxy in front (Railway's edge) appends the address it saw to
 * X-Forwarded-For, so the right-most public entry is the one nobody upstream could forge.
 */
export function clientIp(h: Pick<Headers, 'get'>): string | null {
  const entries = (h.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim().replace(/^\[|\](:\d+)?$/g, '')).filter((s) => isIP(s));
  for (let i = entries.length - 1; i >= 0; i--) if (!PRIVATE.test(entries[i]!)) return entries[i]!.slice(0, 64);
  if (entries.length) return entries[0]!.slice(0, 64);
  const real = h.get('x-real-ip')?.trim() ?? '';
  return isIP(real) ? real : null;
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
