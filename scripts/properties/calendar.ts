import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncCalendars, unmatchCalendarMeeting, type CalendarSyncResult } from '../../lib/calendar-sync';
import { MATCHED_BY_AFFILIATE, MATCHED_BY_NAME } from '../../lib/calendar-match';
import { addCandidate, CandidateRefused, dismissCandidate, listCandidates, researchCandidate, strongReason, undoCandidateAdd } from '../../lib/calendar-candidates';
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
      first.complete && first.people === 2 && first.skipped.every((s) => s.why === 'no key') && first.added === 4 && pastRows.length === 2 && new Set(pastRows.map((r) => r.entity)).size === 2
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

    // Addresses Affinity holds for a person (never claims): Rhea is known only through her latest Affinity record.
    const rhea = await entity('person', 'Invented Rhea'), kestrel = await entity('org', 'Invented Kestrel Fund');
    await db.query(`insert into identity.source_record(source, source_id, entity_id, resolved_by) values ('affinity', 'person:900001', $1, 'human:fixture')`, [rhea]);
    await db.query(`insert into sources.raw_record(source, kind, source_id, payload_hash, payload, fetched_at) values
      ('affinity', 'person', '900001', 'props-cal-old', '{"primaryEmailAddress": "rhea@former-invented.example", "emailAddresses": ["rhea@former-invented.example"]}', '2026-01-01'),
      ('affinity', 'person', '900001', 'props-cal-new', '{"primaryEmailAddress": "Rhea@Kestrel-Invented.example", "emailAddresses": ["rhea.alt@kestrel-invented.example", 7]}', '2026-06-01')`);
    await db.query(`insert into identity.affiliation (person_entity, org_entity, kind, role, source, as_of, certainty) values ($1, $2, 'staff', 'Invented', 'fixture', now(), 'inferred')`, [rhea, kestrel]);
    // Osprey is a firm known only by the domains on its Affinity company record.
    const osprey = await entity('org', 'Invented Osprey Holdings');
    await db.query(`insert into identity.source_record(source, source_id, entity_id, resolved_by) values ('affinity', 'company:900002', $1, 'human:fixture')`, [osprey]);
    await db.query(`insert into sources.raw_record(source, kind, source_id, payload_hash, payload) values
      ('affinity', 'list_entry', '900003', 'props-cal-co', '{"type": "company", "entity": {"id": 900002, "domain": "osprey-invented.example", "domains": ["osprey-invented.example", "osprey-alt-invented.example"]}}')`);
    await db.query(`insert into strategy.pursuit (entity_id, vehicle_id, owner_id) select e, (select id from platform.vehicle order by slug limit 1), $2::uuid from unnest($1::uuid[]) e`, [[kestrel, osprey], juan.id]);
    await fakeCalendar(dir, juan.email, { id: 'primary' }, [
      ev('aff2', '2026-09-20T15:00:00Z', [juan.email, 'rhea.alt@kestrel-invented.example']),
      ev('aff3', '2026-09-21T15:00:00Z', [juan.email, 'someone.new@kestrel-invented.example']),
      ev('aff4', '2026-09-22T15:00:00Z', [juan.email, 'rhea@former-invented.example']),
      ev('aff5', '2026-09-23T15:00:00Z', [juan.email, 'partner@osprey-alt-invented.example']),
    ]);
    const affRead = await sync();
    const affRows = await db.query<{ entity: string; day: string; summary: string | null }>(
      `select entity_id::text entity, held_on::text "day", summary from meetings.meeting where source = 'calendar' and held_on between '2026-09-20' and '2026-09-23' order by held_on, entity_id::text`);
    check('Calendar: the addresses Affinity holds for a person match by address (the person and their LP firm), and their domain matches the firm, as do the domains on a firm’s Affinity record, never by name; an address only on an older copy of the record does not count',
      JSON.stringify(affRows.map((x) => [x.day, x.entity, x.summary])) === JSON.stringify([['2026-09-20', rhea, null], ['2026-09-20', kestrel, null], ['2026-09-21', kestrel, null], ['2026-09-23', osprey, null]].sort((a, b) => `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`))),
      JSON.stringify(affRows.map((x) => [x.day, x.entity === kestrel ? 'kestrel' : x.entity === rhea ? 'rhea' : x.entity === osprey ? 'osprey' : x.entity, x.summary ? 'by name' : ''])));
    check('Calendar: a read counts its coverage: outside guests and those known, meetings with an outside guest and those no LP matched',
      affRead.matched + affRead.unmatchedExternal === affRead.externalEvents && affRead.unmatchedExternal >= 1 && affRead.guestsKnown >= 3 && affRead.guestsKnown < affRead.guests
        && (await db.one<{ note: string }>(`select note from sources.sync_run where source = 'calendar' order by id desc limit 1`))!.note.includes(`${affRead.guestsKnown} of ${affRead.guests} outside guests known`),
      JSON.stringify({ matched: affRead.matched, guests: affRead.guests, known: affRead.guestsKnown, external: affRead.externalEvents, unmatched: affRead.unmatchedExternal }));

    // Juan, 13 Oct 2026: "could use firm name, or person at firm". Someone currently at an LP firm, named in the entry,
    // makes the meeting the firm's (marked, undoable); someone who has left does not.
    const heron = await entity('org', 'Invented Heron Partners'), mira = await entity('person', 'Invented Mira Solberg'), gone = await entity('person', 'Invented Otis Former');
    await db.query(`insert into identity.affiliation (person_entity, org_entity, kind, role, source, as_of, certainty, ended_on) values
      ($1, $3, 'staff', 'Invented', 'fixture', now(), 'inferred', null), ($2, $3, 'staff', 'Invented', 'fixture', now(), 'inferred', '2025-01-01')`, [mira, gone, heron]);
    await db.query(`insert into strategy.pursuit (entity_id, vehicle_id, owner_id) select $1, (select id from platform.vehicle order by slug limit 1), $2::uuid`, [heron, juan.id]);
    // Possible LPs: Wren is a firm we hold (not an LP) with investor data and a domain; Juno a person we hold on a personal
    // address, with investor data; Portco a portfolio company of ours.
    const wren = await entity('org', 'Invented Wren Holdings'), juno = await entity('person', 'Invented Juno Park'), portco = await entity('org', 'Invented Portco Labs');
    await db.query(`insert into research.claim (entity_id, field, value, source, as_of, confidence) values
      ($1, 'investor_type', 'Invented family office', 'props:calendar', current_date, 'medium'), ($1, 'email_domain', 'wren-invented.example', 'props:calendar', current_date, 'medium'),
      ($2, 'email', 'juno.invented@gmail.com', 'props:calendar', current_date, 'medium'), ($2, 'aum', '100000000', 'props:calendar', current_date, 'medium'),
      ($3, 'email_domain', 'portco-invented.example', 'props:calendar', current_date, 'medium')`, [wren, juno, portco]);
    await db.query(`insert into network.portfolio (portfolio_id, vehicle_id, company_entity, company_name, source, input_hash) select 'props-cal-portco', id, $1, 'Invented Portco Labs', '{}'::jsonb, 'props-cal-portco' from platform.vehicle order by slug limit 1`, [portco]);
    const secret = (t: string) => ({ summary: `Secret ${t}`, description: 'Secret description of the meeting' });
    await fakeCalendar(dir, juan.email, { id: 'primary' }, [
      ev('affil1', '2026-09-24T15:00:00Z', [juan.email, 'someone@heron-unrelated-invented.example'], secret('coffee with Invented Mira Solberg')),
      ev('affil2', '2026-09-24T17:00:00Z', [juan.email, 'other@heron-unrelated2-invented.example'], secret('call with Invented Otis Former')),
      ev('wren1', '2026-09-25T15:00:00Z', [juan.email, 'ana@wren-invented.example'], secret('catch-up')),
      ev('wren2', '2026-10-20T15:00:00Z', [juan.email, 'ana@wren-invented.example', 'ben@wren-invented.example'], secret('fund intro')),
      ev('dom1', '2026-09-26T15:00:00Z', [juan.email, 'x@newfirm-invented.example'], secret('LP allocation chat')),
      ev('juno1', '2026-09-27T15:00:00Z', [juan.email, 'juno.invented@gmail.com'], secret('lunch')),
      ev('gmail1', '2026-09-28T15:00:00Z', [juan.email, 'unknown.invented@gmail.com'], secret('fund chat')),
      ev('portco1', '2026-09-29T15:00:00Z', [juan.email, 'ceo@portco-invented.example'], secret('fund update')),
      ev('pl1', '2026-09-30T15:00:00Z', [juan.email, 'colleague@protocol.ai'], secret('fund prep')),
      ev('team2', '2026-09-30T17:00:00Z', [juan.email, mara.email], secret('fund prep')),
      ev('vendor2', '2026-10-01T15:00:00Z', [juan.email, 'sales@vendor2-invented.example'], secret('software demo')),
    ]);
    const cRead = await sync();
    const affRows2 = await db.query<{ entity: string; day: string; summary: string | null; ref: string }>(
      `select entity_id::text entity, held_on::text "day", summary, source_ref ref from meetings.meeting where source = 'calendar' and held_on = '2026-09-24'`);
    check('Calendar: someone currently at an LP firm named in the entry makes the meeting the firm’s, marked as matched by someone at the firm; someone who has left does not',
      affRows2.length === 1 && affRows2[0]!.entity === heron && affRows2[0]!.summary === MATCHED_BY_AFFILIATE && cRead.byAffiliate === 1 && !affRows2.some((x) => x.entity === mira),
      JSON.stringify({ rows: affRows2.map((x) => [x.entity === heron ? 'heron' : x.entity === mira ? 'mira' : x.entity, x.summary === MATCHED_BY_AFFILIATE ? 'affiliate' : x.summary]), byAffiliate: cRead.byAffiliate }));
    const undoneAff = await unmatchCalendarMeeting(db, juan.id, affRows2[0]?.ref ?? '');
    const afterAff = await sync();
    check('Calendar: “Not this LP” undoes a match by someone at the firm, for good',
      undoneAff && !(await db.query(`select 1 from meetings.meeting where source = 'calendar' and held_on = '2026-09-24'`)).length && afterAff.added === 0,
      JSON.stringify({ undoneAff, added: afterAff.added }));

    const cands = await listCandidates(db);
    const byKey = new Map(cands.map((c) => [c.key, c]));
    const w = byKey.get(`entity:${wren}`), d = byKey.get('domain:newfirm-invented.example'), j = byKey.get(`entity:${juno}`);
    check('Calendar: a possible LP is proposed for an unmatched outside guest, grouped by the firm we hold at their domain, with its meetings’ dates, the guests’ domains, whether held, and reasons',
      !!w && w.held === 'org' && w.meetings.map((m) => m.day).join() === '2026-09-25,2026-10-20' && !!w.meetings[1]!.scheduledFor && !w.meetings[0]!.scheduledFor
        && w.guests.length === 2 && w.guests.every((g) => g.domain === 'wren-invented.example' && g.held === 'org')
        && w.reasons.some((r) => r.kind === 'investor_data' && r.field === 'investor_type') && w.reasons.some((r) => r.kind === 'wording' && r.keyword === 'fund')
        && !!d && d.held === null && d.entityId === null && d.reasons.some((r) => r.kind === 'wording' && r.keyword === 'LP') && d.reasons.some((r) => r.kind === 'wording' && r.keyword === 'allocation')
        && !!j && j.held === 'person' && j.reasons.some((r) => r.kind === 'investor_data' && r.field === 'aum') && j.guests[0]?.domain === 'gmail.com' && j.guests[0]?.held === 'person'
        && cands.length === cRead.candidates && cands.slice(0, 3).every((c) => c.reasons.some(strongReason)) && cands.filter((c) => c.reasons.some(strongReason)).length === 3,
      JSON.stringify({ candidates: cRead.candidates, keys: cands.map((c) => c.key.replace(wren, 'wren').replace(juno, 'juno')), wren: w && { meetings: w.meetings.map((m) => m.day), guests: w.guests, reasons: w.reasons } }));
    check('Calendar: no possible LP for Protocol Labs, our team, a portfolio company or an unheld personal address',
      !cands.some((c) => /portco|gmail|protocol/.test(c.key) || c.key === `entity:${portco}`),
      JSON.stringify(cands.map((c) => c.key)));
    const vendor = byKey.get('domain:vendor2-invented.example');
    check('Calendar: any other outside firm is a possible LP too, with only the weak reason, listed after every one with a strong reason',
      !!vendor && vendor.reasons.length === 1 && vendor.reasons[0]!.kind === 'outside' && cands.findIndex((c) => !c.reasons.some(strongReason)) >= 3,
      JSON.stringify(cands.map((c) => [c.key.replace(wren, 'wren').replace(juno, 'juno'), c.reasons.map((r) => r.kind)])));
    const asideSum = Object.values(cRead.setAside).reduce((x, y) => x + y, 0);
    check('Calendar: every unmatched meeting with an outside guest is in a possible LP or counted by why it was set aside',
      cRead.candidateMeetings + asideSum === cRead.unmatchedExternal && cRead.setAside.portfolio >= 1 && cRead.setAside.personalMail >= 1,
      JSON.stringify({ unmatched: cRead.unmatchedExternal, inCandidates: cRead.candidateMeetings, setAside: cRead.setAside }));
    const stored = (await db.query<{ data: unknown; body: string }>(`select data, body from research.note where kind = 'calendar_candidate'`)).map((n) => JSON.stringify(n));
    check('Calendar: a possible LP keeps no title or description text, and no guest’s address or name',
      stored.length === cRead.candidates && stored.every((n) => !/Secret|coffee|catch-up|intro|lunch|chat|@|\bana\b|\bben\b|juno\.invented|Wren Holdings|Juno Park/i.test(n)),
      stored.map((n) => n.slice(0, 160)).join(' | '));
    const runNote = (await db.one<{ note: string }>(`select note from sources.sync_run where source = 'calendar' order by id desc limit 1`))!.note;
    check('Calendar: the run note counts possible LPs, never a name or address', runNote.includes(`${cRead.candidates} possible LPs`) && !/Wren|Juno|newfirm|invented/i.test(runNote), runNote);

    // "Not an LP" is remembered: the next read does not propose it again.
    let refusedNoName = false;
    const vehicleId = (await db.one<{ id: string }>(`select id::text from platform.vehicle where phase = 'active' and kind <> 'grant_rail' order by slug limit 1`))!.id;
    try { await addCandidate(db, juan.id, { key: 'domain:newfirm-invented.example', vehicleId, requestKey: 'props-cal-noname' }); } catch (e) { refusedNoName = e instanceof CandidateRefused; }
    await dismissCandidate(db, juan.id, 'domain:newfirm-invented.example');
    const afterDismiss = await sync();
    check('Calendar: “Not an LP” is remembered across a re-read; a firm known only by its domain needs its name before it can be added',
      refusedNoName && !(await listCandidates(db)).some((c) => c.key === 'domain:newfirm-invented.example') && afterDismiss.candidates === cRead.candidates - 1
        && !(await db.query(`select 1 from research.note where kind = 'calendar_candidate' and data->>'key' = 'domain:newfirm-invented.example'`)).length,
      JSON.stringify({ refusedNoName, candidates: afterDismiss.candidates }));

    // "Add as LP prospect": a pursuit in New with the meetings as its calendar touchpoints; the same request again adds nothing; undo removes both.
    const pursuitsOf = () => db.query<{ id: string; status: string; source: string }>(`select pursuit_id::text id, status::text, source from strategy.pursuit where entity_id = $1`, [wren]);
    const wrenMeetings = () => db.query<{ ref: string }>(`select source_ref ref from meetings.meeting where source = 'calendar' and entity_id = $1`, [wren]);
    const added = await addCandidate(db, juan.id, { key: `entity:${wren}`, vehicleId, requestKey: 'props-cal-add-1' });
    const twice = await addCandidate(db, juan.id, { key: `entity:${wren}`, vehicleId, requestKey: 'props-cal-add-1' });
    const p1 = await pursuitsOf(), m1 = await wrenMeetings();
    const audit = await db.query<{ action: string }>(`select action from platform.audit_log where subject_id = $1`, [added.pursuitId]);
    check('Calendar: “Add as LP prospect” opens one pursuit in New with the meetings as its calendar touchpoints, audited; the same request again adds nothing; it leaves the list',
      added.created && !twice.created && twice.pursuitId === added.pursuitId && p1.length === 1 && p1[0]!.status === 'new' && p1[0]!.source === 'calendar'
        && m1.length === 2 && audit.some((a) => a.action === 'pursuit.calendar_added') && !(await listCandidates(db)).some((c) => c.key === `entity:${wren}`),
      JSON.stringify({ added, twice: twice.created, pursuits: p1.length, meetings: m1.length }));
    await undoCandidateAdd(db, juan.id, added.pursuitId);
    check('Calendar: undoing “Add as LP prospect” removes the pursuit and its meetings, and lists the possible LP again',
      !(await pursuitsOf()).length && !(await wrenMeetings()).length && (await listCandidates(db)).some((c) => c.key === `entity:${wren}`)
        && (await db.query(`select 1 from platform.audit_log where action = 'pursuit.calendar_added_undone' and subject_id = $1`, [added.pursuitId])).length === 1,
      JSON.stringify({ pursuits: (await pursuitsOf()).length, meetings: (await wrenMeetings()).length }));
    const again2 = await addCandidate(db, juan.id, { key: `entity:${wren}`, vehicleId, requestKey: 'props-cal-add-2' });
    const reread2 = await sync();
    check('Calendar: once added, the next read keeps its meetings as the firm’s and proposes it no more',
      again2.created && (await wrenMeetings()).length === 2 && !(await listCandidates(db)).some((c) => c.key === `entity:${wren}`) && reread2.candidates === cRead.candidates - 2,
      JSON.stringify({ meetings: (await wrenMeetings()).length, candidates: reread2.candidates }));
    const research = await researchCandidate(db, juan.id, `entity:${juno}`, 'props-cal-research');
    const researchAgain = await researchCandidate(db, juan.id, `entity:${juno}`, 'props-cal-research-2');
    const req = await db.query<{ data: { workflow: string; execution: string; publicNameOnly: boolean } }>(`select data from research.note where kind = 'workflow_request' and entity_id = $1`, [juno]);
    let refusedDomain = false;
    try { await researchCandidate(db, juan.id, 'domain:newfirm-invented.example', 'props-cal-research-3'); } catch (e) { refusedDomain = e instanceof CandidateRefused; }
    check('Calendar: “Research” asks once for the profile workflow by public name, starts nothing, and is refused for a domain we hold no name for',
      research.created && !researchAgain.created && req.length === 1 && req[0]!.data.workflow === 'research' && req[0]!.data.execution === 'not_started' && req[0]!.data.publicNameOnly && refusedDomain,
      JSON.stringify({ research, again: researchAgain, requests: req.length, refusedDomain }));

    // A meeting that is Affinity's for one LP and new for another keeps the new one: a second read adds and removes nothing.
    await fakeCalendar(dir, juan.email, { id: 'primary' }, [ev('both1', '2026-09-04T17:00:00Z', [juan.email, 'otto@invented-cal.example', 'lena@invented-cal.example'])]);
    const firstRead = await sync(), second = await sync();
    const both = await db.query<{ entity: string }>(`select entity_id::text entity from meetings.meeting where source = 'calendar' and held_on = '2026-09-04'`);
    check('Calendar: a read with no calendar change adds and removes nothing, even for a meeting that is already Affinity’s for one of its LPs',
      firstRead.affinity >= 1 && both.length === 2 && both.every((x) => x.entity === lena || x.entity === firm) && second.added === 0 && second.removed === 0,
      JSON.stringify({ first: [firstRead.added, firstRead.removed, firstRead.affinity], second: [second.added, second.removed], rows: both.length }));

    // An invite from outside that nobody here accepted is not a meeting held, and a guest who declined is not a guest
    // (red team, 17 Oct 2026): neither adds a touchpoint, so Reconciliation records no rung for it.
    const lenaAt = (id: string, day: string, mine: string) => ev(id, `${day}T15:00:00Z`, [], { organizer: { email: 'lena@invented-cal.example' },
      attendees: [{ email: 'lena@invented-cal.example', organizer: true, responseStatus: 'accepted' }, { email: juan.email, self: true, responseStatus: mine }] });
    const declinedGuest = ev('dec1', '2026-09-23T15:00:00Z', [], { organizer: { email: juan.email, self: true },
      attendees: [{ email: juan.email, self: true, organizer: true, responseStatus: 'accepted' }, { email: 'lena@invented-cal.example', responseStatus: 'declined' }] });
    // Sent to a group address: the holder is on no guest line, so no answer of theirs is on it.
    const toGroup = ev('grp1', '2026-09-24T15:00:00Z', [], { organizer: { email: 'lena@invented-cal.example' },
      attendees: [{ email: 'lena@invented-cal.example', organizer: true, responseStatus: 'accepted' }, { email: 'everyone@invented-group.example', responseStatus: 'needsAction' }] });
    await fakeCalendar(dir, juan.email, { id: 'primary' }, [lenaAt('inv1', '2026-09-20', 'needsAction'), lenaAt('inv2', '2026-09-21', 'declined'), lenaAt('inv3', '2026-09-22', 'accepted'), declinedGuest, toGroup]);
    await sync();
    const invites = async () => db.query<{ day: string }>(`select held_on::text "day" from meetings.meeting where source = 'calendar' and held_on between '2026-09-20' and '2026-09-24' and entity_id = any($1::uuid[]) order by 1`, [[lena, firm]]);
    const inv = await invites();
    await fakeCalendar(dir, juan.email, { id: 'primary' }, [lenaAt('inv3', '2026-09-22', 'needsAction')]);
    const unaccepted = await sync();
    const invAfter = await invites();
    check('Calendar: an outside invite counts only once someone here accepts it; an unanswered or declined one, one sent to a group address, or a guest who declined, adds no meeting, and one no longer accepted goes',
      inv.length === 2 && inv.every((x) => x.day === '2026-09-22') && unaccepted.complete && !invAfter.length,
      JSON.stringify({ first: inv.map((x) => x.day), invAfter: invAfter.map((x) => x.day) }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
