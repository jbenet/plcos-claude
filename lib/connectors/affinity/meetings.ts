import { getDb } from '@/lib/db';
import { finishRun, landRaw, latestRaw, latestRun, progressRun, startRun, type SyncRun } from '@/modules/sources';
import { AffinityRefused, type Query } from './client';
import { affinity } from './index';

/**
 * Every meeting on the team's calendars, from Affinity's calendar sync (N54). Juan, 23 Sep: "if
 * you can do it in bulk in less than 100 requests, sure give it a shot."
 *
 * `GET /v2/meetings` pages through every meeting a hundred at a time, each with its title, start
 * and end, and up to a hundred attendees with their Affinity ids — which is what gives an LP a
 * dated first meeting, a second, and the next one, instead of the one "last event" a list entry
 * carries. Unlike the notes, it has no count: the size is known only by reading. So a read has a
 * hard cap on requests, stops there, and says it stopped; and the first one starts at WINDOW,
 * because a capped read that began in 2016 would spend its cap on the oldest meetings.
 *
 * After a complete read, the next asks only for meetings created or updated since, less a day.
 * Nothing here translates anything; translation turns meetings with someone in the tool among
 * the attendees into touchpoints, keyed by the meeting, so a meeting also named by a list
 * entry's "Next Event" or by a note is still one touchpoint.
 */

export interface MeetingAttendee {
  emailAddress: string | null;
  person: { id: number; firstName: string | null; lastName: string | null; primaryEmailAddress: string | null; type: 'internal' | 'collaborator' | 'external' } | null;
}

export interface AffinityMeeting {
  id: number;
  loggingType?: 'automated' | 'manual';
  title: string | null;
  startTime: string;
  endTime: string | null;
  allDay?: boolean;
  organizer?: MeetingAttendee | null;
  createdAt: string;
  updatedAt: string | null;
  attendeesPreview?: { data: MeetingAttendee[]; totalCount: number };
}

const SOURCE = 'affinity';
const KIND = 'meetings';
const PAGE = 100;
/** Where the first read starts: the raise's working years. A GUESS at the useful window. */
export const WINDOW = '2024-01-01T00:00:00Z';
/** Juan's bound, 23 Sep: under a hundred requests. */
export const MEETINGS_CAP = 99;
/**
 * The rest of the calendar, when asked for (N59). Juan, 23 Sep, after the first read stopped at
 * the cap with 9,900 meetings: "you can sync the remaining meetings too from affinity". A GUESS at
 * enough: a hundred meetings a request, so up to 100,000 meetings, well inside the account's
 * monthly limit.
 */
export const MEETINGS_CAP_REST = 1000;
const MARGIN_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');

export interface MeetingsRunDetail {
  mode?: 'window' | 'since';
  window?: string;
  since?: string | null;
  through?: string;
  cap?: number;
  stoppedAtCap?: boolean;
  /** Where a read that stopped at the cap would go next: the page it did not read. */
  resume?: string | null;
  withAttendees?: number;
  ahead?: number;
  truncatedAttendees?: number;
}

export async function readMeetings(runBy: string | null, opts: { cap?: number; full?: boolean; rest?: boolean; overrides?: Parameters<typeof affinity>[0] } = {}): Promise<SyncRun | null> {
  const most = opts.rest ? MEETINGS_CAP_REST : MEETINGS_CAP;
  const cap = Math.min(opts.cap ?? most, most);
  const prior = await latestRun(SOURCE, KIND, 'ok');
  const priorThrough = (prior?.detail as MeetingsRunDetail | undefined)?.through;
  const since = !opts.full && priorThrough ? new Date(new Date(priorThrough).getTime() - MARGIN_MS) : null;
  const began = new Date();
  const run = await startRun(SOURCE, KIND, runBy);
  let requests = 0;
  let records = 0;
  let fresh = 0;
  let withAttendees = 0;
  let ahead = 0;
  let truncatedAttendees = 0;
  const seen = new Set<number>();
  const detail: MeetingsRunDetail & Record<string, unknown> = {
    mode: since ? 'since' : 'window', window: WINDOW, since: since ? iso(since) : null, cap,
  };
  const finish = (status: 'ok' | 'failed', note: string, extra: Partial<MeetingsRunDetail> = {}) =>
    finishRun(run, { status, requests, records, newRecords: fresh, note, detail: { ...detail, ...extra, withAttendees, ahead, truncatedAttendees } });

  try {
    const client = affinity(opts.overrides);
    const filters = since ? [`createdAt>=${iso(since)}`, `updatedAt>=${iso(since)}`] : [`startTime>=${WINDOW}`];
    for (const filter of filters) {
      let next: string | null = '/v2/meetings';
      let query: Query | undefined = { limit: PAGE, filter };
      while (next) {
        if (requests >= cap) {
          await finish('failed', `Stopped at the cap of ${cap} requests with ${records} meetings read; there are more. Nothing read is lost.`, { stoppedAtCap: true, resume: next });
          return latestRun(SOURCE, KIND);
        }
        const page: { data?: AffinityMeeting[]; pagination?: { nextUrl?: string | null } } = await client.get(next, query);
        requests++;
        for (const m of page.data ?? []) {
          if (seen.has(m.id)) continue;
          seen.add(m.id);
          records++;
          if (m.attendeesPreview?.data?.some((a) => a.person?.type === 'external')) withAttendees++;
          if (new Date(m.startTime).getTime() > Date.now()) ahead++;
          if (m.attendeesPreview && m.attendeesPreview.totalCount > m.attendeesPreview.data.length) truncatedAttendees++;
          if (await landRaw({ source: SOURCE, kind: 'meeting', sourceId: String(m.id), sourceUpdatedAt: new Date(m.updatedAt ?? m.createdAt), payload: m })) fresh++;
        }
        await progressRun(run, { requests, records, newRecords: fresh, note: `${records} meetings so far` });
        next = page.pagination?.nextUrl ?? null;
        query = undefined;
      }
    }
    detail.through = iso(began);
    await finish('ok', `${records} meetings read in ${requests} requests · ${fresh} new or changed · ${ahead} still ahead`);
  } catch (err) {
    await finish('failed', err instanceof AffinityRefused ? `Refused: ${err.message}` : err instanceof Error ? err.message : 'unknown error');
  }
  return latestRun(SOURCE, KIND);
}

type G = typeof globalThis & { __affinityMeetings?: Promise<unknown> | null };
const g = globalThis as G;

export function startMeetings(runBy: string | null, opts: { full?: boolean; rest?: boolean } = {}): 'started' | 'already running' {
  if (g.__affinityMeetings) return 'already running';
  g.__affinityMeetings = readMeetings(runBy, opts).finally(() => {
    g.__affinityMeetings = null;
  });
  return 'started';
}

export const meetingsRunning = () => Boolean(g.__affinityMeetings);

/** Counts only: how many, when, how many with someone outside the team, how many ahead. */
export async function meetingsInventory(): Promise<null | {
  total: number; byYear: Array<{ year: string; n: number }>; first: string | null; last: string | null;
  external: number; ahead: number; manual: number; truncated: number;
}> {
  const rows = await latestRaw<AffinityMeeting>(SOURCE, 'meeting');
  if (!rows.length) return null;
  const byYear = new Map<string, number>();
  let first: string | null = null;
  let last: string | null = null;
  let external = 0;
  let ahead = 0;
  let manual = 0;
  let truncated = 0;
  const now = Date.now();
  for (const { payload: m } of rows) {
    const y = m.startTime.slice(0, 4);
    byYear.set(y, (byYear.get(y) ?? 0) + 1);
    if (!first || m.startTime < first) first = m.startTime;
    if (!last || m.startTime > last) last = m.startTime;
    if (m.attendeesPreview?.data?.some((a) => a.person?.type === 'external')) external++;
    if (new Date(m.startTime).getTime() > now) ahead++;
    if (m.loggingType === 'manual') manual++;
    if (m.attendeesPreview && m.attendeesPreview.totalCount > m.attendeesPreview.data.length) truncated++;
  }
  return {
    total: rows.length, byYear: [...byYear.entries()].sort().map(([year, n]) => ({ year, n })), first, last,
    external, ahead, manual, truncated,
  };
}

/** The titles of these meetings, as landed — read when a page shows a touchpoint, never copied. */
export async function meetingTitles(ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const db = await getDb();
  const rows = await db.query<{ source_id: string; title: string | null }>(
    `select distinct on (source_id) source_id, payload->>'title' as title from sources.raw_record
      where source = 'affinity' and kind = 'meeting' and source_id = any($1::text[])
      order by source_id, fetched_at desc, id desc`,
    [ids],
  );
  return new Map(rows.filter((r) => r.title).map((r) => [r.source_id, r.title!]));
}

