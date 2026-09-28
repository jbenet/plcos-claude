import { config } from '@/config/deployment';
import { recordActivity } from '@/lib/activity/log';
import { QUERIES, type QueryName } from './queries';

/**
 * The read-only Linear client (docs/24-linear.md). Linear's personal keys cannot be scoped to
 * reading, and the same GraphQL endpoint takes mutations, so read-only is enforced here:
 *
 *   1. Only a query from the allowlist (./queries.ts) is sent, by name. Its text is checked again
 *      before sending: a `mutation` or `subscription` anywhere outside a string is refused.
 *   2. POST to the one endpoint, no redirects, a 30-second timeout.
 *   3. Pacing and budget: a small gap between requests; Linear's hourly request and complexity
 *      budgets are read from every answer's headers, and when either runs low the client waits for
 *      the reset or, when that is too far off, stops.
 *   4. A 429 (or Linear's RATELIMITED error) waits for the reset its headers give, or backs off
 *      2, 4, 8 seconds; four tries at most.
 *   5. Every request is counted into the activity log: requests, bytes in and out, records.
 *      Never a body, a header, a variable or the key.
 *   6. The key appears in nothing this client throws or records.
 */

export const LINEAR_ENDPOINT = 'https://api.linear.app/graphql';

export interface LinearResponse { status: number; headers: Headers; text(): Promise<string> }
export interface LinearTransport {
  readonly kind: 'https' | 'fixture' | 'scripted';
  post(body: string, headers: Record<string, string>): Promise<LinearResponse>;
}

export function httpsTransport(fetchImpl: typeof fetch = fetch): LinearTransport {
  return {
    kind: 'https',
    // No identity of ours beyond the key itself: no User-Agent naming us (docs/agent-rules/real-data.md).
    post: (body, headers) => fetchImpl(LINEAR_ENDPOINT, { method: 'POST', headers, body, redirect: 'error', signal: AbortSignal.timeout(30_000) }),
  };
}

export class LinearRefused extends Error {
  constructor(message: string) { super(message); this.name = 'LinearRefused'; }
}
export class LinearError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'LinearError'; }
}

/** Remove string literals and comments, so a word inside a title filter cannot hide or fake an operation. */
function skeleton(text: string): string {
  return text.replace(/"""[\s\S]*?"""/g, '""').replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/#[^\n]*/g, '');
}

/** Throws unless the text is a read: a query operation and nothing else. */
export function assertReadOnly(text: string): void {
  const s = skeleton(text);
  if (/\b(mutation|subscription)\b/i.test(s)) throw new LinearRefused('Linear: only queries are sent; a mutation or subscription was refused');
  if (!/^\s*(query\b|\{)/.test(s)) throw new LinearRefused('Linear: not a query operation; refused');
}

export interface LinearLimits {
  minIntervalMs: number; minRequestsLeft: number; minComplexityLeft: number; maxWaitMs: number;
}

export interface LinearBudget {
  requestsLimit: number | null; requestsLeft: number | null; complexityLimit: number | null; complexityLeft: number | null;
  /** When the hourly window resets (epoch ms), as Linear says. */
  resetAt: number | null;
}

export interface LinearStats { requests: number; bytesIn: number; bytesOut: number; records: number; waits: number; retries: number }

export interface LinearClientOptions {
  transport: LinearTransport;
  teams?: readonly string[];
  /** IDs already proved referenced by the filtered local replica. */
  referencedUserIds?: readonly string[];
  key: string;
  limits: LinearLimits;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Counts-only activity context; an explicit root is for invented fixtures. */
  activityRoot?: string;
  runId?: string;
}

export interface LinearPage<T> { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }

const MAX_TRIES = 4;
/** A runaway guard, far above the workspace's size (13 pages of issues on 27 Sep). */
export const MAX_PAGES = 2_000;

const num = (h: Headers, k: string): number | null => {
  const v = h.get(k);
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function linearClient(opts: LinearClientOptions) {
  const teams = [...new Set(opts.teams ?? config.linear.teams)];
  if (teams.some((key) => !/^[A-Za-z0-9_-]+$/.test(key))) throw new LinearRefused('Linear: invalid team allowlist');
  const referencedUsers = new Set(opts.referencedUserIds ?? []);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => Date.now());
  const redact = (s: string) => (opts.key ? s.split(opts.key).join('[key]') : s);
  const budget: LinearBudget = { requestsLimit: null, requestsLeft: null, complexityLimit: null, complexityLeft: null, resetAt: null };
  const stats: LinearStats = { requests: 0, bytesIn: 0, bytesOut: 0, records: 0, waits: 0, retries: 0 };
  let last = 0;

  const readHeaders = (h: Headers) => {
    budget.requestsLimit = num(h, 'x-ratelimit-requests-limit') ?? budget.requestsLimit;
    budget.requestsLeft = num(h, 'x-ratelimit-requests-remaining') ?? budget.requestsLeft;
    budget.complexityLimit = num(h, 'x-ratelimit-complexity-limit') ?? budget.complexityLimit;
    budget.complexityLeft = num(h, 'x-ratelimit-complexity-remaining') ?? budget.complexityLeft;
    const resets = [num(h, 'x-ratelimit-requests-reset'), num(h, 'x-ratelimit-complexity-reset')].filter((x): x is number => x !== null);
    if (resets.length) budget.resetAt = Math.max(...resets);
  };

  /** Wait until `until` (epoch ms), or stop when that is further off than the limit allows. */
  const waitUntil = async (until: number | null, fallbackMs: number, why: string) => {
    const ms = until !== null ? Math.max(1000, until - now()) : fallbackMs;
    if (ms > opts.limits.maxWaitMs) throw new LinearError(429, `Linear: ${why}; the budget resets in ${Math.ceil(ms / 60_000)} min. Stopped; sync again later.`);
    stats.waits++;
    await sleep(ms);
  };

  const pace = async () => {
    const low = (budget.requestsLeft !== null && budget.requestsLeft <= opts.limits.minRequestsLeft)
      || (budget.complexityLeft !== null && budget.complexityLeft <= opts.limits.minComplexityLeft);
    if (low) {
      await waitUntil(budget.resetAt, opts.limits.maxWaitMs + 1, 'little of the hourly budget is left');
      budget.requestsLeft = null; budget.complexityLeft = null;
    }
    const gap = last + opts.limits.minIntervalMs - now();
    if (gap > 0) await sleep(gap);
    last = now();
  };

  async function request<T>(name: QueryName, variables: Record<string, unknown> = {}, segment?: string | null): Promise<T> {
    const q = Object.hasOwn(QUERIES, name) ? QUERIES[name] : undefined;
    if (!q) throw new LinearRefused(`Linear: "${String(name).slice(0, 40)}" is not on the allowlist; refused`);
    assertReadOnly(q.text);
    // Caller variables cannot replace or broaden the configured scope.
    const scopedVariables = { ...variables, filter: variables.filter ?? {}, teamKeys: teams,
      ...(q.entity === 'users' ? { userIds: [...referencedUsers] } : {}) };
    const body = JSON.stringify({ operationName: name, query: q.text, variables: scopedVariables });
    const seg = segment ?? q.entity ?? 'authentication';
    for (let attempt = 1; ; attempt++) {
      await pace();
      const at = new Date(now()).toISOString();
      let bytesIn: number | null = null, records: number | null = null;
      stats.requests++;
      stats.bytesOut += Buffer.byteLength(body, 'utf8');
      try {
        let res: LinearResponse;
        try {
          res = await opts.transport.post(body, { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: opts.key });
        } catch (err) {
          const why = err instanceof Error ? `${err.name}: ${err.message}` : 'unknown';
          if (attempt < 3) { stats.retries++; await sleep(1000 * attempt); continue; }
          throw new LinearError(0, redact(`Could not reach Linear (${why})`));
        }
        readHeaders(res.headers);
        const text = await res.text();
        bytesIn = Buffer.byteLength(text, 'utf8');
        stats.bytesIn += bytesIn;
        let parsed: { data?: Record<string, unknown> | null; errors?: Array<{ message?: string; extensions?: { code?: string } }> } | null = null;
        try { parsed = JSON.parse(text); } catch { /* not JSON: judged by status below */ }
        const limited = res.status === 429 || parsed?.errors?.some((e) => e.extensions?.code === 'RATELIMITED');
        if (limited) {
          records = 0;
          if (attempt >= MAX_TRIES) throw new LinearError(429, `Linear kept answering rate-limited; gave up after ${MAX_TRIES} tries.`);
          stats.retries++;
          await waitUntil(budget.resetAt, 2 ** attempt * 1000, 'rate-limited');
          continue;
        }
        if (res.status < 200 || res.status >= 300 || !parsed || parsed.errors?.length || !parsed.data) {
          records = 0;
          const message = (parsed?.errors?.[0]?.message ?? '').slice(0, 200);
          throw new LinearError(res.status, redact(`Linear answered ${res.status} for ${name}${message ? `: ${message}` : ''}`));
        }
        const conn = q.root ? parsed.data[q.root] as { nodes?: Array<Record<string, unknown>> } | undefined : undefined;
        records = Array.isArray(conn?.nodes) ? conn.nodes.length : 0;
        stats.records += records;
        const refFields = q.entity === 'projects' ? ['lead'] : q.entity === 'issues' ? ['assignee', 'creator'] : q.entity === 'comments' ? ['user'] : [];
        for (const row of conn?.nodes ?? []) for (const field of refFields) {
          const id = (row[field] as { id?: unknown } | null)?.id;
          if (typeof id === 'string') referencedUsers.add(id);
        }
        return parsed.data as T;
      } finally {
        await recordActivity({ source: 'linear', at, segment: seg, runId: opts.runId, requests: 1, bytesIn,
          bytesOut: Buffer.byteLength(body, 'utf8'), records }, opts.activityRoot).catch(() => {});
      }
    }
  }

  /** Every page of an entity, oldest-created first, following Linear's cursors. */
  async function* pages<T>(name: QueryName, filter: Record<string, unknown> | null, pageSize: number): AsyncIterable<T[]> {
    const q = QUERIES[name];
    if (!q?.root) throw new LinearRefused(`Linear: ${String(name).slice(0, 40)} is not a paged query`);
    let after: string | null = null;
    for (let n = 0; ; n++) {
      if (n >= MAX_PAGES) throw new LinearRefused(`Linear: more than ${MAX_PAGES} pages of ${q.root}; stopping`);
      const data: Record<string, LinearPage<T>> = await request(name, { first: pageSize, after, filter });
      const page: LinearPage<T> | undefined = data[q.root];
      if (!page || !Array.isArray(page.nodes)) throw new LinearError(200, `Linear answered ${name} without ${q.root}`);
      yield page.nodes;
      if (!page.pageInfo?.hasNextPage) return;
      if (!page.pageInfo.endCursor || page.pageInfo.endCursor === after) throw new LinearError(200, `Linear gave ${name} a next page without a new cursor`);
      after = page.pageInfo.endCursor;
    }
  }

  return { teams: () => [...teams], transportKind: opts.transport.kind, request, pages, budget: () => ({ ...budget }), stats: () => ({ ...stats }) };
}

export type LinearClient = ReturnType<typeof linearClient>;
