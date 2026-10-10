import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncCalendars, unmatchCalendarMeeting, type CalendarSyncResult } from '../../lib/calendar-sync';
import { MATCHED_BY_NAME } from '../../lib/calendar-match';
import { FAKE_BASE, fakeCalendar, fakeMintKey, fakeSetCalendar, readFake, type FakeEvent } from '../../lib/connectors/mailguard/fake';
import { fakeTransport } from '../../lib/connectors/mailguard/fake';
import { memoryStore } from '../../lib/connectors/mailguard/tokens';
import type { MailguardRuntime } from '../../lib/connectors/mailguard';
import { freshDb, type Check } from './harness';

/**
 * Read-only calendars (issue 0021) on the fake mailguard and invented people only: no network, no real key.
 * Only LP meetings count: matched by a guest's address or firm domain, else by an LP's name in the entry (marked,
 * undoable); internal-only, guest-less and unmatched outside meetings leave nothing. They land once per LP however
 * many calendars hold them, with no title, description or outside name copied; Affinity's meeting wins; cancelled and vanished meetings go; a key that can invite or
 * answer is refused; nothing is ever written to a calendar.
 */
export async function calendarProperties(check: Check) {
  const db = await freshDb();
  const dir = await mkdtemp(join(tmpdir(), 'plcos-calendar-'));
  try {
    const user = async (h: string) => (await db.one<{ id: string; name: string; email: string }>('select id::text, name, email from platform.app_user where handle = $1', [h]))!;
    const [juan, mara, ines] = [await user('juan'), await user('mara'), await user('ines')];
    const entity = async (type: string, name: string) => (await db.one<{ id: string }>(`insert into identity.entity(entity_type, display_name) values ($1::identity.entity_type, $2) returning entity_id::text id`, [type, name]))!.id;
    const lena = await entity('person', 'Invented Lena'), firm = await entity('org', 'Invented Lena Capital'), otto = await entity('person', 'Invented Otto');
    await db.query(`insert into research.source_doc (doc_id, title, kind, origin, as_of, strength, supports, body)
      values ('props:calendar', 'Invented record', 'crm', 'affinity', current_date, 'weak', 'Invented', '') on conflict do nothing`);
    await db.query(`insert into research.claim (entity_id, field, value, source, as_of, confidence) values ($1, 'email', 'lena@invented-cal.example', 'props:calendar', current_date, 'medium'),
      ($2, 'email', 'otto@invented-cal.example', 'props:calendar', current_date, 'medium')`, [lena, otto]);
    await db.query(`insert into identity.affiliation (person_entity, org_entity, kind, role, source, as_of, certainty) values ($1, $2, 'staff', 'Invented', 'fixture', now(), 'inferred')`, [lena, firm]);
    // LPs: Lena's firm and Otto are pursued; Vela is a firm known only by its email domain.
    const vela = await entity('org', 'Invented Vela Partners');
    await db.query(`insert into research.claim (entity_id, field, value, source, as_of, confidence) values ($1, 'email_domain', 'vela-invented.example', 'props:calendar', current_date, 'medium')`, [vela]);
    await db.query(`insert into strategy.pursuit (entity_id, vehicle_id, owner_id) select e, (select id from platform.vehicle order by slug limit 1), $2::uuid from unnest($1::uuid[]) e`, [[firm, otto, vela], juan.id]);

    const now = new Date('2026-10-08T12:00:00Z');
    const ev = (id: string, start: string, guests: string[], o: Partial<FakeEvent> = {}): FakeEvent => ({
      id, status: 'confirmed', summary: 'Secret title about PLC things', description: 'Secret description',
      start: { dateTime: start }, end: { dateTime: new Date(Date.parse(start) + 3600_000).toISOString() }, iCalUID: `${id}@invented`,
      organizer: { email: juan.email }, attendees: guests.map((email) => ({ email })), ...o,
    });
    const past = ev('past1', '2026-09-01T15:00:00Z', [juan.email, mara.email, 'lena@invented-cal.example', 'room@resource.calendar.google.com']);
    const future = ev('next1', '2026-11-02T15:00:00Z', [juan.email, 'lena@invented-cal.example']);
    const internal = ev('team1', '2026-09-02T15:00:00Z', [juan.email, mara.email]);
    const stranger = ev('nobody1', '2026-09-03T15:00:00Z', [juan.email, 'unknown@stranger-invented.example']);
    const withAffinity = ev('aff1', '2026-09-04T15:00:00Z', [juan.email, 'otto@invented-cal.example']);
    const old = ev('old1', '2024-01-01T15:00:00Z', [juan.email, 'lena@invented-cal.example']);
    await db.query(`insert into meetings.meeting (entity_id, channel, direction, held_on, owner_id, attendees, source, source_ref) values ($1, 'meeting', 'both', '2026-09-04', $2, '{}', 'affinity', 'interaction:meeting:9:props')`, [otto, juan.id]);

    const juanKey = await fakeMintKey(dir, { mailbox: juan.email, grant: ['draft', 'read.metadata', 'calendar.read'] });
    const maraKey = await fakeMintKey(dir, { mailbox: mara.email, grant: ['draft', 'calendar.read.details'] });
    await fakeCalendar(dir, juan.email, { id: 'primary' }, [past, future, internal, stranger, withAffinity, old]);
    await fakeCalendar(dir, juan.email, { id: 'team@group.calendar.google.com', name: 'Team', primary: false, accessRole: 'reader' }, [past]);
    await fakeCalendar(dir, mara.email, { id: 'primary' }, [{ ...past, organizer: { email: juan.email } }]);
    const store = memoryStore();
    await store.put('juan', juanKey);
    await store.put('mara', maraKey);
    const rt: MailguardRuntime = { mode: 'fake', base: FAKE_BASE, transport: fakeTransport(dir), store, envKey: null, fakeDir: dir };
    const sync = async () => (await syncCalendars(db, juan.id, { runtime: rt, now })) as CalendarSyncResult;
    const rows = () => db.query<{ entity: string; held_on: string | null; scheduled_for: Date | null; attendees: string[]; source_ref: string; owner: string; group_size: number; about: string | null; all: string }>(
      `select entity_id::text entity, held_on::text, scheduled_for, attendees, source_ref, owner_id::text owner, group_size, about, row_to_json(m)::text "all"
         from meetings.meeting m where source = 'calendar' order by held_on nulls last, entity_id`);

    const first = await sync();
    const r1 = await rows();
    const pastRows = r1.filter((r) => r.held_on === '2026-09-01');
    check('Calendar: a meeting with an LP on record lands once for the person and once for their firm, however many calendars hold it; past is held, future scheduled; the team and resources are not LPs',
      first.complete && first.people === 2 && first.added === 4 && pastRows.length === 2 && new Set(pastRows.map((r) => r.entity)).size === 2
        && pastRows.every((r) => r.entity === lena || r.entity === firm) && r1.filter((r) => r.scheduled_for).length === 2 && r1.every((r) => r.group_size === 1),
      JSON.stringify({ ...first, skipped: first.skipped.length, rows: r1.map((r) => [r.held_on, r.scheduled_for ? 'future' : '', r.entity === lena ? 'lena' : r.entity === firm ? 'firm' : r.entity]) }));
    check('Calendar: only the date, the team (by name) and what it is about are kept: no title, no description, no outside address; the organizer on the team owns it',
      r1.every((r) => !/Secret|invented-cal|resource\.calendar/.test(r.all)) && pastRows.every((r) => r.attendees.join() === [juan.name, mara.name].sort().join() && r.owner === juan.id),
      JSON.stringify(r1.map((r) => r.attendees)));
    check('Calendar: a meeting Affinity already has for that LP that day stays Affinity’s alone',
      first.affinity === 1 && !r1.some((r) => r.entity === otto), `already Affinity's ${first.affinity}`);

    const again = await sync();
    check('Calendar: reading again changes nothing', again.added === 0 && again.removed === 0 && (await rows()).length === r1.length, JSON.stringify({ added: again.added, removed: again.removed }));

    // Cancelled, and gone from every calendar: removed after a whole read.
    await fakeCalendar(dir, juan.email, { id: 'primary' }, [{ ...future, status: 'cancelled' }]);
    const cancelled = await sync();
    await fakeCalendar(dir, juan.email, { id: 'primary' }, [{ ...past, id: 'past1', start: { dateTime: '2023-01-01T15:00:00Z' }, end: { dateTime: '2023-01-01T16:00:00Z' } }]);
    await fakeCalendar(dir, juan.email, { id: 'team@group.calendar.google.com' }, [{ ...past, start: { dateTime: '2023-01-01T15:00:00Z' }, end: { dateTime: '2023-01-01T16:00:00Z' } }]);
    await fakeCalendar(dir, mara.email, { id: 'primary' }, [{ ...past, start: { dateTime: '2023-01-01T15:00:00Z' }, end: { dateTime: '2023-01-01T16:00:00Z' } }]);
    // One person's calendar out of reach: nothing is removed for being gone.
    await fakeSetCalendar(dir, maraKey, 'reconnect');
    const partial = await sync();
    const afterPartial = (await rows()).length;
    await fakeSetCalendar(dir, maraKey, 'ok');
    const whole = await sync();
    check('Calendar: a cancelled meeting goes; one gone from every calendar goes only after every calendar was read whole',
      cancelled.removed === 2 && !partial.complete && partial.removed === 0 && afterPartial === 2 && partial.skipped.some((s) => s.handle === 'mara' && s.why === 'reconnect')
        && whole.complete && whole.removed === 2 && (await rows()).length === 0,
      JSON.stringify({ cancelled: cancelled.removed, partial: [partial.complete, partial.removed, afterPartial], whole: [whole.complete, whole.removed] }));

    // A key that could invite people or answer an invitation is refused: that person's calendar is not read.
    const inesKey = await fakeMintKey(dir, { mailbox: ines.email, grant: ['draft', 'calendar.read', 'calendar.invite'] });
    await fakeCalendar(dir, ines.email, { id: 'primary' }, [ev('ines1', '2026-09-05T15:00:00Z', [ines.email, 'lena@invented-cal.example'], { organizer: { email: ines.email } })]);
    await store.put('ines', inesKey);
    const flagged = await fakeMintKey(dir, { mailbox: 'sam@example.com', grant: ['draft', 'calendar.read'] });
    await fakeSetCalendar(dir, flagged, 'ok', true);
    await store.put('sam', flagged);
    const refused = await sync();
    const fake = await readFake(dir);
    const calls = Object.keys(fake.calls).sort();
    check('Calendar: a key that can invite people, answer invitations, or that mailguard says can notify others is refused, and its calendar not read; nothing was ever written to a calendar or sent',
      refused.skipped.some((s) => s.handle === 'ines' && s.why === 'can_notify') && refused.skipped.some((s) => s.handle === 'sam' && s.why === 'can_notify')
        && !(await rows()).length && !(fake.calendarWrites ?? []).length && !fake.sendAttempts.length
        && calls.every((c) => ['whoami', 'calendar.calendars', 'calendar.events.list'].includes(c)),
      JSON.stringify({ skipped: refused.skipped, calls, writes: (fake.calendarWrites ?? []).length }));
    const run = await db.one<{ status: string; note: string }>(`select status, note from sources.sync_run where source = 'calendar' order by id desc limit 1`);
    check('Calendar: each read is a run receipt in counts, never a name or address', run?.status === 'ok' && !/invented|example\.com|Lena|Otto/i.test(run.note), run?.note ?? 'no run');

    // Only LP meetings (Juan, 10 Oct 2026). Ines's key is put right so only Juan's and Mara's calendars are read.
    await store.delete('ines'); await store.delete('sam');
    const lp = [
      ev('dom1', '2026-09-10T15:00:00Z', [juan.email, 'new.partner@vela-invented.example'], { summary: 'Catch-up' }),
      ev('name1', '2026-09-11T15:00:00Z', [juan.email, 'someone@elsewhere-invented.example'], { summary: 'Intro: Invented Vela Partners' }),
      ev('internal2', '2026-09-12T15:00:00Z', [juan.email, mara.email, 'colleague@protocol.ai'], { summary: 'Prep for Invented Vela Partners' }),
      ev('personal1', '2026-09-13T15:00:00Z', [], { summary: 'Dinner with Invented Vela Partners' }),
      ev('vendor1', '2026-09-14T15:00:00Z', [juan.email, 'sales@vendor-invented.example'], { summary: 'Software demo' }),
      ev('noteam1', '2026-09-15T15:00:00Z', ['lena@invented-cal.example', 'otto@invented-cal.example'], { organizer: { email: 'lena@invented-cal.example' } }),
    ];
    await fakeCalendar(dir, juan.email, { id: 'primary' }, lp);
    const lpRead = await sync();
    const lpRows = await db.query<{ ref: string; entity: string; day: string; summary: string | null }>(
      `select source_ref ref, entity_id::text entity, held_on::text "day", summary from meetings.meeting where source = 'calendar' and held_on between '2026-09-10' and '2026-09-15' order by held_on`);
    const at = (d: string) => lpRows.filter((x) => x.day === d);
    check('Calendar: only LP meetings count: a guest at an LP firm’s email domain is that firm’s; internal-only, guest-less, no-team and unmatched outside meetings leave nothing, whatever their title says',
      at('2026-09-10').length === 1 && at('2026-09-10')[0]!.entity === vela && at('2026-09-10')[0]!.summary === null
        && !at('2026-09-12').length && !at('2026-09-13').length && !at('2026-09-14').length && !at('2026-09-15').length,
      JSON.stringify({ matched: lpRead.matched, byName: lpRead.byName, rows: lpRows.map((x) => [x.day, x.entity === vela ? 'vela' : x.entity, x.summary ? 'by name' : '']) }));
    const named = at('2026-09-11');
    check('Calendar: with an outside guest no LP matched, an LP named in the entry makes it theirs, marked as matched by name with lower confidence',
      named.length === 1 && named[0]!.entity === vela && named[0]!.summary === MATCHED_BY_NAME && lpRead.byName === 1 && !/Intro|elsewhere/.test(JSON.stringify(lpRows)),
      JSON.stringify(named));
    const undone = await unmatchCalendarMeeting(db, juan.id, named[0]?.ref ?? '');
    const reread = await sync();
    const after = await db.query<{ n: number }>(`select count(*)::int n from meetings.meeting where source = 'calendar' and held_on = '2026-09-11'`);
    check('Calendar: “Not this LP” undoes a name match, and the next read does not make it again',
      undone && after[0]?.n === 0 && reread.added === 0, JSON.stringify({ undone, after: after[0]?.n, added: reread.added }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
