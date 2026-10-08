import { addFeed, feedMarks, forgetFeedCache, myFeeds, removeFeed, FeedRefused } from '../../lib/calendar-feeds';
import { checkAddress, maskAddress, type IcsFetch } from '../../lib/connectors/ics/fetch';
import { icsTime, parseIcs } from '../../lib/connectors/ics/parse';
import { freshDb, type Check } from './harness';

/**
 * The Calendar page's Travel and Events lanes (issue 0021), on invented calendars: no network. The reader gets
 * zones, all-day spans, repeats and moved occurrences right; only https calendar services are fetched; addresses
 * are kept per person, encrypted, and shown back masked; a shared event is one mark with everyone on it.
 */
const CAL = (events: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Invented//EN\r\n${events}END:VCALENDAR\r\n`;
const EV = (lines: string[]) => `BEGIN:VEVENT\r\n${lines.join('\r\n')}\r\nEND:VEVENT\r\n`;

export async function calendarFeedProperties(check: Check) {
  const window = { from: new Date('2026-09-01T00:00:00Z'), to: new Date('2026-12-31T00:00:00Z') };
  const text = CAL([
    EV(['UID:trip-1', 'SUMMARY:Flight to SF\\, then Palo Alto', 'DTSTART;TZID=America/New_York:20261012T090000', 'DTEND;TZID=America/Los_Angeles:20261012T120000', 'LOCATION:JFK']),
    EV(['UID:conf-1', 'SUMMARY:Neuro conference', 'DTSTART;VALUE=DATE:20261103', 'DTEND;VALUE=DATE:20261106', 'BEGIN:VALARM', 'SUMMARY:Alarm, not the title', 'END:VALARM']),
    EV(['UID:weekly', 'SUMMARY:Weekly flight home', 'DTSTART:20261001T170000Z', 'DTEND:20261001T190000Z', 'RRULE:FREQ=WEEKLY;COUNT=3']),
    EV(['UID:weekly', 'RECURRENCE-ID:20261008T170000Z', 'SUMMARY:Weekly flight home (moved)', 'DTSTART:20261009T170000Z', 'DTEND:20261009T190000Z']),
    EV(['UID:odd', 'SUMMARY:Every other Tuesday', 'DTSTART:20261006T170000Z', 'DURATION:PT1H', 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH']),
    EV(['UID:gone', 'SUMMARY:Cancelled trip', 'DTSTART:20261020T170000Z', 'DTEND:20261020T190000Z', 'STATUS:CANCELLED']),
    EV(['UID:old', 'SUMMARY:Long ago', 'DTSTART:20250101T170000Z', 'DTEND:20250101T190000Z']),
    `BEGIN:VEVENT\r\nUID:folded\r\nSUMMARY:A long title that \r\n wraps\r\nDTSTART:20261015T100000Z\r\nEND:VEVENT\r\n`,
  ].join(''));
  const ev = parseIcs(text, window);
  const by = (uid: string) => ev.filter((e) => e.uid === uid);
  const trip = by('trip-1')[0], conf = by('conf-1')[0], weekly = by('weekly');
  check('Calendar feeds: a calendar file reads in the right zones, all-day spans, repeats and moved occurrences, folded and escaped text; alarms are not events; out-of-window ones are left out',
    trip?.start.toISOString() === '2026-10-12T13:00:00.000Z' && trip.end.toISOString() === '2026-10-12T19:00:00.000Z' && trip.title === 'Flight to SF, then Palo Alto' && trip.location === 'JFK'
      && conf?.allDay === true && conf.title === 'Neuro conference' && conf.end.toISOString() === '2026-11-06T00:00:00.000Z'
      && weekly.length === 3 && weekly.map((w) => w.start.toISOString().slice(0, 10)).join() === '2026-10-01,2026-10-09,2026-10-15'
      && by('odd').length === 1 && by('odd')[0]!.unexpanded && by('odd')[0]!.end.getTime() - by('odd')[0]!.start.getTime() === 3600_000
      && by('gone')[0]?.cancelled === true && by('old').length === 0 && by('folded')[0]?.title === 'A long title that wraps'
      && icsTime('20260308T023000', { TZID: 'America/New_York' }) !== null && icsTime('not a time') === null,
    JSON.stringify(ev.map((e) => [e.uid, e.start.toISOString(), e.end.toISOString(), e.title])));

  const ok = ['https://calendar.google.com/calendar/ical/x%40group.calendar.google.com/private-abc123/basic.ics', 'webcal://www.tripit.com/feed/ical/private/ABC/tripit.ics'];
  const no = ['http://calendar.google.com/calendar/ical/x/basic.ics', 'https://169.254.169.254/latest/meta-data', 'https://localhost/x.ics', 'https://calendar.google.com.evil.example/x.ics',
    'https://user:pw@calendar.google.com/x.ics', 'https://calendar.google.com:8443/x.ics', 'file:///etc/passwd', 'not a url'];
  check('Calendar feeds: only https addresses at the named calendar services are read: never plain http, an internal address, a look-alike host, credentials or a port',
    ok.every((a) => 'url' in checkAddress(a)) && no.every((a) => 'why' in checkAddress(a)) && maskAddress(ok[0]!) === 'Google Calendar ••••.ics',
    JSON.stringify([...ok, ...no].map((a) => ['url' in checkAddress(a), a.slice(0, 30)])));

  const db = await freshDb();
  forgetFeedCache();
  const user = async (h: string) => (await db.one<{ id: string; name: string }>('select id::text, name from platform.app_user where handle = $1', [h]))!;
  const [juan, mara] = [await user('juan'), await user('mara')];
  const empty = await feedMarks(new Date('2026-10-08T12:00:00Z'), window, { users: [juan, mara], transport: async () => { throw new Error('no fetch expected'); } });
  const a = 'https://calendar.google.com/calendar/ical/juan-travel/private-aaaa/basic.ics';
  const b = 'https://calendar.google.com/calendar/ical/mara-events/private-bbbb/basic.ics';
  await addFeed(juan.id, 'travel', a);
  await addFeed(mara.id, 'events', b);
  let refused = 0;
  for (const bad of [() => addFeed(juan.id, 'travel', a), () => addFeed(juan.id, 'travel', 'https://example.org/x.ics'), () => addFeed(juan.id, 'other' as 'travel', a)]) {
    try { await bad(); } catch (e) { if (e instanceof FeedRefused) refused++; }
  }
  const stored = await db.query<{ value: string }>(`select value from platform.person_secret where purpose = 'calendar-ics'`);
  const fetched: string[] = [];
  const transport: IcsFetch = async (url) => {
    fetched.push(url.pathname);
    const shared = EV(['UID:summit', 'SUMMARY:Shared summit', 'DTSTART;VALUE=DATE:20261020', 'DTEND;VALUE=DATE:20261022']);
    return { status: 200, text: async () => (url.pathname.includes('juan') ? CAL(EV(['UID:t1', 'SUMMARY:Flight to Boston', 'DTSTART:20261014T120000Z', 'DTEND:20261014T150000Z']) + shared) : CAL(shared)) };
  };
  const now = new Date('2026-10-08T12:00:00Z');
  const got = await feedMarks(now, window, { users: [juan, mara], transport });
  const travel = got.marks.filter((m) => m.lane === 'travel'), events = got.marks.filter((m) => m.lane === 'events');
  const summit = got.marks.filter((m) => m.label === 'Shared summit');
  const mine = await myFeeds(juan.id);
  check('Calendar feeds: each person’s addresses are kept encrypted and shown back masked; a duplicate, another service or another lane is refused; with none, nothing is fetched',
    empty.feeds === 0 && empty.marks.length === 0 && refused === 3 && stored.length === 2 && stored.every((s) => !s.value.includes('calendar.google.com'))
      && mine.length === 1 && mine[0]!.masked === 'Google Calendar ••••.ics' && !JSON.stringify(mine).includes('private-aaaa'),
    JSON.stringify({ empty: empty.feeds, refused, stored: stored.length, mine }));
  check('Calendar feeds: trips land in Travel and events in Events with whose calendar they came from; a span keeps its last day; read once an hour, not once a page',
    travel.length === 2 && events.length === 1 && travel.find((m) => m.label === 'Flight to Boston')?.team?.join() === juan.name
      && summit.length === 2 && summit.every((m) => m.kind === 'span' && m.from.toISOString().slice(0, 10) === '2026-10-20' && m.to.toISOString().slice(0, 10) === '2026-10-21')
      && got.problems.length === 0 && (await feedMarks(now, window, { users: [juan, mara], transport })).marks.length === 3 && fetched.length === 2,
    JSON.stringify({ marks: got.marks.map((m) => [m.lane, m.label, m.team, m.from.toISOString().slice(0, 10), m.to.toISOString().slice(0, 10)]), fetched: fetched.length, problems: got.problems }));

  forgetFeedCache();
  const failing = await feedMarks(now, window, { users: [juan, mara], transport: async () => ({ status: 404, text: async () => '' }) });
  await removeFeed(mara.id, 0);
  check('Calendar feeds: an address that stopped working is said by person and lane, without the address; removing one forgets it',
    failing.marks.length === 0 && failing.problems.length === 2 && failing.problems.every((p) => /no longer serves/.test(p.why) && !/private-/.test(p.why))
      && (await myFeeds(mara.id)).length === 0,
    JSON.stringify(failing.problems));
}
