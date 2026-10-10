import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addFeed, entryKey, forgetFeedCache, laneMarks, myFeeds, relabelEntry, removeFeed, setColours, FeedRefused } from '../../lib/calendar-feeds';
import { classify, type ClassifiableEntry } from '../../lib/calendar-classify';
import { FAKE_BASE, fakeCalendar, fakeMintKey, fakeTransport, readFake, type FakeEvent } from '../../lib/connectors/mailguard/fake';
import { memoryStore } from '../../lib/connectors/mailguard/tokens';
import type { MailguardRuntime } from '../../lib/connectors/mailguard';
import { checkAddress, maskAddress, type IcsFetch } from '../../lib/connectors/ics/fetch';
import { icsTime, parseIcs } from '../../lib/connectors/ics/parse';
import { freshDb, type Check } from './harness';

/**
 * The Calendar page's Travel and Events lanes (issue 0021), on invented calendars: no network. Each entry is sorted
 * by what it is (relabel, then [tag], then colour, then wording or link, then days with a place); the reader gets
 * zones, all-day spans, repeats and moved occurrences right; only https calendar services are fetched; addresses
 * are kept per person, encrypted, and shown back masked; a shared entry is one mark with everyone on it; the
 * calendars are read through mailguard with GET only.
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

  const E = (o: Partial<ClassifiableEntry>): ClassifiableEntry => ({ title: 'Invented', start: new Date('2026-10-20T00:00:00Z'), end: new Date('2026-10-21T00:00:00Z'), allDay: true, ...o });
  const twoDays = { end: new Date('2026-10-22T00:00:00Z') };
  const sorted = [
    classify(E({ title: 'Neuro Summit', location: 'Lisbon', ...twoDays })).label === 'events',
    classify(E({ title: 'Keynote talk' })).label === 'events',
    classify(E({ title: 'Demo night', description: 'Join at https://lu.ma/abc' })).label === 'events',
    classify(E({ title: 'Demo night', location: 'https://www.eventbrite.com/e/123' })).label === 'events',
    classify(E({ title: 'Demo night', description: 'https://example.org/register?x=1' })).label === 'events',
    classify(E({ title: 'Lisbon', location: 'Lisbon, Portugal', ...twoDays })).label === 'travel',
    classify(E({ title: 'Offsite', ...twoDays })).label === 'meeting',
    classify(E({ title: 'Lunch', location: 'Cafe' })).label === 'meeting',
    classify(E({ title: 'Lunch', start: new Date('2026-10-20T12:00:00Z'), end: new Date('2026-10-20T13:00:00Z'), allDay: false, location: 'Cafe' })).label === 'meeting',
    // An all-day entry ends at the next midnight: one day is not two.
    classify(E({ title: 'Day trip', location: 'Boston' })).label === 'meeting',
    classify(E({ title: 'Dinner [travel]' })).label === 'travel',
    classify(E({ title: 'Neuro Summit [Travel]' })).label === 'travel',
    classify(E({ title: 'Board [event]' })).label === 'events',
    classify(E({ title: 'Lunch', colorId: '5' }), { travel: null, events: '5' }).label === 'events',
    classify(E({ title: 'Neuro Summit', colorId: '7' }), { travel: '7', events: null }).label === 'travel',
    classify(E({ title: 'Lunch [event]', colorId: '7' }), { travel: '7', events: null }).label === 'events',
    classify(E({ title: 'Neuro Summit [event]' }), undefined, 'meeting').label === 'meeting',
  ];
  check('Calendar entries: an event by its conference, summit or talk wording or its Luma, Eventbrite or registration link; a trip by two or more days with a place; else a meeting; relabel, then [tag], then colour, override',
    sorted.every(Boolean), JSON.stringify(sorted.map((x, i) => x ? null : i).filter((x) => x !== null)));

  const db = await freshDb();
  forgetFeedCache();
  const now = new Date('2026-10-08T12:00:00Z');
  const people = async (h: string) => (await db.one<{ id: string; name: string; email: string; handle: string }>('select id::text, name, email, handle from platform.app_user where handle = $1', [h]))!;
  const [j, m] = [await people('juan'), await people('mara')];
  const dir = await mkdtemp(join(tmpdir(), 'plcos-lanes-'));
  try {
    const store = memoryStore();
    const rt: MailguardRuntime = { mode: 'fake', base: FAKE_BASE, transport: fakeTransport(dir), store, envKey: null, fakeDir: dir };
    const nobody = await laneMarks(now, window, { users: [j, m], runtime: rt, transport: async () => { throw new Error('no fetch expected'); } });

    const a = 'https://calendar.google.com/calendar/ical/mara-trips/private-aaaa/basic.ics';
    await addFeed(m.id, a);
    let refused = 0;
    for (const bad of [() => addFeed(m.id, a), () => addFeed(m.id, 'https://example.org/x.ics')]) {
      try { await bad(); } catch (e) { if (e instanceof FeedRefused) refused++; }
    }
    const stored = await db.query<{ value: string }>(`select value from platform.person_secret where purpose = 'calendar-ics'`);
    const mine = await myFeeds(m.id);
    check('Calendar feeds: a pasted address is kept encrypted and shown back masked; a duplicate or another service is refused; with no calendars, nothing is read',
      nobody.sources === 0 && nobody.marks.length === 0 && nobody.problems.length === 0 && refused === 2 && stored.length === 1 && !stored[0]!.value.includes('calendar.google.com')
        && mine.length === 1 && mine[0]!.masked === 'Google Calendar ••••.ics' && !JSON.stringify(mine).includes('private-aaaa'),
      JSON.stringify({ nobody, refused, stored: stored.length, mine }));

    // Juan's main calendar, read through mailguard with calendar.read and its details; Mara's key cannot read calendars.
    const fev = (id: string, o: Partial<FakeEvent>): FakeEvent => ({ id, status: 'confirmed', summary: 'Invented', start: { date: '2026-10-20' }, end: { date: '2026-10-22' },
      iCalUID: `${id}@invented`, organizer: { email: j.email }, attendees: [], ...o } as FakeEvent);
    await fakeMintKey(dir, { mailbox: j.email, grant: ['draft', 'calendar.read', 'calendar.read.details'] }).then((k) => store.put('juan', k));
    await fakeMintKey(dir, { mailbox: m.email, grant: ['draft', 'read.metadata'] }).then((k) => store.put('mara', k));
    await fakeCalendar(dir, j.email, { id: 'primary', name: 'Juan', primary: true }, [
      fev('meet', { summary: 'A meeting', start: { dateTime: '2026-10-15T15:00:00Z' }, end: { dateTime: '2026-10-15T16:00:00Z' }, location: 'Office' }),
      fev('summit', { summary: 'Shared summit' }),
      fev('trip', { summary: 'Lisbon', location: 'Lisbon, Portugal', start: { date: '2026-11-02' }, end: { date: '2026-11-05' } }),
      fev('demo', { summary: 'Demo night', description: 'Tickets: https://lu.ma/invented', start: { dateTime: '2026-10-28T01:00:00Z' }, end: { dateTime: '2026-10-28T03:00:00Z' } }),
      fev('dinner', { summary: 'Dinner [travel]', start: { dateTime: '2026-10-16T01:00:00Z' }, end: { dateTime: '2026-10-16T03:00:00Z' } }),
      fev('banana', { summary: 'Offsite', colorId: '5', start: { date: '2026-10-25' }, end: { date: '2026-10-26' } }),
      fev('gone', { summary: 'Cancelled summit', status: 'cancelled' }),
    ]);
    await fakeCalendar(dir, j.email, { id: 'busy@group.calendar.google.com', name: 'Someone’s busy times', primary: false, accessRole: 'freeBusyReader' }, [fev('busy', { summary: 'Hidden summit' })]);
    await setColours(j.id, { travel: null, events: '5' });
    let sameColour = false;
    try { await setColours(j.id, { travel: '5', events: '5' }); } catch (e) { sameColour = e instanceof FeedRefused; }
    // Mara's pasted address holds the same summit (same iCal UID) and a two-day stay with a place.
    let reads = 0;
    const transport: IcsFetch = async () => { reads++; return { status: 200, text: async () => CAL(
      EV(['UID:summit@invented', 'SUMMARY:Shared summit', 'DTSTART;VALUE=DATE:20261020', 'DTEND;VALUE=DATE:20261022'])
      + EV(['UID:stay', 'SUMMARY:Boston', 'LOCATION:Boston', 'DTSTART;VALUE=DATE:20261012', 'DTEND;VALUE=DATE:20261014'])) }; };
    const got = await laneMarks(now, window, { users: [j, m], runtime: rt, transport });
    const lane = (label: string) => got.marks.filter((x) => x.label === label).map((x) => `${x.lane}:${(x.team ?? []).join('+')}`).join();
    const fake = await readFake(dir);
    const listCalls = fake.calls['calendar.events.list'] ?? 0;
    check('Calendar lanes: every calendar a person’s mailguard key reads is sorted; a trip shows its destination; an entry in two people’s calendars is one mark with both names; meetings, cancelled and free/busy entries are not shown',
      lane('Shared summit') === `events:${[j.name, m.name].sort().join('+')}` && lane('Lisbon') === `travel:${j.name}` && got.marks.find((x) => x.label === 'Lisbon')?.detail === 'Lisbon, Portugal'
        && lane('Demo night') === `events:${j.name}` && lane('Dinner') === `travel:${j.name}` && lane('Offsite') === `events:${j.name}` && lane('Boston') === `travel:${m.name}`
        && lane('A meeting') === '' && lane('Cancelled summit') === '' && lane('Hidden summit') === '' && sameColour
        && got.marks.find((x) => x.label === 'Lisbon')?.kind === 'span' && got.marks.find((x) => x.label === 'Lisbon')?.to.toISOString().slice(0, 10) === '2026-11-04',
      JSON.stringify(got.marks.map((x) => [x.lane, x.label, x.team, x.entry.by])));
    check('Calendar lanes: read through mailguard with GET only, nothing written or answered; without calendar.read the reason is said in words, as the Email card does, and no key is asked for',
      !(fake.calendarWrites ?? []).length && !fake.sendAttempts.length && Object.keys(fake.calls).every((c) => ['whoami', 'calendar.calendars', 'calendar.events.list'].includes(c))
        && got.problems.length === 1 && got.problems[0]!.person === m.name && /calendar\.read/.test(got.problems[0]!.why) && !/mg_/.test(got.problems[0]!.why) && got.sources === 2,
      JSON.stringify({ calls: fake.calls, problems: got.problems, sources: got.sources }));

    // Relabel: the latest click wins, for every occurrence, and takes effect without a new read.
    const lisbon = got.marks.find((x) => x.label === 'Lisbon')!.entry.key;
    await relabelEntry(j.id, lisbon, 'events');
    await relabelEntry(m.id, lisbon, 'meeting');
    await relabelEntry(j.id, entryKey('meet@invented'), 'travel');
    let badKey = false;
    try { await relabelEntry(j.id, 'not-a-key', 'travel'); } catch (e) { badKey = e instanceof FeedRefused; }
    const after = await laneMarks(now, window, { users: [j, m], runtime: rt, transport });
    const notes = await db.query<{ body: string; data: unknown }>(`select body, data from research.note where kind = 'calendar_label'`);
    check('Calendar lanes: a relabel clicked on the Calendar page is remembered, the latest wins, and keeps no title or place; entries are read once an hour, not once a page',
      !after.marks.some((x) => x.label === 'Lisbon') && after.marks.find((x) => x.label === 'A meeting')?.lane === 'travel' && after.marks.find((x) => x.label === 'A meeting')?.entry.by === 'relabelled here'
        && badKey && notes.length === 3 && !JSON.stringify(notes).match(/Lisbon|meeting@|A meeting/) && ((await readFake(dir)).calls['calendar.events.list'] ?? 0) === listCalls && reads === 1,
      JSON.stringify({ marks: after.marks.map((x) => [x.lane, x.label]), notes, reads }));

    forgetFeedCache();
    const failing = await laneMarks(now, window, { users: [m], runtime: rt, transport: async () => ({ status: 404, text: async () => '' }) });
    await removeFeed(m.id, 0);
    check('Calendar feeds: an address that stopped working is said by person, without the address; removing one forgets it',
      failing.marks.length === 0 && failing.problems.some((p) => /no longer serves/.test(p.why) && !/private-/.test(p.why)) && (await myFeeds(m.id)).length === 0,
      JSON.stringify(failing.problems));
  } finally { await rm(dir, { recursive: true, force: true }); }
}
