import { createHash } from 'node:crypto';
import { aboutRaise, type AboutVehicle } from '@/lib/connectors/affinity/about';
import { checkedClient, KeyRefused, keyFor, mailguardRuntime, MailguardError, NotConnected, type RuntimeState } from '@/lib/connectors/mailguard';
import type { CalendarEvent, MailguardClient } from '@/lib/connectors/mailguard/client';
import type { Db, Queryable } from '@/lib/db';
import type { ImportProgress } from '@/lib/import-jobs/types';
import { appendAudit } from '@/modules/platform';
import { finishRun, startRun } from '@/modules/sources';

/**
 * Meetings from each person's Google Calendar, next to the LPs they were with (issue 0021; Juan, 8 Oct 2026:
 * "1 - yes" to reading calendars, read only). Through mailguard with the person's own key, which must hold
 * calendar.read and nothing that emails anyone (lib/connectors/mailguard/scope.ts); the client has no write.
 *
 * Each occurrence in the window, seen in anyone's calendar, becomes one touchpoint per LP whose address is on
 * it: source 'calendar', keyed by the event and the LP, so reading again changes nothing. As with Affinity's
 * (lib/connectors/affinity/translate.ts), nothing is copied but the date, who on the team was there, and what
 * it is about: no title, no description, no outside guest's name. A meeting Affinity already has for that LP
 * that day is Affinity's, and a calendar row it duplicates is removed. Cancelled meetings, and, after a read
 * of every calendar, meetings no longer there, are removed too. Reconciliation then reads them (lib/reconcile).
 */

/** GUESS: "about 18 months back and 90 days ahead" (calendar-requirements.md §3). */
export const CALENDAR_WINDOW = { pastDays: 548, futureDays: 90 };
/** GUESS: 40 pages of 250 is 10,000 occurrences a calendar in the window; more is not a person's calendar. */
const MAX_PAGES = 40;
const DAY = 86_400_000;

export interface CalendarSyncResult {
  people: number;
  /** People whose calendars were not read, and why: a state, never an address. */
  skipped: Array<{ handle: string; why: string }>;
  calendars: number;
  events: number;
  /** Occurrences with someone outside the team on record. */
  matched: number;
  added: number;
  updated: number;
  /** Already Affinity's, for that LP that day. */
  affinity: number;
  removed: number;
  /** Every connected calendar was read whole, so a meeting no longer in any was removed. */
  complete: boolean;
  window: { from: string; to: string };
}

interface Seen { event: CalendarEvent; holders: Set<string> }

const startOf = (e: CalendarEvent) => (e.start.dateTime ? new Date(e.start.dateTime) : e.start.date ? new Date(`${e.start.date}T00:00:00Z`) : null);
/** One occurrence across everyone's calendars: Google keeps one iCalUID for an event in every guest's calendar. */
const keyOf = (e: CalendarEvent, start: Date) => createHash('sha256').update(`${e.iCalUID ?? e.id}\u0000${start.toISOString()}`).digest('hex').slice(0, 24);
const NOT_A_PERSON = /(@resource\.calendar\.google\.com|@group\.calendar\.google\.com|@group\.v\.calendar\.google\.com|@import\.calendar\.google\.com)$/;

/** The people on record behind addresses (email claims, never Dakota's licensed ones) and each one's current firms. */
async function partiesOf(addresses: string[], q: Queryable): Promise<Map<string, { person: string; firms: string[] }>> {
  const out = new Map<string, { person: string; firms: string[] }>();
  if (!addresses.length) return out;
  const people = await q.query<{ email: string; id: string }>(`select distinct on (lower(trim(c.value))) lower(trim(c.value)) email, identity.canonical_entity_id(c.entity_id)::text id
      from research.claim c left join research.source_doc d on d.doc_id = c.source
     where c.superseded_by is null and c.field ~ '(^|\\.)email$' and lower(trim(c.value)) = any($1::text[])
       and c.source !~* '^dakota' and coalesce(d.origin, '') !~* 'dakota'
     order by lower(trim(c.value)), c.entity_id`, [addresses]);
  if (!people.length) return out;
  const firms = await q.query<{ person: string; firm: string }>(`select distinct identity.canonical_entity_id(person_entity)::text person, identity.canonical_entity_id(org_entity)::text firm
      from identity.affiliation where ended_on is null and identity.canonical_entity_id(person_entity) = any($1::uuid[])`, [[...new Set(people.map((p) => p.id))]]);
  for (const p of people) out.set(p.email, { person: p.id, firms: firms.filter((f) => f.person === p.id).map((f) => f.firm).sort() });
  return out;
}

/** Read one person's calendars in the window. `complete` is false when a calendar could not be read whole. */
async function readPerson(client: MailguardClient, from: string, to: string, onEvent: (e: CalendarEvent) => void): Promise<{ calendars: number; complete: boolean }> {
  let complete = true, calendars = 0;
  for (const cal of await client.calendars()) {
    if (cal.accessRole === 'freeBusyReader') continue; // busy times only: no meetings to read
    calendars++;
    let token: string | null = null, pages = 0;
    try {
      do {
        const page = await client.events(cal.id, { timeMin: from, timeMax: to, pageToken: token, max: 250 });
        if (!page) { complete = false; break; }
        page.events.forEach(onEvent);
        token = page.nextPageToken;
      } while (token && ++pages < MAX_PAGES);
      if (token) complete = false;
    } catch (e) {
      if (!(e instanceof MailguardError)) throw e;
      complete = false;
    }
  }
  return { calendars, complete };
}

export async function syncCalendars(db: Db, actor: string, o: { runtime?: RuntimeState; now?: Date; progress?: ImportProgress } = {}): Promise<CalendarSyncResult | { off: string }> {
  const rt = o.runtime ?? mailguardRuntime();
  if (rt.mode === 'off') return { off: rt.why };
  const now = o.now ?? new Date();
  const from = new Date(now.getTime() - CALENDAR_WINDOW.pastDays * DAY), to = new Date(now.getTime() + CALENDAR_WINDOW.futureDays * DAY);
  const r: CalendarSyncResult = { people: 0, skipped: [], calendars: 0, events: 0, matched: 0, added: 0, updated: 0, affinity: 0, removed: 0, complete: true,
    window: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) } };
  const run = await startRun('calendar', 'read', actor);
  try {
    const users = await db.query<{ id: string; handle: string; name: string }>(`select id::text, handle, name from platform.app_user where active and role <> 'system' order by handle`);
    const seen = new Map<string, Seen>();
    const cancelled = new Set<string>();
    let i = 0;
    for (const u of users) {
      await o.progress?.('Reading calendars', i++, users.length);
      if (!(await keyFor(rt, u.handle))) continue;
      r.people++;
      let client: MailguardClient;
      try {
        const c = await checkedClient(rt, u.handle);
        if (c.inspection.calendar.state !== 'ok') { r.skipped.push({ handle: u.handle, why: c.inspection.calendar.state }); r.complete = false; continue; }
        client = c.client;
      } catch (e) {
        if (e instanceof KeyRefused) { r.skipped.push({ handle: u.handle, why: e.inspection.code }); r.complete = false; continue; }
        if (e instanceof NotConnected) continue;
        throw e;
      }
      try {
        const got = await readPerson(client, from.toISOString(), to.toISOString(), (e) => {
          const start = startOf(e);
          if (!start) return;
          const k = keyOf(e, start);
          if (e.status === 'cancelled') { cancelled.add(k); return; }
          const s = seen.get(k) ?? { event: e, holders: new Set<string>() };
          // A guest's copy can lack the description the organizer's has: keep the fuller one.
          if (!s.event.description && e.description) s.event = e;
          s.holders.add(u.id);
          seen.set(k, s);
        });
        r.calendars += got.calendars;
        if (!got.complete) r.complete = false;
      } catch (e) {
        if (!(e instanceof MailguardError)) throw e;
        r.skipped.push({ handle: u.handle, why: e.kind });
        r.complete = false;
      }
    }
    for (const k of seen.keys()) cancelled.delete(k);
    // Nobody's calendar read is not a read of every calendar: nothing is removed for being gone.
    if (!r.people || r.people === r.skipped.length) r.complete = false;
    r.events = seen.size;
    await o.progress?.('Matching guests to LPs', users.length, users.length + 1);

    const team = new Map((await db.query<{ email: string; id: string; name: string }>(`select lower(trim(a.address)) email, u.id::text, u.name from platform.user_address a
        join platform.app_user u on u.id = a.user_id where u.role <> 'system'
      union select lower(trim(email)) email, id::text, name from platform.app_user where coalesce(trim(email), '') <> '' and role <> 'system'`)).map((t) => [t.email, t]));
    const nameOf = new Map(users.map((u) => [u.id, u.name]));
    const outsideOf = (e: CalendarEvent) => [...new Set([e.organizer?.email, ...e.attendees.filter((a) => !a.resource).map((a) => a.email)]
      .filter((a): a is string => !!a && !team.has(a) && !NOT_A_PERSON.test(a)))];
    const parties = await partiesOf([...new Set([...seen.values()].flatMap((s) => outsideOf(s.event)))], db);
    const vehicles = await db.query<AboutVehicle>(`select slug, name, coalesce(aliases, '{}') aliases from platform.vehicle`);
    const affinity = new Set((await db.query<{ k: string }>(`select identity.canonical_entity_id(entity_id)::text || '|' || coalesce(held_on, scheduled_for::date)::text k
        from meetings.meeting where source <> 'calendar' and source <> 'us' and channel in ('meeting', 'call')
         and coalesce(held_on, scheduled_for::date) between $1::date and $2::date`, [r.window.from, r.window.to])).map((x) => x.k));

    const rows: Array<Record<string, unknown>> = [];
    const twins = new Set<string>();
    for (const [k, { event: e, holders }] of seen) {
      const found = outsideOf(e).map((a) => parties.get(a)).filter((p): p is { person: string; firms: string[] } => !!p);
      if (!found.length) continue;
      r.matched++;
      const start = startOf(e)!;
      const day = e.start.date ?? start.toISOString().slice(0, 10);
      const future = start.getTime() > now.getTime();
      const inTeam = [e.organizer?.email, ...e.attendees.map((a) => a.email)].map((a) => (a ? team.get(a) : undefined)).filter((t): t is { email: string; id: string; name: string } => !!t);
      const organizer = e.organizer?.email ? team.get(e.organizer.email)?.id : undefined;
      const owner = organizer ?? [...holders][0]!;
      const attendees = [...new Set([...inTeam.map((t) => t.name), ...[...holders].map((h) => nameOf.get(h)!)])].sort();
      // Parties, as Affinity counts them (N81): a firm, or a person with none. Four or more is an event.
      const groupSize = new Set(found.map((p) => p.firms[0] ?? p.person)).size;
      const about = aboutRaise(`${e.summary} ${e.description ?? ''}`, [e.organizer?.email, ...e.attendees.map((a) => a.email)], vehicles, []);
      for (const entity of [...new Set(found.flatMap((p) => [p.person, ...p.firms]))].sort()) {
        if (affinity.has(`${entity}|${day}`)) { r.affinity++; twins.add(k); continue; }
        rows.push({ entity_id: entity, held_on: future ? null : day, scheduled_for: future ? start.toISOString() : null, owner_id: owner, attendees,
          ref: `event:${k}:${entity}`, about: about.about, about_vehicles: about.vehicles, about_basis: about.basis, group_size: groupSize });
      }
    }

    await o.progress?.('Writing meetings', users.length + 1, users.length + 1);
    await db.transaction(async (tx) => {
      for (let at = 0; at < rows.length; at += 500) {
        const res = await tx.query<{ fresh: boolean }>(`insert into meetings.meeting
            (entity_id, channel, direction, held_on, scheduled_for, owner_id, attendees, source, source_ref, about, about_vehicles, about_basis, about_by, group_size)
          select x.entity_id, 'meeting', 'both', x.held_on, x.scheduled_for, x.owner_id, x.attendees, 'calendar', x.ref, x.about, x.about_vehicles, x.about_basis, 'rule', x.group_size
            from jsonb_to_recordset($1::jsonb) as x(entity_id uuid, held_on date, scheduled_for timestamptz, owner_id uuid, attendees text[], ref text,
                                                    about text, about_vehicles text[], about_basis text, group_size int)
          on conflict (source, source_ref) where source_ref is not null do update set
            entity_id = excluded.entity_id, held_on = excluded.held_on, scheduled_for = excluded.scheduled_for, owner_id = excluded.owner_id,
            attendees = excluded.attendees, about = excluded.about, about_vehicles = excluded.about_vehicles, about_basis = excluded.about_basis,
            group_size = excluded.group_size
          returning (xmax = 0) as fresh`, [JSON.stringify(rows.slice(at, at + 500))]);
        for (const x of res) if (x.fresh) r.added++; else r.updated++;
      }
      // Gone: cancelled, now Affinity's, and — only when every calendar was read whole — no longer in any.
      const gone = await tx.query<{ n: number }>(`with d as (delete from meetings.meeting
          where source = 'calendar' and (split_part(source_ref, ':', 2) = any($1::text[])
             or ($2 and coalesce(held_on, scheduled_for::date) between $3::date and $4::date and not (source_ref = any($5::text[]))))
          returning 1) select count(*)::int n from d`,
        [[...cancelled, ...twins], r.complete, r.window.from, r.window.to, rows.map((x) => x.ref as string)]);
      r.removed = gone[0]?.n ?? 0;
    });
    if (r.added || r.removed) await (await import('@/lib/reconcile')).reconcile(actor);

    const counts = { people: r.people, skipped: r.skipped.length, calendars: r.calendars, events: r.events, matched: r.matched, added: r.added, updated: r.updated, affinity: r.affinity, removed: r.removed, complete: r.complete };
    await appendAudit({ actorId: actor, action: 'calendar.read', subjectType: 'source', detail: { ...counts, skippedWhy: r.skipped.map((s) => s.why) } }, db);
    await finishRun(run, { status: 'ok', requests: 0, records: r.events, newRecords: r.added,
      note: `${r.people} people's calendars (${r.calendars} calendars${r.skipped.length ? `, ${r.skipped.length} people not read` : ''}) · ${r.events} meetings, ${r.matched} with an LP on record · ${r.added} new, ${r.updated} kept, ${r.affinity} already Affinity's, ${r.removed} removed${r.complete ? '' : ' · not every calendar was read whole, so none was removed for being gone'}`,
      detail: counts });
    return r;
  } catch (e) {
    await finishRun(run, { status: 'failed', requests: 0, records: 0, newRecords: 0, note: 'Calendar read stopped; nothing from this pass was kept.' });
    throw e;
  }
}
