import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { config } from '@/config/deployment';
import { isBroker } from '@/lib/enrich/schema';

/**
 * The pages a fact check may read: only the URLs its findings cite, each fetched once, as W1c's rules say
 * (docs/workflows/w1c-fact-check.md, "Reading the cited page"). The server fetches them, not the model: the
 * model gets the page text and has no tool to read anything else, so "only the cited URLs" holds by
 * construction rather than by instruction.
 *
 * - No identity of ours in a request: a generic User-Agent and no other identifying header. SEC asks for a
 *   contact address, so its requests carry the privacy address the rules name and nothing more.
 * - LinkedIn is never fetched; a contact-data broker is never read; a page behind a paywall (402), a sign-in
 *   or a refusal is `unavailable`, never bypassed and never looked for elsewhere.
 * - A 403, 429 or 503 stops that host for the pass; the runner comes back to it once, at the end (W1 1.48).
 * - One request at a time, at least `hostIntervalMs` apart per host and `secIntervalMs` for SEC.
 * - A server-side fetch must not reach the server's own network: an address that is loopback, private,
 *   link-local (cloud metadata) or otherwise not public is refused, on every redirect hop.
 */

const GENERIC_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const SEC_UA = 'research blue.tunguska@agentmail.to'; // docs/agent-rules/real-data.md: the only contact address a request may carry.
const STOPPING = new Set([403, 429, 503]);

export type PageState = 'read' | 'unavailable' | 'host-stopped';
export interface CitedPage {
  url: string;
  state: PageState;
  /** Why it wasn't read, in words for the review note; null when read. */
  why: string | null;
  status: number | null;
  /** The page's own text: static text, image alt text and file names, link targets. Whole, for the quote check. */
  text: string;
  /** Longer than the model is given (`pages.maxChars`). */
  truncated: boolean;
  sec: boolean;
}

export interface PageDeps {
  fetch?: typeof fetch;
  lookup?: (host: string) => Promise<Array<{ address: string }>>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export const isSec = (host: string) => host === 'sec.gov' || host.endsWith('.sec.gov');
const isLinkedIn = (host: string) => host === 'linkedin.com' || host.endsWith('.linkedin.com') || host === 'lnkd.in';

/** Whether an IP address is one a public page could have. Refuses loopback, private, link-local, CGNAT, multicast and the rest. */
export function publicAddress(address: string): boolean {
  const v = isIP(address);
  if (v === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)));
  }
  if (v === 6) {
    const x = address.toLowerCase();
    if (x === '::' || x === '::1') return false;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x);
    if (mapped) return publicAddress(mapped[1]!);
    return !(/^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith('ff') || x.startsWith('64:ff9b:') || x.startsWith('2001:db8'));
  }
  return false;
}

/** Why a URL may not be fetched at all, or null. Checked before any request and again on each redirect. */
export async function urlRefusal(raw: string, lookup: NonNullable<PageDeps['lookup']>): Promise<string | null> {
  let u: URL;
  try { u = new URL(raw); } catch { return 'not a valid address'; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'not a web address';
  if (u.username || u.password) return 'carries a user name or password';
  if (u.port && u.port !== '80' && u.port !== '443') return 'names an unusual port';
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isLinkedIn(host)) return 'LinkedIn is never fetched (W1 1.50, rule 11)';
  if (isBroker(raw)) return 'a contact-data broker is never read';
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return 'not a public host';
  if (isIP(host)) return publicAddress(host) ? null : 'not a public address';
  let addresses: Array<{ address: string }>;
  try { addresses = await lookup(host); } catch { return 'the host did not resolve'; }
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address))) return 'the host resolves to an address that is not public';
  return null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === '#') { const n = e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
  return ENTITIES[e.toLowerCase()] ?? m;
});

/**
 * A page's own text, the way W1c reads one: its static text first, then what a script-drawn page or a logo
 * wall carries in its HTML (image alt text and file names, link targets), which decide over a reader's guess.
 */
export function pageText(html: string, contentType: string): string {
  if (!/html|xml/i.test(contentType)) return html.replace(/\s+/g, ' ').trim();
  const body = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const assets: string[] = [];
  for (const m of body.matchAll(/<img\b[^>]*>/gi)) {
    const alt = /\balt\s*=\s*"([^"]*)"|\balt\s*=\s*'([^']*)'/i.exec(m[0]);
    const src = /\bsrc\s*=\s*"([^"]*)"|\bsrc\s*=\s*'([^']*)'/i.exec(m[0]);
    const file = (src?.[1] ?? src?.[2] ?? '').split(/[?#]/)[0]!.split('/').pop() ?? '';
    const label = [alt?.[1] ?? alt?.[2] ?? '', file].filter(Boolean).join(' · ');
    if (label) assets.push(`image: ${decode(label)}`);
  }
  for (const m of body.matchAll(/<a\b[^>]*\bhref\s*=\s*"(https?:[^"]+)"/gi)) assets.push(`link: ${decode(m[1]!)}`);
  const text = decode(body.replace(/<(br|p|div|li|h[1-6]|tr|section|article)\b[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\f\v\r]+/g, ' ').replace(/\n\s*/g, '\n').replace(/\n{2,}/g, '\n').trim();
  return assets.length ? `${text}\n\n[page assets]\n${[...new Set(assets)].join('\n')}` : text;
}

/** For the mechanical quote check: case, quotes, dashes, punctuation and spacing don't count. */
export const normalise = (s: string) => s.normalize('NFKC').toLowerCase()
  .replace(/[‘’‚‛′]/g, "'").replace(/[“”„‟″]/g, '"').replace(/[‐-―−]/g, '-')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Whether `quote` is on the page, as a normalised substring (W1's "re-read them mechanically"). */
export const quoteOnPage = (quote: string, text: string) => {
  const q = normalise(quote);
  return q.length > 0 && normalise(text).includes(q);
};

/** Reads a set of cited pages, one request at a time, under the rules above. Never throws for a page. */
export class PageReader {
  private readonly fetch: typeof fetch;
  private readonly lookup: NonNullable<PageDeps['lookup']>;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly last = new Map<string, number>();
  readonly stopped = new Set<string>();
  requests = 0;

  constructor(deps: PageDeps = {}) {
    this.fetch = deps.fetch ?? globalThis.fetch;
    this.lookup = deps.lookup ?? ((h) => dnsLookup(h, { all: true, verbatim: true }));
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = deps.now ?? Date.now;
  }

  private async pace(host: string) {
    const gap = isSec(host) ? config.cloudWorkflows.pages.secIntervalMs : config.cloudWorkflows.pages.hostIntervalMs;
    const wait = (this.last.get(host) ?? -Infinity) + gap - this.now();
    if (wait > 0) await this.sleep(wait);
    this.last.set(host, this.now());
  }

  /** `retry` is the one later attempt at a host that refused earlier in the pass. */
  async read(url: string, retry = false): Promise<CitedPage> {
    const p = config.cloudWorkflows.pages;
    const out = (state: PageState, why: string | null, status: number | null = null, text = '', truncated = false, sec = false): CitedPage =>
      ({ url, state, why, status, text, truncated, sec });
    let current = url;
    for (let hop = 0; hop <= p.maxRedirects; hop++) {
      const refusal = await urlRefusal(current, this.lookup);
      if (refusal) return out('unavailable', hop ? `redirected to a page not read: ${refusal}` : refusal);
      const host = new URL(current).hostname.toLowerCase();
      if (this.stopped.has(host) && !retry) return out('host-stopped', 'the site refused an earlier request in this pass');
      await this.pace(host);
      const sec = isSec(host);
      let res: Response;
      this.requests++;
      try {
        res = await this.fetch(current, {
          method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(p.timeoutMs),
          headers: { 'user-agent': sec ? SEC_UA : GENERIC_UA, accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' },
        });
      } catch {
        return out('unavailable', 'the page did not load (network error or timeout)', null, '', false, sec);
      }
      if (res.status >= 300 && res.status < 400) {
        const next = res.headers.get('location');
        await res.body?.cancel().catch(() => undefined);
        if (!next) return out('unavailable', `redirect ${res.status} without a location`, res.status, '', false, sec);
        current = new URL(next, current).toString();
        continue;
      }
      if (res.status === 402) { await res.body?.cancel().catch(() => undefined); return out('unavailable', 'behind a paywall (402); not bypassed', 402, '', false, sec); }
      if (STOPPING.has(res.status)) {
        await res.body?.cancel().catch(() => undefined);
        this.stopped.add(host);
        return out(retry ? 'unavailable' : 'host-stopped', `the site refused the request (${res.status})${retry ? ' twice; not read' : ''}`, res.status, '', false, sec);
      }
      if (!res.ok) { await res.body?.cancel().catch(() => undefined); return out('unavailable', `the page answered ${res.status}`, res.status, '', false, sec); }
      const type = res.headers.get('content-type') ?? '';
      if (/pdf|image|audio|video|zip|octet-stream/i.test(type)) { await res.body?.cancel().catch(() => undefined); return out('unavailable', `not a text page (${type.split(';')[0]})`, res.status, '', false, sec); }
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > p.maxBytes) { await res.body?.cancel().catch(() => undefined); return out('unavailable', 'the page is larger than a fact check reads', res.status, '', false, sec); }
      let html: string;
      try {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length > p.maxBytes) return out('unavailable', 'the page is larger than a fact check reads', res.status, '', false, sec);
        html = buf.toString('utf8');
      } catch { return out('unavailable', 'the page stopped loading part way', res.status, '', false, sec); }
      if (/<form\b[^>]*(login|signin|sign-in)|cf-browser-verification|challenge-platform|captcha/i.test(html) && html.length < 20_000) {
        return out('unavailable', 'a sign-in wall or browser checkpoint; not bypassed', res.status, '', false, sec);
      }
      const text = pageText(html, type);
      return out('read', null, res.status, text, text.length > p.maxChars, sec);
    }
    return out('unavailable', `more than ${p.maxRedirects} redirects`);
  }
}
