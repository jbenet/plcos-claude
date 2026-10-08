import { createHash } from 'node:crypto';
import { config } from '@/config/deployment';
import { checkAddress, fetchIcs, IcsError, maskAddress, type IcsFetch } from '@/lib/connectors/ics/fetch';
import { parseIcs } from '@/lib/connectors/ics/parse';
import type { Mark } from '@/lib/timeline';

/**
 * The Calendar page's Travel and Events lanes (issue 0021; Juan, 8 Oct 2026: "1 - yes" to reading the team's
 * calendars, read only). Each person pastes their calendars' private addresses in Preferences → Calendars, and
 * says which lane each feeds. The server reads them when the page is opened (at most hourly per address) and
 * keeps nothing but that hour's copy in memory: the lanes are projected, like the rest of the calendar.
 *
 * The addresses are kept like the mailguard key: encrypted per person (platform.person_secret, purpose
 * `calendar-ics`), read by the server to fetch, shown to their owner only masked, and never logged.
 */

export type FeedLane = 'travel' | 'events';
export const FEED_LANES: FeedLane[] = ['travel', 'events'];
export const PURPOSE = 'calendar-ics';
/** GUESS: a person keeps a few calendars, not dozens. */
export const MAX_FEEDS = 10;

export interface Feed { lane: FeedLane; address: string; addedAt: string }

const parse = (s: string | null): Feed[] => {
  if (!s) return [];
  try {
    const v = JSON.parse(s) as unknown;
    return Array.isArray(v) ? v.filter((f): f is Feed => !!f && FEED_LANES.includes((f as Feed).lane) && typeof (f as Feed).address === 'string') : [];
  } catch { return []; }
};

async function readFeeds(userId: string): Promise<Feed[]> {
  const { personSecret } = await import('@/lib/settings/person-secrets');
  return parse(await personSecret(userId, PURPOSE));
}

async function writeFeeds(userId: string, feeds: Feed[]): Promise<void> {
  const { setPersonSecret, clearPersonSecret } = await import('@/lib/settings/person-secrets');
  if (feeds.length) await setPersonSecret(userId, PURPOSE, JSON.stringify(feeds));
  else await clearPersonSecret(userId, PURPOSE);
}

export class FeedRefused extends Error {
  constructor(message: string) { super(message); this.name = 'FeedRefused'; }
}

/** Your own addresses, masked, with what the last read of each found. */
export async function myFeeds(userId: string): Promise<Array<{ lane: FeedLane; masked: string; addedAt: string; last: { at: string; events: number } | { at: string; error: string } | null }>> {
  return (await readFeeds(userId)).map((f) => {
    const hit = cache.get(keyOf(f.address));
    return { lane: f.lane, masked: maskAddress(f.address), addedAt: f.addedAt, last: hit ? ('error' in hit ? { at: new Date(hit.at).toISOString(), error: hit.error } : { at: new Date(hit.at).toISOString(), events: hit.events }) : null };
  });
}

export async function addFeed(userId: string, lane: FeedLane, raw: string): Promise<void> {
  if (!FEED_LANES.includes(lane)) throw new FeedRefused('Choose Travel or Events.');
  const c = checkAddress(raw);
  if ('why' in c) throw new FeedRefused(c.why);
  const feeds = await readFeeds(userId);
  const address = c.url.toString();
  if (feeds.some((f) => f.address === address)) throw new FeedRefused('That calendar is already here.');
  if (feeds.length >= MAX_FEEDS) throw new FeedRefused(`Keep at most ${MAX_FEEDS} calendars; remove one first.`);
  await writeFeeds(userId, [...feeds, { lane, address, addedAt: new Date().toISOString() }]);
}

export async function removeFeed(userId: string, index: number): Promise<void> {
  const feeds = await readFeeds(userId);
  if (!Number.isInteger(index) || index < 0 || index >= feeds.length) throw new FeedRefused('No such calendar.');
  const gone = feeds[index]!;
  cache.delete(keyOf(gone.address));
  await writeFeeds(userId, feeds.filter((_, i) => i !== index));
}

/** GUESS: an hour, as asked ("polling hourly is plenty"); a changed trip shows within it. */
const FRESH_MS = 3600_000;
const keyOf = (address: string) => createHash('sha256').update(address).digest('hex').slice(0, 20);
type Cached = { at: number; text: string; events: number } | { at: number; error: string };
const g = globalThis as typeof globalThis & { __plcosIcsCache?: Map<string, Cached> };
const cache = (g.__plcosIcsCache ??= new Map());

export interface FeedProblem { person: string; lane: FeedLane; why: string }

/**
 * The Travel and Events marks for a window, from every person's addresses: one per occurrence, with everyone
 * whose calendar holds it (a conference two of us attend is one mark). Problems are said per person, in words.
 */
export async function feedMarks(now: Date, window: { from: Date; to: Date }, o: { transport?: IcsFetch; users?: Array<{ id: string; name: string }> } = {}): Promise<{ marks: Mark[]; problems: FeedProblem[]; feeds: number }> {
  const users = o.users ?? (await (await import('@/modules/platform')).listUsers()).map((u) => ({ id: u.id, name: u.name }));
  const perUser = await Promise.all(users.map(async (u) => ({ u, feeds: await readFeeds(u.id) })));
  const feeds = perUser.reduce((n, x) => n + x.feeds.length, 0);
  const problems: FeedProblem[] = [];
  if (!feeds) return { marks: [], problems, feeds };
  const off = !o.transport && (config.data.profile === 'demo' || config.data.copyTakenAt)
    ? (config.data.profile === 'demo' ? 'The demo does not read calendar addresses.' : 'A preview does not read calendar addresses.') : null;

  const day = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const byKey = new Map<string, Mark>();
  await Promise.all(perUser.flatMap(({ u, feeds }) => feeds.map(async (f) => {
    if (off) { problems.push({ person: u.name, lane: f.lane, why: off }); return; }
    const k = keyOf(f.address);
    let hit = cache.get(k);
    if (!hit || Date.now() - hit.at > FRESH_MS || (o.transport && 'error' in hit)) {
      try {
        const text = await fetchIcs(f.address, o.transport);
        hit = { at: Date.now(), text, events: 0 };
      } catch (e) {
        if (!(e instanceof IcsError)) throw e;
        // A failed read keeps the last good copy for a day, and says it is stale.
        const prev = cache.get(k);
        if (prev && 'text' in prev && Date.now() - prev.at < 24 * FRESH_MS) problems.push({ person: u.name, lane: f.lane, why: `${e.message} Showing the copy read ${new Date(prev.at).toISOString().slice(11, 16)} UTC.` });
        else { cache.set(k, { at: Date.now(), error: e.message }); problems.push({ person: u.name, lane: f.lane, why: e.message }); return; }
        hit = prev;
      }
    }
    if ('error' in hit) { problems.push({ person: u.name, lane: f.lane, why: hit.error }); return; }
    const events = parseIcs(hit.text, window).filter((e) => !e.cancelled);
    cache.set(k, { ...hit, events: events.length });
    for (const e of events) {
      const id = `${f.lane}:${createHash('sha256').update(`${e.uid}|${e.start.toISOString()}`).digest('hex').slice(0, 16)}`;
      const seen = byKey.get(id);
      if (seen) { seen.team = [...new Set([...(seen.team ?? []), u.name])].sort(); continue; }
      // An all-day event ends at the next midnight: its last day is the one before.
      const last = new Date(Math.max(e.start.getTime(), e.end.getTime() - (e.allDay ? 1 : 0)));
      byKey.set(id, {
        id: `ics:${id}`, lane: f.lane, kind: day(last).getTime() > day(e.start).getTime() ? 'span' : 'point',
        label: e.title, team: [u.name], lp: null,
        detail: [e.location, e.allDay ? null : `${e.start.toISOString().slice(11, 16)} UTC`, e.unexpanded ? 'repeats; only the first is shown' : null].filter(Boolean).join(' · '),
        from: day(e.start), to: day(last), vehicleName: null, alert: false, past: last.getTime() < now.getTime(), href: null,
      });
    }
  })));
  return { marks: [...byKey.values()], problems: problems.sort((a, b) => a.person.localeCompare(b.person)), feeds };
}

/** For the properties: forget every copy. */
export const forgetFeedCache = () => cache.clear();
