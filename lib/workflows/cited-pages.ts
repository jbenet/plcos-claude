import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { Readable } from 'node:stream';
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
    const b = ipv6Bytes(address);
    if (!b) return false;
    const zero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0);
    // ::ffff:0:0/96, IPv4-mapped, in either spelling (`::ffff:7f00:1` is 127.0.0.1): judged by its IPv4 part.
    if (zero(0, 10) && b[10] === 0xff && b[11] === 0xff) return publicAddress(b.slice(12).join('.'));
    if (zero(0, 8)) return false; // ::, ::1, ::/96 (IPv4-compatible), ::ffff:0:0:0/96 and the rest of ::/64
    const [b0, b1, b2, b3] = b as unknown as [number, number, number, number];
    if (b0 === 0x00 && b1 === 0x64 && b2 === 0xff && b3 === 0x9b) return false; // 64:ff9b::/32, NAT64 (well-known and local)
    if (b0 === 0x01 && b1 === 0x00 && zero(2, 8)) return false; // 100::/64, discard
    if (b0 === 0x20 && b1 === 0x02) return false; // 2002::/16, 6to4 carries an IPv4 address
    if (b0 === 0x20 && b1 === 0x01 && b2 === 0x00 && b3 === 0x00) return false; // 2001::/32, Teredo carries one too
    if (b0 === 0x20 && b1 === 0x01 && b2 === 0x0d && b3 === 0xb8) return false; // 2001:db8::/32, documentation
    if ((b0 & 0xfe) === 0xfc) return false; // fc00::/7, unique local
    if (b0 === 0xfe && b1 >= 0x80) return false; // fe80::/10 link-local and fec0::/10 site-local
    if (b0 === 0xff) return false; // multicast
    return true;
  }
  return false;
}

/** The 16 bytes of an IPv6 address (a zone suffix dropped, an embedded IPv4 tail read), or null. */
function ipv6Bytes(address: string): number[] | null {
  let x = address.toLowerCase().replace(/%.*$/, '');
  const tail = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(x);
  if (tail) {
    const q = tail.slice(1).map(Number);
    if (q.some((n) => n > 255)) return null;
    x = x.slice(0, tail.index) + ((q[0]! << 8) | q[1]!).toString(16) + ':' + ((q[2]! << 8) | q[3]!).toString(16);
  }
  const halves = x.split('::');
  if (halves.length > 2) return null;
  const words = (h: string) => (h ? h.split(':') : []);
  const head = words(halves[0]!), rest = halves.length === 2 ? words(halves[1]!) : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const all = [...head, ...Array<string>(fill).fill('0'), ...rest];
  if (all.length !== 8 || all.some((w) => !/^[0-9a-f]{1,4}$/.test(w))) return null;
  return all.flatMap((w) => { const n = parseInt(w, 16); return [n >> 8, n & 0xff]; });
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

/**
 * A fetch whose connection goes to an address the check passed. `urlRefusal` resolves the host once to refuse
 * a private one, but a second, independent resolution at connect time could answer differently (DNS
 * rebinding). Here the socket's own lookup runs the check, so the address connected to is the address
 * checked; the URL's host name is untouched, so TLS SNI and the certificate check stay as they are. No
 * redirect is followed (each hop is a new call, checked again) and nothing is decompressed (none is asked for).
 */
export function pinnedFetch(lookup: NonNullable<PageDeps['lookup']>, allowed: (address: string) => boolean = publicAddress): typeof fetch {
  const pinned: LookupFunction = (host, options, done) => {
    lookup(host).then((found) => {
      const addresses = found.map((a) => ({ address: a.address, family: isIP(a.address) }));
      if (!addresses.length || addresses.some((a) => !a.family || !allowed(a.address))) {
        done(Object.assign(new Error('the host resolves to an address that is not public'), { code: 'EADDRNOTPUBLIC' }), '', 0);
        return;
      }
      const wanted = options.family === 4 || options.family === 6 ? addresses.filter((a) => a.family === options.family) : addresses;
      if (!wanted.length) { done(Object.assign(new Error('no address of the wanted family'), { code: 'ENOTFOUND' }), '', 0); return; }
      if (options.all) (done as unknown as (e: null, a: typeof wanted) => void)(null, wanted);
      else done(null, wanted[0]!.address, wanted[0]!.family);
    }, (error: unknown) => done(error instanceof Error ? error as NodeJS.ErrnoException : new Error('lookup failed'), '', 0));
  };
  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new TypeError('not a web address');
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => { headers[k] = v; });
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const res = await new Promise<IncomingMessage>((resolve, reject) => {
      const req = send(url, { method: init.method ?? 'GET', headers, lookup: pinned, signal: init.signal ?? undefined }, resolve);
      req.on('error', reject);
      req.end();
    });
    const out = new Headers();
    for (let i = 0; i + 1 < res.rawHeaders.length; i += 2) out.append(res.rawHeaders[i]!, res.rawHeaders[i + 1]!);
    const status = res.statusCode ?? 0;
    if (status < 200 || status > 599) { res.destroy(); throw new TypeError(`the page answered an unusable status ${status}`); }
    const empty = status === 204 || status === 205 || status === 304 || init.method === 'HEAD';
    if (empty) res.resume();
    return new Response(empty ? null : Readable.toWeb(res) as ReadableStream<Uint8Array>, { status, statusText: res.statusMessage, headers: out });
  }) as typeof fetch;
}

/** The body as text, read until `max` bytes and no further: a huge answer is refused, never held whole in memory. */
async function readCapped(res: Response, max: number): Promise<string | null> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '', bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > max) { await reader.cancel().catch(() => undefined); return null; }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
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
    this.lookup = deps.lookup ?? ((h) => dnsLookup(h, { all: true, verbatim: true }));
    // The connection is made to an address checked at connect time, on every hop (see pinnedFetch).
    this.fetch = deps.fetch ?? pinnedFetch(this.lookup);
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
        const read = await readCapped(res, p.maxBytes);
        if (read === null) return out('unavailable', 'the page is larger than a fact check reads', res.status, '', false, sec);
        html = read;
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
