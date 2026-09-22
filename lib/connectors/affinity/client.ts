import type { RateWindow, RequestLogEntry } from '@/modules/sources';
import { allowed } from './allowlist';
import { AFFINITY_ORIGIN, guardedFetch, type FetchLike } from './fetch';

/**
 * The read-only Affinity client (N39, docs/15). Transport-agnostic: the real profile sends
 * over HTTPS, the demo reads a fake Affinity from fixtures/affinity/, and the property
 * harness scripts whatever it needs to prove — so the rules below are tested on the code
 * that enforces them, not on a copy.
 *
 * The rules, in the order a request meets them:
 *   1. The URL is Affinity's, and its path is on the allowlist. Otherwise: refused, logged.
 *   2. The budget allows it — our own per-minute ceiling, our share of the account's month,
 *      and a floor under the account's remaining month. Otherwise: wait, or refuse.
 *   3. GET, no body, no redirects (fetch.ts).
 *   4. A 429 waits for the reset the headers give and tries again, three times at most.
 *   5. Every attempt is logged — path, status, time, budget. Never a body or a header.
 *   6. The key appears in nothing this client writes or throws.
 */

export interface TransportResponse {
  status: number;
  headers: Headers;
  text(): Promise<string>;
}

export interface Transport {
  readonly kind: 'https' | 'fixture' | 'scripted';
  get(url: URL, headers: Record<string, string>): Promise<TransportResponse>;
}

export function httpsTransport(fetchImpl?: FetchLike): Transport {
  const send = guardedFetch(fetchImpl);
  return {
    kind: 'https',
    get: (url, headers) => send(url, { method: 'GET', headers, signal: AbortSignal.timeout(30_000) }),
  };
}

export interface Limits {
  /** Our own ceiling per rolling minute, well under Affinity's per-user limit. */
  maxPerMinute: number;
  /** The most of the account's monthly quota this tool may use. */
  monthlyShare: number;
  /** Stop when the account has less than this fraction of its month left. */
  monthlyFloor: number;
}

export interface Budget {
  perMinute: RateWindow | null;
  /** 'none' when Affinity says no monthly quota applies; null before anything was read. */
  perMonth: RateWindow | 'none' | null;
  readAt: Date | null;
}

export class AffinityRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AffinityRefused';
  }
}

export class AffinityError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'AffinityError';
  }
}

export interface ClientOptions {
  transport: Transport;
  key: string;
  limits: Limits;
  log: (e: RequestLogEntry) => Promise<void>;
  /** Requests this tool has sent this calendar month, from its own log. */
  usedThisMonth: () => Promise<number>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface AffinityClient {
  readonly transportKind: Transport['kind'];
  get<T>(pathOrUrl: string, query?: Record<string, string | number | undefined>): Promise<T>;
  pages<T>(path: string, query?: Record<string, string | number | undefined>): AsyncIterable<T[]>;
  budget(): Budget;
}

const SOURCE = 'affinity';
const MAX_TRIES = 4;
const MAX_WAIT_MS = 60_000;
const MAX_PAGES = 10_000;

const num = (h: Headers, k: string): number | null => {
  const v = h.get(k);
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function affinityClient(opts: ClientOptions): AffinityClient {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => Date.now());
  const redact = (s: string) => (opts.key ? s.split(opts.key).join('[key]') : s).replace(/Bearer\s+\S+/gi, 'Bearer [key]');
  const sent: number[] = [];
  const state: Budget = { perMinute: null, perMonth: null, readAt: null };
  /** Our own count for the month: read from the log once, then kept up to date here. */
  let ours: number | null = null;

  const log = (e: Omit<RequestLogEntry, 'source' | 'userRemaining' | 'orgRemaining'>) =>
    opts.log({
      ...e,
      source: SOURCE,
      note: e.note === null ? null : redact(e.note),
      userRemaining: state.perMinute?.remaining ?? null,
      orgRemaining: state.perMonth && state.perMonth !== 'none' ? state.perMonth.remaining : null,
    });

  const refuse = async (endpoint: string, path: string, why: string): Promise<never> => {
    await log({ endpoint, path, outcome: 'refused', status: null, durationMs: null, note: why });
    throw new AffinityRefused(`${why} (${path})`);
  };

  const readHeaders = (h: Headers, ok: boolean) => {
    const userLimit = num(h, 'x-ratelimit-limit-user');
    if (userLimit !== null) {
      const remaining = num(h, 'x-ratelimit-limit-user-remaining') ?? 0;
      state.perMinute = { limit: userLimit, remaining, reset: num(h, 'x-ratelimit-limit-user-reset') ?? 60, used: userLimit - remaining };
    }
    const orgLimit = num(h, 'x-ratelimit-limit-org');
    if (orgLimit !== null) {
      const remaining = num(h, 'x-ratelimit-limit-org-remaining') ?? 0;
      state.perMonth = { limit: orgLimit, remaining, reset: num(h, 'x-ratelimit-limit-org-reset') ?? 0, used: orgLimit - remaining };
    } else if (ok && userLimit !== null) {
      // Affinity omits the monthly headers when no monthly quota applies. Only a successful
      // answer that carries the per-minute headers is allowed to say so.
      state.perMonth = 'none';
    }
    if (userLimit !== null || orgLimit !== null) state.readAt = new Date(now());
  };

  /** Wait for our own per-minute ceiling, and for Affinity's when it says none are left. */
  const pace = async () => {
    const minuteAgo = now() - 60_000;
    while (sent.length && sent[0]! < minuteAgo) sent.shift();
    if (sent.length >= opts.limits.maxPerMinute) await sleep(Math.min(MAX_WAIT_MS, sent[0]! + 60_000 - now()));
    if (state.perMinute && state.perMinute.remaining <= 0) await sleep(Math.min(MAX_WAIT_MS, state.perMinute.reset * 1000));
  };

  const checkMonth = async (endpoint: string, path: string) => {
    const month = state.perMonth;
    if (!month || month === 'none') return;
    if (month.remaining <= month.limit * opts.limits.monthlyFloor) {
      await refuse(endpoint, path, `the account has ${month.remaining} of ${month.limit} requests left this month, under the ${Math.round(opts.limits.monthlyFloor * 100)}% floor kept for everything else that uses Affinity`);
    }
    ours ??= await opts.usedThisMonth();
    if (ours >= month.limit * opts.limits.monthlyShare) {
      await refuse(endpoint, path, `this tool has used ${ours} requests this month, its whole ${Math.round(opts.limits.monthlyShare * 100)}% share of the account's ${month.limit}`);
    }
  };

  async function get<T>(pathOrUrl: string, query?: Record<string, string | number | undefined>): Promise<T> {
    let url: URL;
    try {
      url = new URL(pathOrUrl, AFFINITY_ORIGIN);
    } catch {
      return refuse('(unparseable)', '(unparseable)', 'not a URL');
    }
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const path = url.pathname;
    if (url.origin !== AFFINITY_ORIGIN) return refuse('(another host)', `${url.origin}${path}`, `not Affinity's host — the key only ever goes to ${AFFINITY_ORIGIN}`);
    const endpoint = allowed(path);
    if (!endpoint) return refuse('(not allowlisted)', path, 'not on the allowlist');

    for (let attempt = 1; ; attempt++) {
      await checkMonth(endpoint.template, path);
      await pace();
      const started = now();
      sent.push(started);
      if (ours !== null) ours++;
      let res: TransportResponse;
      try {
        res = await opts.transport.get(url, { Authorization: `Bearer ${opts.key}`, Accept: 'application/json' });
      } catch (err) {
        const why = err instanceof Error ? `${err.name}: ${err.message}` : 'unknown';
        await log({ endpoint: endpoint.template, path, outcome: 'network_error', status: null, durationMs: now() - started, note: why });
        throw new AffinityError(0, redact(`Could not reach Affinity (${why})`));
      }
      readHeaders(res.headers, res.status >= 200 && res.status < 300);
      const durationMs = now() - started;

      if (res.status === 429) {
        const month = state.perMonth;
        const spent = month && month !== 'none' && month.remaining <= 0;
        await log({ endpoint: endpoint.template, path, outcome: 'rate_limited', status: 429, durationMs, note: spent ? 'monthly quota spent' : `attempt ${attempt} of ${MAX_TRIES}` });
        if (spent) {
          throw new AffinityError(429, `The account's monthly Affinity quota is spent. It resets in ${Math.ceil((month as RateWindow).reset / 86_400)} days.`);
        }
        if (attempt >= MAX_TRIES) throw new AffinityError(429, `Affinity kept saying too many requests; gave up after ${MAX_TRIES} tries.`);
        const reset = num(res.headers, 'x-ratelimit-limit-user-reset');
        await sleep(Math.min(MAX_WAIT_MS, reset !== null ? Math.max(1, reset) * 1000 : 2 ** attempt * 1000));
        continue;
      }

      const text = await res.text();
      await log({ endpoint: endpoint.template, path, outcome: 'sent', status: res.status, durationMs, note: null });
      if (res.status < 200 || res.status >= 300) {
        let message = text.slice(0, 300);
        try {
          const body = JSON.parse(text) as { errors?: Array<{ message?: string }>; message?: string };
          message = body.errors?.[0]?.message ?? body.message ?? message;
        } catch {
          /* not JSON; the first few hundred characters will do */
        }
        throw new AffinityError(res.status, redact(`Affinity answered ${res.status} for ${endpoint.template}: ${message}`));
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new AffinityError(res.status, `Affinity answered ${endpoint.template} with something that is not JSON.`);
      }
    }
  }

  async function* pages<T>(path: string, query?: Record<string, string | number | undefined>): AsyncIterable<T[]> {
    let next: string | null = path;
    let q = query;
    for (let n = 0; next; n++) {
      if (n >= MAX_PAGES) throw new AffinityRefused(`more than ${MAX_PAGES} pages from ${path}; stopping rather than spending the month`);
      const page: { data?: T[]; pagination?: { nextUrl?: string | null } } = await get(next, q);
      yield page.data ?? [];
      // nextUrl is absolute and carries its own query. It goes through the same checks as
      // everything else, so a next page on another host is refused rather than followed.
      next = page.pagination?.nextUrl ?? null;
      q = undefined;
    }
  }

  return {
    transportKind: opts.transport.kind,
    get,
    pages,
    budget: () => ({ ...state }),
  };
}
