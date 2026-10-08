import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncCalendars, type CalendarSyncResult } from '../../lib/calendar-sync';
import { FAKE_BASE, fakeCalendar, fakeMintKey, fakeSetCalendar, readFake, type FakeEvent } from '../../lib/connectors/mailguard/fake';
import { fakeTransport } from '../../lib/connectors/mailguard/fake';
import { memoryStore } from '../../lib/connectors/mailguard/tokens';
import type { MailguardRuntime } from '../../lib/connectors/mailguard';
import { freshDb, type Check } from './harness';

/**
 * Read-only calendars (issue 0021) on the fake mailguard and invented people only: no network, no real key.
 * Meetings land next to the LPs on them, once per LP however many calendars hold them, with no title, description
 * or outside name copied; Affinity's meeting wins; cancelled and vanished meetings go; a key that can invite or
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

    const now = new Date('2026-10-08T12:00:00Z');
    const ev = (id: string, start: string, guests: string[], o: Partial<FakeEvent> = {}): FakeEvent => ({
      id, status: 'confirmed', summary: 'Secret title about PLC things', description: 'Secret description',
      start: { dateTime: start }, end: { dateTime: new Date(Date.parse(start) + 3600_000).toISOString() }, iCalUID: `${id}@invented`,
      organizer: { email: juan.email }, attendees: guests.map((email) => ({ email })), ...o,
    });
    const past = ev('past1', '2026-09-01T15:00:00Z', [juan.email, mara.email, 'lena@invented-cal.example', 'room@resource.calendar.google.com']);
    const future = ev('next1', '2026-11-02T15:00:00Z', [juan.email, 'lena@invented-cal.example']);
    const internal = ev('team1', '2026-09-02T15:00:00Z', [juan.email, mara.email]);
    const stranger = ev('nobody1', '2026-09-03T15:00:00Z', [juan.email, 'unknown@invented-cal.example']);
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
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
