/**
 * Dakota Marketplace, read-only (docs/20-dakota.md). The API can create, update and delete, and
 * our sign-in could do all of that, so read-only is enforced here: two paths only, a body shape
 * that can only list or count, and nothing else leaves this file. Juan, 27 Sep 2026: read only,
 * in bulk to keep the query count down, within Dakota's limits, from workflows only; Dakota's
 * data stays in plcos-data/real and our database and goes nowhere else.
 */
import { recordActivity } from '@/lib/activity/log';

const BASE = 'https://marketplace-as-a-service.herokuapp.com/index.php/api';
/** Dakota documents no rate limit. One request a second is our own GUESS at polite. */
export const MIN_INTERVAL_MS = 1000;
/** Their docs recommend pages of 20–50 records. */
export const PAGE_SIZE = 50;

export type Filter = Record<string, unknown>;
export interface ListQuery { module: string; fields?: string[]; filter?: Filter[]; orderBy?: string; offset?: number; maxNum?: number }
export interface Page<T> { records: T[]; nextOffset: number }

const MODULE = /^[a-z_]{2,40}$/;
const FIELD = /^[A-Za-z0-9_.]{1,80}$/;
const OPS = new Set(['$equals', '$not_equals', '$contains', '$gt', '$gte', '$lt', '$lte', '$between', '$in', '$dateRange', '$or', '$and']);

/** Throws on anything that is not a plain read: the only guard between us and a write. */
export function readBody(q: ListQuery & { countOnly?: boolean }): string {
  const allowed = new Set(['module','fields','filter','orderBy','offset','maxNum','countOnly']);
  if (Object.keys(q).some(k => !allowed.has(k))) throw new Error('Dakota: non-read body refused');
  if (q.orderBy && !/^[A-Za-z0-9_.]+:(ASC|DESC)$/i.test(q.orderBy)) throw new Error('Dakota: invalid read order');
  if (!MODULE.test(q.module)) throw new Error(`Dakota: module "${q.module}" is not a plain module name`);
  for (const f of q.fields ?? []) if (!FIELD.test(f)) throw new Error(`Dakota: field "${f}" is not a plain field name`);
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
      if (k.startsWith('$') && !OPS.has(k)) throw new Error(`Dakota: operator ${k} is not a read filter`);
      if (!k.startsWith('$') && !FIELD.test(k)) throw new Error(`Dakota: filter key "${k}" is not a field name`);
      walk(x);
    }
  };
  walk(q.filter ?? []);
  if (q.countOnly) return JSON.stringify({ module: q.module, count_only: '1', ...(q.filter ? { filters: { filter: q.filter } } : {}) });
  const maxNum = Math.min(Math.max(1, q.maxNum ?? PAGE_SIZE), PAGE_SIZE);
  return JSON.stringify({ module: q.module, filters: {
    ...(q.fields ? { fields: q.fields } : {}), ...(q.filter ? { filter: q.filter } : {}),
    order_by: q.orderBy ?? 'sfid:ASC', max_num: maxNum, offset: Math.max(0, q.offset ?? 0),
  } });
}

export class DakotaClient {
  private token: string | null = null;
  private expires = 0;
  private last = 0;
  requests = 0;
  constructor(private readonly username: string, private readonly password: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly activity: { runId?: string; root?: string } = {}) {}

  private async pace() {
    const wait = this.last + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last = Date.now();
  }

  private async exchange(path: 'oauth2' | 'dakota', body: string, headers: Record<string, string>, module: string) {
    await this.pace();
    this.requests++;
    const at = new Date().toISOString();
    let bytesIn: number | null = null, records: number | null = null;
    // The caller can supply arbitrary module strings, so never put those in telemetry.
    const segment = path === 'oauth2' ? 'authentication' : ['account', 'contact', 'investment', 'investment_strategy'].includes(module) ? module : 'other';
    try {
      // No identity of ours in the request: no User-Agent naming us (docs/agent-rules/real-data.md).
      const res = await this.fetcher(`${BASE}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers }, body });
      let text: string;
      try { text = await res.text(); }
      catch (error) {
        if (res.ok) throw error;
        return { status: res.status, ok: false, payload: null };
      }
      bytesIn = Buffer.byteLength(text, 'utf8');
      if (!res.ok) { records = 0; return { status: res.status, ok: false, payload: null }; }
      const payload: unknown = JSON.parse(text);
      const rows = (payload as { records?: unknown } | null)?.records;
      records = Array.isArray(rows) ? rows.length : 0;
      return { status: res.status, ok: true, payload };
    } finally {
      // Decoded application payload bytes, excluding headers. Never log the body or credentials.
      await recordActivity({ source: 'dakota', at, segment, runId: this.activity.runId,
        requests: 1, bytesIn, bytesOut: Buffer.byteLength(body, 'utf8'), records }, this.activity.root).catch(() => {});
    }
  }

  private async post(path: 'oauth2' | 'dakota', body: string, headers: Record<string, string> = {}, module = 'auth'): Promise<unknown> {
    const res = await this.exchange(path, body, headers, module);
    if (res.status === 429 || res.status >= 500) throw new Error(`Dakota answered ${res.status}: stop and come back later`);
    if (!res.ok) throw new Error(`Dakota answered ${res.status} on ${path}`);
    return res.payload;
  }

  private async auth(): Promise<string> {
    if (this.token && Date.now() < this.expires - 60_000) return this.token;
    const r = await this.post('oauth2', JSON.stringify({ username: this.username, password: this.password, grant_type: 'password' })) as { access_token?: string; expires_in?: number };
    if (!r.access_token) throw new Error('Dakota sign-in returned no token');
    this.token = r.access_token; this.expires = Date.now() + (r.expires_in ?? 3600) * 1000;
    return this.token;
  }

  async count(module: string, filter?: Filter[]): Promise<number> {
    const r = await this.post('dakota', readBody({ module, filter, countOnly: true }), { 'Oauth-Token': await this.auth() }, module) as { record_count?: number | string };
    return Number(r.record_count ?? NaN);
  }

  /** A small read that reports its status instead of throwing: for finding a query shape Dakota accepts. */
  async probe(q: ListQuery): Promise<{ status: number; records: number; keys: number }> {
    const body = readBody({ ...q, maxNum: Math.min(q.maxNum ?? 2, 2) });
    const res = await this.exchange('dakota', body, { 'Oauth-Token': await this.auth() }, q.module);
    if (res.status === 429) throw new Error('Dakota answered 429: stop and come back later');
    if (!res.ok) return { status: res.status, records: 0, keys: 0 };
    const r = res.payload as { records?: Record<string, unknown>[] };
    return { status: res.status, records: r.records?.length ?? 0, keys: Object.keys(r.records?.[0] ?? {}).length };
  }

  async page<T = Record<string, unknown>>(q: ListQuery): Promise<Page<T>> {
    const r = await this.post('dakota', readBody(q), { 'Oauth-Token': await this.auth() }, q.module) as { records?: T[]; next_offset?: number };
    return { records: r.records ?? [], nextOffset: Number(r.next_offset ?? -1) };
  }
}
