import { createHash } from 'node:crypto';
import { config } from '@/config/deployment';
import { checkAddress, fetchIcs, IcsError, maskAddress, type IcsFetch } from '@/lib/connectors/ics/fetch';
import { parseIcs } from '@/lib/connectors/ics/parse';
import { CALENDAR_LABELS, classify, GOOGLE_COLOURS, lastDay, NO_COLOURS, spansDays, SORTED_BY, type CalendarLabel, type ClassifiableEntry, type ColourPicks } from '@/lib/calendar-classify';
import type { Mark } from '@/lib/timeline';

/**
 * The Calendar page's Travel and Events lanes (issue 0021; Juan, 8 Oct 2026: "1 - yes" to reading the team's
 * calendars, read only; 10 Oct 2026: sort each entry by what it is). People keep trips and conferences as entries
 * in one calendar, usually their main one, so the server reads every calendar each person's mailguard key can read
 * (the same GET-only reads as docs/25 §13) and sorts each entry with lib/calendar-classify.ts: Travel, Event, or a
 * meeting, which is not shown here. A pasted private (iCal) address is an extra source, such as TripIt, and goes
 * through the same sorting. The server reads when the page is opened, at most hourly per person or address, and
 * keeps nothing but that hour's copy in memory: the lanes are projected, like the rest of the calendar.
 *
 * Kept per person: pasted addresses, encrypted like the mailguard key (platform.person_secret, purpose
 * `calendar-ics`, shown to their owner only masked, never logged), and the person's colour picks (purpose
 * `calendar-colours`). A relabel clicked on the Calendar page is a research.note of kind `calendar_label`
 * holding only a hash of the entry's iCal UID and the label: no title, no place. The latest relabel wins.
 */

export type FeedLane = 'travel' | 'events';
export const FEED_LANES: FeedLane[] = ['travel', 'events'];
export const PURPOSE = 'calendar-ics';
export const COLOURS_PURPOSE = 'calendar-colours';
/** GUESS: a person keeps a few calendars, not dozens. */
export const MAX_FEEDS = 10;

/** A pasted address. `lane` is from before entries were sorted (10 Oct 2026) and is no longer read. */
export interface Feed { address: string; addedAt: string; lane?: FeedLane }

const parse = (s: string | null): Feed[] => {
  if (!s) return [];
  try {
    const v = JSON.parse(s) as unknown;
    return Array.isArray(v) ? v.filter((f): f is Feed => !!f && typeof (f as Feed).address === 'string') : [];
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
export async function myFeeds(userId: string): Promise<Array<{ masked: string; addedAt: string; last: { at: string; events: number } | { at: string; error: string } | null }>> {
  return (await readFeeds(userId)).map((f) => {
    const hit = cache.get(keyOf(f.address));
    return { masked: maskAddress(f.address), addedAt: f.addedAt, last: hit ? ('error' in hit ? { at: new Date(hit.at).toISOString(), error: hit.error } : { at: new Date(hit.at).toISOString(), events: hit.events }) : null };
  });
}

export async function addFeed(userId: string, raw: string): Promise<void> {
  const c = checkAddress(raw);
  if ('why' in c) throw new FeedRefused(c.why);
  const feeds = await readFeeds(userId);
  const address = c.url.toString();
  if (feeds.some((f) => f.address === address)) throw new FeedRefused('That calendar is already here.');
  if (feeds.length >= MAX_FEEDS) throw new FeedRefused(`Keep at most ${MAX_FEEDS} calendars; remove one first.`);
  await writeFeeds(userId, [...feeds, { address, addedAt: new Date().toISOString() }]);
}

export async function removeFeed(userId: string, index: number): Promise<void> {
  const feeds = await readFeeds(userId);
  if (!Number.isInteger(index) || index < 0 || index >= feeds.length) throw new FeedRefused('No such calendar.');
  const gone = feeds[index]!;
  cache.delete(keyOf(gone.address));
  await writeFeeds(userId, feeds.filter((_, i) => i !== index));
}

/* ---- Overrides: a person's colours, and relabels clicked on the Calendar page ---- */

const COLOUR_IDS = new Set(GOOGLE_COLOURS.map((c) => c.id));

export async function myColours(userId: string): Promise<ColourPicks> {
  const { personSecret } = await import('@/lib/settings/person-secrets');
  try {
    const v = JSON.parse((await personSecret(userId, COLOURS_PURPOSE)) ?? 'null') as Partial<ColourPicks> | null;
    return { travel: v?.travel && COLOUR_IDS.has(v.travel) ? v.travel : null, events: v?.events && COLOUR_IDS.has(v.events) ? v.events : null };
  } catch { return NO_COLOURS; }
}

/** Pick one Google event colour for Travel and one for Events, or none. The two must differ. */
export async function setColours(userId: string, picks: { travel: string | null; events: string | null }): Promise<void> {
  const clean = (v: string | null) => (v && v !== 'none' ? v : null);
  const travel = clean(picks.travel), events = clean(picks.events);
  for (const v of [travel, events]) if (v && !COLOUR_IDS.has(v)) throw new FeedRefused('Pick one of Google Calendar’s colours.');
  if (travel && travel === events) throw new FeedRefused('Pick different colours for Travel and Events.');
  const { setPersonSecret, clearPersonSecret } = await import('@/lib/settings/person-secrets');
  if (travel || events) await setPersonSecret(userId, COLOURS_PURPOSE, JSON.stringify({ travel, events }));
  else await clearPersonSecret(userId, COLOURS_PURPOSE);
}

/** An entry's relabel key: a hash of its iCal UID, so every occurrence of a repeating entry, in anyone's calendar, takes it. */
export const entryKey = (uid: string) => createHash('sha256').update(`calendar-entry|${uid}`).digest('hex').slice(0, 24);

export async function relabels(): Promise<Map<string, CalendarLabel>> {
  const { getDb } = await import('@/lib/db');
  const rows = await (await getDb()).query<{ k: string; l: string }>(
    `select distinct on (data->>'key') data->>'key' k, data->>'label' l from research.note
      where kind = 'calendar_label' and entity_id is null order by data->>'key', created_at desc, note_id desc`);
  return new Map(rows.filter((r) => (CALENDAR_LABELS as string[]).includes(r.l)).map((r) => [r.k, r.l as CalendarLabel]));
}

/** Remember what an entry is. Only a key and a label are kept; clicking again changes it. */
export async function relabelEntry(authorId: string, key: string, label: CalendarLabel): Promise<void> {
  if (!/^[0-9a-f]{24}$/.test(key)) throw new FeedRefused('That is not a calendar entry.');
  if (!CALENDAR_LABELS.includes(label)) throw new FeedRefused('Choose Travel, Event or Meeting.');
  const { getDb } = await import('@/lib/db');
  await (await getDb()).query(
    `insert into research.note (entity_id, author_id, kind, body, data, created_at) values (null, $1, 'calendar_label', $2, $3, clock_timestamp())`,
    [authorId, `Calendar entry relabelled: ${label}.`, JSON.stringify({ key, label })]);
}

/* ---- Reading ---- */

/** GUESS: an hour, as asked ("polling hourly is plenty"); a changed trip shows within it. */
const FRESH_MS = 3600_000;
const keyOf = (address: string) => createHash('sha256').update(address).digest('hex').slice(0, 20);
type Cached = { at: number; text: string; events: number } | { at: number; error: string };
const g = globalThis as typeof globalThis & { __plcosIcsCache?: Map<string, Cached>; __plcosGoogleEntryCache?: Map<string, GoogleCached> };
const cache = (g.__plcosIcsCache ??= new Map());

export interface FeedProblem { person: string; why: string }

/** One occurrence from any source, before it is sorted. */
export interface Entry extends ClassifiableEntry { uid: string; unexpanded?: boolean }

/** A Travel or Events mark, with what the Calendar page needs to relabel it. */
export type LaneMark = Mark & { entry: { key: string; label: CalendarLabel; by: string } };

const day = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Sorts entries into marks. One mark per occurrence (iCal UID and start), with everyone whose calendar holds it. */
class Marks {
  private byId = new Map<string, LaneMark>();
  constructor(private now: Date, private labels: Map<string, CalendarLabel>) {}
  add(person: string, e: Entry, colours: ColourPicks) {
    const key = entryKey(e.uid);
    const sorted = classify(e, colours, this.labels.get(key) ?? null);
    if (sorted.label === 'meeting') return;
    const id = `ics:${createHash('sha256').update(`${e.uid}|${e.start.toISOString()}`).digest('hex').slice(0, 16)}`;
    const seen = this.byId.get(id);
    if (seen) { seen.team = [...new Set([...(seen.team ?? []), person])].sort(); return; }
    const last = lastDay(e);
    this.byId.set(id, {
      id, lane: sorted.label, kind: spansDays(e) ? 'span' : 'point', label: e.title.replace(/\s*\[(travel|trip|events?)\]\s*/i, ' ').trim() || '(no title)',
      team: [person], lp: null,
      detail: [e.location?.trim() || null, e.allDay ? null : `${e.start.toISOString().slice(11, 16)} UTC`, e.unexpanded ? 'repeats; only the first is shown' : null].filter(Boolean).join(' · '),
      from: day(e.start), to: day(last), vehicleName: null, alert: false, past: last.getTime() < this.now.getTime(), href: null,
      entry: { key, label: sorted.label, by: SORTED_BY[sorted.by] },
    });
  }
  list() { return [...this.byId.values()]; }
}

type Users = Array<{ id: string; name: string; handle: string }>;
const allUsers = async (): Promise<Users> => (await (await import('@/modules/platform')).listUsers()).map((u) => ({ id: u.id, name: u.name, handle: u.handle }));

/** Pasted addresses' entries, at most hourly per address; a failed read keeps the last good copy for a day. */
async function icsEntries(u: { id: string; name: string }, window: { from: Date; to: Date }, transport: IcsFetch | undefined, problems: FeedProblem[]): Promise<{ feeds: number; entries: Entry[] }> {
  const feeds = await readFeeds(u.id);
  if (!feeds.length) return { feeds: 0, entries: [] };
  const off = !transport && (config.data.profile === 'demo' || config.data.copyTakenAt)
    ? (config.data.profile === 'demo' ? 'The demo does not read calendar addresses.' : 'A preview does not read calendar addresses.') : null;
  if (off) { problems.push({ person: u.name, why: off }); return { feeds: feeds.length, entries: [] }; }
  const entries: Entry[] = [];
  await Promise.all(feeds.map(async (f) => {
    const k = keyOf(f.address);
    let hit = cache.get(k);
    if (!hit || Date.now() - hit.at > FRESH_MS || (transport && 'error' in hit)) {
      try {
        const text = await fetchIcs(f.address, transport);
        hit = { at: Date.now(), text, events: 0 };
      } catch (e) {
        if (!(e instanceof IcsError)) throw e;
        const prev = cache.get(k);
        if (prev && 'text' in prev && Date.now() - prev.at < 24 * FRESH_MS) problems.push({ person: u.name, why: `${e.message} Showing the copy read ${new Date(prev.at).toISOString().slice(11, 16)} UTC.` });
        else { cache.set(k, { at: Date.now(), error: e.message }); problems.push({ person: u.name, why: e.message }); return; }
        hit = prev;
      }
    }
    if ('error' in hit) { problems.push({ person: u.name, why: hit.error }); return; }
    const events = parseIcs(hit.text, window).filter((e) => !e.cancelled);
    cache.set(k, { ...hit, events: events.length });
    entries.push(...events);
  }));
  return { feeds: feeds.length, entries };
}

type Runtime = import('@/lib/connectors/mailguard').RuntimeState;
type Client = import('@/lib/connectors/mailguard').MailguardClient;

/** A client that may read this person's calendar; null when they have no mailguard key; or why not, in §13's words. */
async function calendarClient(rt: Runtime, handle: string): Promise<{ client: Client } | { why: string } | null> {
  const mg = await import('@/lib/connectors/mailguard');
  if (rt.mode === 'off') return null;
  try {
    const c = await mg.checkedClient(rt, handle);
    const state = c.inspection.calendar.state;
    return state === 'ok' ? { client: c.client } : { why: `Calendar ${mg.CALENDAR_NOT_READ[state]}` };
  } catch (e) {
    if (e instanceof mg.NotConnected) return null;
    if (e instanceof mg.KeyRefused) return { why: e.inspection.reason };
    if (e instanceof mg.MailguardError) return { why: e.message };
    throw e;
  }
}

type GoogleCached = { at: number; entries: Entry[] } | { at: number; why: string };
const googleCache = (g.__plcosGoogleEntryCache ??= new Map());
/** GUESS: 20 pages of 250 is 5,000 occurrences per calendar in the window; more is not a person's calendar. */
const GOOGLE_MAX_PAGES = 20;

const instant = (w: { dateTime?: string; date?: string }): { at: Date; allDay: boolean } | null => {
  if (w.dateTime && Number.isFinite(Date.parse(w.dateTime))) return { at: new Date(w.dateTime), allDay: false };
  if (w.date && /^\d{4}-\d{2}-\d{2}$/.test(w.date)) return { at: new Date(`${w.date}T00:00:00Z`), allDay: true };
  return null;
};

/**
 * Every entry in the calendars a person's mailguard key reads (all but free/busy ones), at most hourly; a failed read
 * keeps the last good copy for a day. Null when the person has no key: they are simply not read.
 */
async function googleEntries(rt: Runtime, u: { id: string; handle: string }, window: { from: Date; to: Date }): Promise<{ entries: Entry[]; stale?: string } | { why: string } | null> {
  const k = `${u.id}|${window.from.toISOString().slice(0, 10)}|${window.to.toISOString().slice(0, 10)}`;
  const hit = googleCache.get(k);
  if (hit && Date.now() - hit.at <= FRESH_MS) return 'entries' in hit ? { entries: hit.entries } : { why: hit.why };
  const c = await calendarClient(rt, u.handle);
  if (!c) { googleCache.delete(k); return null; }
  const { MailguardError } = await import('@/lib/connectors/mailguard');
  const fail = (why: string) => {
    if (hit && 'entries' in hit && Date.now() - hit.at < 24 * FRESH_MS) return { entries: hit.entries, stale: why };
    googleCache.set(k, { at: Date.now(), why });
    return { why };
  };
  if ('why' in c) return fail(c.why);
  try {
    const entries: Entry[] = [];
    for (const cal of (await c.client.calendars()).filter((x) => x.accessRole !== 'freeBusyReader')) {
      let token: string | null = null, pages = 0;
      do {
        const page = await c.client.events(cal.id, { timeMin: window.from.toISOString(), timeMax: window.to.toISOString(), pageToken: token, max: 250 });
        if (!page) break;
        for (const e of page.events) {
          if (e.status === 'cancelled') continue;
          const start = instant(e.start), end = instant(e.end);
          if (!start) continue;
          entries.push({
            uid: e.iCalUID ?? e.id, title: e.summary || '(no title)', description: e.description, location: e.location, colorId: e.colorId,
            start: start.at, end: end?.at ?? start.at, allDay: start.allDay,
          });
        }
        token = page.nextPageToken;
      } while (token && ++pages < GOOGLE_MAX_PAGES);
    }
    googleCache.set(k, { at: Date.now(), entries });
    return { entries };
  } catch (e) {
    if (!(e instanceof MailguardError)) throw e;
    return fail(e.message);
  }
}

/**
 * The Travel and Events marks for a window, from every person's calendars through mailguard and their pasted
 * addresses: one per occurrence, with everyone whose calendar holds it (a conference two of us attend is one mark).
 * `sources` counts the people read through mailguard and the pasted addresses. Problems are said per person, in words.
 */
export async function laneMarks(now: Date, window: { from: Date; to: Date }, o: { transport?: IcsFetch; runtime?: Runtime; users?: Users } = {}): Promise<{ marks: LaneMark[]; problems: FeedProblem[]; sources: number }> {
  const { mailguardRuntime } = await import('@/lib/connectors/mailguard');
  const users = o.users ?? await allUsers();
  const rt = o.runtime ?? mailguardRuntime();
  const [labels, perUser] = await Promise.all([relabels(), Promise.all(users.map(async (u) => ({ u, colours: await myColours(u.id) })))]);
  const marks = new Marks(now, labels);
  const problems: FeedProblem[] = [];
  let sources = 0;
  await Promise.all(perUser.map(async ({ u, colours }) => {
    const [google, ics] = await Promise.all([googleEntries(rt, u, window), icsEntries(u, window, o.transport, problems)]);
    sources += ics.feeds;
    if (google && 'why' in google) problems.push({ person: u.name, why: google.why });
    else if (google) {
      sources += 1;
      if (google.stale) problems.push({ person: u.name, why: `${google.stale} Showing the copy read within the last day.` });
      for (const e of google.entries) marks.add(u.name, e, colours);
    }
    for (const e of ics.entries) marks.add(u.name, e, colours);
  }));
  return { marks: marks.list(), problems: problems.sort((a, b) => a.person.localeCompare(b.person)), sources };
}

/** For the properties: forget every copy. */
export const forgetFeedCache = () => { cache.clear(); googleCache.clear(); };
