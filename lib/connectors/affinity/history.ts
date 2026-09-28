import { config } from '@/config/deployment';
import { finishRun, landRaw, latestRun, progressRun, startRun, type SyncRun } from '@/modules/sources';
import { affinity } from './index';
import { AffinityRefused, httpsTransport, type Query } from './client';
import { fixtureTransport } from './fixture';
import { AFFINITY_ORIGIN } from './fetch';

/** Bulk history is independent of list membership. API permissions still bound visibility.
 * July-15 official endpoint index: https://developer.affinity.co/llms.txt .
 * Only meetings' change filters are verified by the existing connector. Other collections
 * deliberately sweep until their change-filter contract is verified. Never filter sentAt.
 */
const STREAMS = [
  { path: '/v2/persons', kind: 'person', delta: false },
  { path: '/v2/meetings', kind: 'meeting', delta: true },
  { path: '/v2/emails', kind: 'email', delta: false },
  { path: '/v2/calls', kind: 'call', delta: false },
  { path: '/v2/chat-messages', kind: 'chat-message', delta: false },
] as const;
const SOURCE = 'affinity';
const KIND = 'history';
export const HISTORY_CAP = 99;
export const HISTORY_CAP_REST = 1000;
interface Step { path: string; kind: string; query: Query }
export interface HistoryRunDetail extends Record<string, unknown> {
  mode: 'full' | 'since';
  began: string;
  since: string | null;
  through?: string;
  cap: number;
  stoppedAtCap?: boolean;
  truncated: number;
  /** Exact next unread page, with original filter/query and stream phase. */
  resume?: { steps: Step[]; phase: number; next: string; query: Query; visited?: string[] } | null;
}
type Item = { id: number; createdAt?: string | null; updatedAt?: string | null; [key: string]: unknown };
export interface HistoryOptions {
  cap?: number; rest?: boolean; full?: boolean;
  overrides?: Parameters<typeof affinity>[0];
}

/** Keep includes/filter/limit even when the server's cursor URL omits them. */
function nextPage(next: string, query: Query): string {
  const url = new URL(next, AFFINITY_ORIGIN);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || url.searchParams.has(key)) continue;
    for (const v of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(v));
  }
  return url.toString();
}

export async function readHistory(runBy: string | null, opts: HistoryOptions = {}): Promise<SyncRun | null> {
  const cap = Math.min(opts.cap ?? (opts.rest ? HISTORY_CAP_REST : HISTORY_CAP), opts.rest ? HISTORY_CAP_REST : HISTORY_CAP);
  if (!Number.isSafeInteger(cap) || cap < 1) throw new Error('History cap must be a positive integer.');
  const previous = await latestRun(SOURCE, KIND);
  const complete = await latestRun(SOURCE, KIND, 'ok');
  const last = complete?.detail.through;
  const since = !opts.full && typeof last === 'string' ? new Date(new Date(last).getTime() - 86_400_000).toISOString() : null;
  const prior = previous?.detail as HistoryRunDetail | undefined;
  const resume = !opts.full && (previous?.status === 'failed' || previous?.status === 'running') ? prior?.resume : null;
  const steps: Step[] = resume?.steps ?? STREAMS.flatMap(s => (since && s.delta
    ? [`createdAt>=${since}`, `updatedAt>=${since}`] : [undefined]).map(filter => ({
      path: s.path, kind: s.kind, query: { limit: 100, ...(s.kind === 'person' ? { fieldTypes: ['global'] } : {}), ...(filter ? { filter } : {}) },
    })));
  let phase = resume?.phase ?? 0;
  let next = resume?.next ?? steps[phase]!.path;
  let query = resume?.query ?? steps[phase]!.query;
  const visited = new Set(resume?.visited ?? []);
  const detail: HistoryRunDetail = {
    mode: resume ? prior!.mode : since ? 'since' : 'full',
    began: resume ? prior!.began : new Date().toISOString(),
    since: resume ? prior!.since : since, cap, truncated: resume ? prior!.truncated : 0,
  };
  const run = await startRun(SOURCE, KIND, runBy);
  let requests = 0, records = 0, fresh = 0;
  const finish = async (status: 'ok' | 'failed', note: string) => {
    detail.resume = status === 'ok' ? null : { steps, phase, next, query, visited: [...visited] };
    await finishRun(run, { status, requests, records, newRecords: fresh, note, detail });
    return latestRun(SOURCE, KIND);
  };
  const checkpoint = async () => {
    detail.resume = { steps, phase, next, query, visited: [...visited] };
    await progressRun(run, { requests, records, newRecords: fresh,
      note: `${records} history records read; ${phase} of ${steps.length} streams complete`, detail });
  };
  try {
    // A process exit cannot erase the unread page or the original snapshot start. On a
    // crash while landing a page, the preceding checkpoint replays that page idempotently.
    await checkpoint();
    const transport = opts.overrides?.transport ?? (config.data.profile === 'real' ? httpsTransport() : fixtureTransport());
    const client = affinity({ ...opts.overrides, runId: String(run), transport: {
      kind: transport.kind,
      get: async (url, headers) => {
        // Count actual attempts, including 429/network retries, against the run cap.
        if (requests >= cap) throw new AffinityRefused('History request cap reached. Resume this read to continue.');
        requests++;
        return transport.get(url, headers);
      },
    } });
    while (phase < steps.length) {
      if (requests >= cap) {
        detail.stoppedAtCap = true;
        return finish('failed', `Stopped at ${cap} requests; resume continues the next unread page.`);
      }
      const pageUrl = nextPage(next, query);
      if (visited.has(pageUrl)) throw new Error('History pagination repeated a cursor; incomplete stream needs a fresh read.');
      if (visited.size >= 10_000) throw new Error('History stream exceeded 10000 pages; stopped within the connector read limit.');
      const page = await client.get<{ data?: Item[]; pagination?: { nextUrl?: string | null } }>(next, query);
      if (!Array.isArray(page.data)) throw new Error('History response is missing its data array; cursor was not advanced.');
      for (const item of page.data) {
        if (!Number.isSafeInteger(item.id)) throw new Error('History response has an invalid record id; cursor was not advanced.');
        records++;
        for (const value of Object.values(item)) {
          const p = value as { data?: unknown[]; totalCount?: number } | null;
          if (p && Array.isArray(p.data) && typeof p.totalCount === 'number' && p.totalCount > p.data.length) detail.truncated++;
        }
        const changed = item.updatedAt ?? item.createdAt;
        if (await landRaw({ source: SOURCE, kind: steps[phase]!.kind, sourceId: String(item.id),
          sourceUpdatedAt: changed ? new Date(changed) : null, payload: item })) fresh++;
      }
      visited.add(pageUrl);
      if (page.pagination?.nextUrl) {
        next = nextPage(page.pagination.nextUrl, steps[phase]!.query);
        query = {};
      } else {
        phase++;
        visited.clear();
        if (phase < steps.length) { next = steps[phase]!.path; query = steps[phase]!.query; }
      }
      await checkpoint();
    }
    detail.through = detail.began;
    return finish('ok', `${records} history records read in ${requests} requests; ${detail.truncated} truncated participant previews remain outside the bulk API's coverage.`);
  } catch (err) {
    if (requests >= cap) detail.stoppedAtCap = true;
    return finish('failed', err instanceof Error ? err.message : 'History read failed; resume retries the unread page.');
  }
}
