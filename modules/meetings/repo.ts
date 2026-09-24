import { getDb } from '@/lib/db';
import type { LadderRung } from '@/modules/strategy/client';
import type {
  Channel, DiligenceQuestion, DirectContact, Direction, Meeting, MeetingKind, Objection, ObjectionClass, ObjectionStatus,
  QuestionStatus, RaiseWindow, Read, Touchpoint, TouchpointSummary,
} from './types';
import { aboutThisRaise } from './types';

type MeetingRow = {
  meeting_id: string; pursuit_id: string | null; entity_id: string; entity_name: string;
  vehicle_name: string | null; kind: MeetingKind | null; scheduled_for: Date | string | null;
  held_on: Date | string | null; attendees: string[]; owner_name: string;
  summary: string | null; justifies_rung: LadderRung | null; justification: string | null;
};

const MEETING_SELECT = `
  select m.meeting_id, m.pursuit_id, m.entity_id, e.display_name as entity_name,
         v.name as vehicle_name, m.kind, m.scheduled_for, m.held_on, m.attendees,
         u.name as owner_name, m.summary, m.justifies_rung, m.justification
    from meetings.meeting m
    join identity.entity e on e.entity_id = m.entity_id
    left join platform.vehicle v on v.id = m.vehicle_id
    join platform.app_user u on u.id = m.owner_id`;

/**
 * The meeting pages read meetings and calls; an email is a touchpoint, not a meeting (N51). And
 * only those about a raise (N59): tied to a vehicle, logged here, or read as about a raise and
 * dated inside the window of a vehicle it names (or of any, if it names none). The same rule as
 * aboutThisRaise in ./types; change both.
 */
const MEETINGS_ONLY = `m.channel in ('meeting', 'call') and (m.vehicle_id is not null or m.source = 'us' or (m.about = 'raise'
  and exists (select 1 from platform.vehicle w
               where (w.slug = any(m.about_vehicles)
                      or (cardinality(m.about_vehicles) = 0 and (w.raise_opens_on is not null or w.raise_closes_on is not null)))
                 and (w.raise_opens_on is null or coalesce(m.held_on, m.scheduled_for::date) >= w.raise_opens_on)
                 and (w.raise_closes_on is null or coalesce(m.held_on, m.scheduled_for::date) <= w.raise_closes_on))))`;

const toMeeting = (r: MeetingRow): Meeting => ({
  meetingId: r.meeting_id, pursuitId: r.pursuit_id, entityId: r.entity_id,
  entityName: r.entity_name, vehicleName: r.vehicle_name, kind: r.kind,
  scheduledFor: r.scheduled_for ? new Date(r.scheduled_for) : null,
  heldOn: r.held_on ? new Date(r.held_on) : null,
  attendees: r.attendees ?? [], ownerName: r.owner_name, summary: r.summary,
  justifiesRung: r.justifies_rung, justification: r.justification,
});

export async function listMeetings(): Promise<Meeting[]> {
  const db = await getDb();
  return (
    await db.query<MeetingRow>(
      `${MEETING_SELECT} where ${MEETINGS_ONLY} order by coalesce(m.scheduled_for, m.held_on::timestamptz) desc nulls last`,
    )
  ).map(toMeeting);
}

export async function upcomingMeetings(): Promise<Meeting[]> {
  const db = await getDb();
  return (
    await db.query<MeetingRow>(
      // Still ahead: a scheduled meeting whose time has passed is not upcoming, whether or not
      // anyone has recorded that it happened.
      `${MEETING_SELECT} where ${MEETINGS_ONLY} and m.held_on is null and m.scheduled_for is not null
          and m.scheduled_for >= now() - interval '2 hours'
        order by m.scheduled_for`,
    )
  ).map(toMeeting);
}

type ObjectionRow = {
  objection_id: string; meeting_id: string | null; entity_id: string; entity_name: string;
  class: ObjectionClass; statement: string; status: ObjectionStatus; answer: string | null;
  answer_source: string | null; answered_by_name: string | null; answered_at: Date | string | null;
};

const OBJECTION_SELECT = `
  select o.objection_id, o.meeting_id, o.entity_id, e.display_name as entity_name,
         o.class, o.statement, o.status, o.answer, o.answer_source,
         u.name as answered_by_name, o.answered_at
    from meetings.objection o
    join identity.entity e on e.entity_id = o.entity_id
    left join platform.app_user u on u.id = o.answered_by`;

const toObjection = (r: ObjectionRow): Objection => ({
  objectionId: r.objection_id, meetingId: r.meeting_id, entityId: r.entity_id,
  entityName: r.entity_name, class: r.class, statement: r.statement, status: r.status,
  answer: r.answer, answerSource: r.answer_source, answeredByName: r.answered_by_name,
  answeredAt: r.answered_at ? new Date(r.answered_at) : null,
});

export async function listObjections(entityId?: string): Promise<Objection[]> {
  const db = await getDb();
  const rows = entityId
    ? await db.query<ObjectionRow>(`${OBJECTION_SELECT} where o.entity_id = $1 order by o.created_at`, [entityId])
    : await db.query<ObjectionRow>(`${OBJECTION_SELECT} order by o.created_at desc`);
  return rows.map(toObjection);
}

/** How often each objection class comes up, and how often it has an answer on file. */
export async function objectionTally(): Promise<Array<{ class: ObjectionClass; raised: number; answered: number }>> {
  const db = await getDb();
  const rows = await db.query<{ class: ObjectionClass; raised: string; answered: string }>(
    `select class, count(*)::text as raised,
            count(*) filter (where status in ('answered','accepted'))::text as answered
       from meetings.objection group by class order by count(*) desc`,
  );
  return rows.map((r) => ({ class: r.class, raised: Number(r.raised), answered: Number(r.answered) }));
}

type QuestionRow = {
  question_id: string; entity_id: string; entity_name: string; vehicle_name: string;
  question: string; asked_on: Date | string | null; due_on: Date | string | null;
  owner_name: string | null; status: QuestionStatus; answer: string | null;
  answer_source: string | null;
};

const QUESTION_SELECT = `
  select q.question_id, q.entity_id, e.display_name as entity_name, v.name as vehicle_name,
         q.question, q.asked_on, q.due_on, u.name as owner_name, q.status, q.answer, q.answer_source
    from meetings.diligence_question q
    join identity.entity e on e.entity_id = q.entity_id
    join platform.vehicle v on v.id = q.vehicle_id
    left join platform.app_user u on u.id = q.owner_id`;

const toQuestion = (r: QuestionRow): DiligenceQuestion => ({
  questionId: r.question_id, entityId: r.entity_id, entityName: r.entity_name,
  vehicleName: r.vehicle_name, question: r.question,
  askedOn: r.asked_on ? new Date(r.asked_on) : null,
  dueOn: r.due_on ? new Date(r.due_on) : null,
  ownerName: r.owner_name, status: r.status, answer: r.answer, answerSource: r.answer_source,
  overdue: Boolean(r.due_on && r.status === 'open' && new Date(r.due_on).getTime() < Date.now()),
});

export async function listQuestions(entityId?: string): Promise<DiligenceQuestion[]> {
  const db = await getDb();
  const rows = entityId
    ? await db.query<QuestionRow>(`${QUESTION_SELECT} where q.entity_id = $1 order by q.due_on nulls last`, [entityId])
    : await db.query<QuestionRow>(`${QUESTION_SELECT} order by (q.status <> 'open'), q.due_on nulls last`);
  return rows.map(toQuestion);
}

// ---------------------------------------------------------------- touchpoints (N51, docs/17)

type TouchRow = {
  meeting_id: string; entity_id: string; entity_name: string; vehicle_id: string | null; vehicle_name: string | null;
  channel: Channel; kind: MeetingKind | null; held_on: Date | string | null; scheduled_for: Date | string | null;
  direction: Direction | null; owner_name: string; attendees: string[] | null; summary: string | null;
  read: Read | null; read_by_name: string | null; source: string; source_ref: string | null; for_entity: string;
  about: 'raise' | 'other' | null; about_vehicles: string[] | null; about_basis: string | null;
};

/** The touchpoint columns, read through a `reach` CTE of (for_entity, entity_id). */
const TOUCH_FROM_REACH = `
  select m.meeting_id, m.entity_id, e.display_name as entity_name, m.vehicle_id, v.name as vehicle_name,
         m.channel::text as channel, m.kind::text as kind, m.held_on, m.scheduled_for, m.direction,
         u.name as owner_name, m.attendees, m.summary, m.read::text as read, rb.name as read_by_name,
         m.source, m.source_ref, r.for_entity, m.about, m.about_vehicles, m.about_basis
    from reach r
    join meetings.meeting m on m.entity_id = r.entity_id
    join identity.entity e on e.entity_id = m.entity_id
    left join platform.vehicle v on v.id = m.vehicle_id
    join platform.app_user u on u.id = m.owner_id
    left join platform.app_user rb on rb.id = m.read_by`;

/**
 * Touchpoints for a set of LPs: theirs, and their firm's — the organization they act for now —
 * because the team's record of an LP is as often on the firm as on the person (N49, measured).
 * `for_entity` says which LP each row is being read for.
 */
const TOUCH_SELECT = `
  with lp as (select unnest($1::uuid[]) as entity_id),
  reach as (
    select lp.entity_id as for_entity, lp.entity_id as entity_id from lp
    union
    select a.person_entity, a.org_entity from identity.affiliation a join lp on lp.entity_id = a.person_entity
     where a.ended_on is null
  )
  ${TOUCH_FROM_REACH}`;

/** Colleagues: the others acting now for the organisation an LP deals with us through (issue 0013). */
const COLLEAGUE_SELECT = `
  with firm as (
    select a.org_entity from identity.affiliation a
     where a.person_entity = $1::uuid and a.ended_on is null
     order by a.is_primary desc, a.as_of desc limit 1
  ),
  reach as (
    select distinct $1::uuid as for_entity, c.person_entity as entity_id
      from firm join identity.affiliation c on c.org_entity = firm.org_entity
     where c.person_entity <> $1::uuid and c.ended_on is null
  )
  ${TOUCH_FROM_REACH}`;

const day = (d: Date | string | null) => (d ? new Date(d) : null);

const toTouch = (r: TouchRow): Touchpoint => ({
  touchpointId: r.meeting_id, entityId: r.entity_id, entityName: r.entity_name,
  vehicleId: r.vehicle_id, vehicleName: r.vehicle_name, channel: r.channel, kind: r.kind,
  on: day(r.held_on), scheduledFor: day(r.scheduled_for), direction: r.direction,
  ownerName: r.owner_name, attendees: r.attendees ?? [], summary: r.summary,
  read: r.read, readByName: r.read_by_name, source: r.source, sourceRef: r.source_ref,
  viaOrganization: r.entity_id === r.for_entity ? null : r.entity_name,
  about: r.about, aboutVehicles: r.about_vehicles ?? [], aboutBasis: r.about_basis,
});

/** Each vehicle's raise window (N59), by id. */
export async function raiseWindows(): Promise<Map<string, RaiseWindow>> {
  const db = await getDb();
  const rows = await db.query<{ id: string; slug: string; name: string; opens: Date | string | null; closes: Date | string | null; note: string | null }>(
    `select id::text, slug, name, raise_opens_on as opens, raise_closes_on as closes, raise_window_note as note from platform.vehicle`,
  );
  const date = (d: Date | string | null) => (d ? new Date(`${String(d instanceof Date ? d.toISOString() : d).slice(0, 10)}T00:00:00Z`) : null);
  return new Map(rows.map((r) => [r.id, { vehicleId: r.id, slug: r.slug, name: r.name, opens: date(r.opens), closes: date(r.closes), note: r.note }]));
}

const when = (t: Touchpoint) => (t.on ?? t.scheduledFor)?.getTime() ?? 0;

/**
 * The log for one LP on one vehicle, newest first: the touchpoints about that vehicle's raise
 * (N59: tied to it, logged here, or read as about it and inside its window). `vehicleId` null:
 * every touchpoint with them, about anything — their contact history.
 */
export async function touchpointsFor(entityId: string, vehicleId: string | null): Promise<Touchpoint[]> {
  const db = await getDb();
  const rows = await db.query<TouchRow>(
    `${TOUCH_SELECT} where ($2::uuid is null or m.vehicle_id is null or m.vehicle_id = $2)`,
    [[entityId], vehicleId],
  );
  const all = rows.map(toTouch).sort((a, b) => when(b) - when(a));
  if (!vehicleId) return all;
  const w = (await raiseWindows()).get(vehicleId);
  return w ? all.filter((t) => aboutThisRaise(t, w)) : all;
}

/**
 * Touchpoints with an LP's colleagues — the others acting for the same organisation now — for
 * when the organisation is the LP we're targeting (issue 0013): a meeting with any of them on the
 * organisation's behalf belongs on its timeline. Each carries its person and the organisation in
 * `viaOrganization`, so it is shown with who it was with and summed apart: it is the
 * organisation's record, not evidence for this person's own rungs.
 */
export async function colleagueTouchpointsFor(entityId: string, vehicleId: string | null): Promise<Touchpoint[]> {
  const db = await getDb();
  const rows = await db.query<TouchRow>(
    `${COLLEAGUE_SELECT} where ($2::uuid is null or m.vehicle_id is null or m.vehicle_id = $2)`,
    [entityId, vehicleId],
  );
  const org = (await db.one<{ name: string }>(
    `select o.display_name as name from identity.affiliation a join identity.entity o on o.entity_id = a.org_entity
      where a.person_entity = $1::uuid and a.ended_on is null order by a.is_primary desc, a.as_of desc limit 1`, [entityId]))?.name ?? null;
  const all = rows.map(toTouch).map((t) => ({ ...t, viaOrganization: org ? `${t.entityName}, ${org}` : t.entityName })).sort((a, b) => when(b) - when(a));
  if (!vehicleId) return all;
  const w = (await raiseWindows()).get(vehicleId);
  return w ? all.filter((t) => aboutThisRaise(t, w)) : all;
}

/**
 * What the log adds up to. Pure: the pipeline and the LP page both read it from here. Only the
 * LP's own touchpoints count; their firm's are summed apart, and shown in the log with the
 * firm's name (N55).
 */
export function summarize(all: Touchpoint[], now = new Date()): TouchpointSummary {
  const touches = all.filter((t) => !t.viaOrganization);
  const firm = all.filter((t) => t.viaOrganization);
  const held = touches.filter((t) => t.on && t.on.getTime() <= now.getTime());
  const contact = held.filter((t) => t.channel !== 'research');
  const meetings = held.filter((t) => t.channel === 'meeting' || t.channel === 'call').map((t) => t.on!);
  // One meeting recorded twice — a note and a calendar entry for the same day — is one meeting.
  const days = [...new Set(meetings.map((d) => d.toISOString().slice(0, 10)))].sort().map((d) => new Date(`${d}T00:00:00Z`));
  const last = contact.reduce<Touchpoint | null>((a, t) => (!a || when(t) > when(a) ? t : a), null);
  const fromThem = contact.filter((t) => t.direction === 'theirs' || t.direction === 'both');
  const lastFromThem = fromThem.reduce<Date | null>((a, t) => (!a || t.on! > a ? t.on! : a), null);
  const ours = contact.filter((t) => t.direction === 'ours' && (!lastFromThem || t.on! > lastFromThem));
  const awaitingSince = ours.reduce<Date | null>((a, t) => (!a || t.on! < a ? t.on! : a), null);
  const upcoming = touches
    .filter((t) => !t.on && t.scheduledFor && t.scheduledFor.getTime() > now.getTime())
    .reduce<Date | null>((a, t) => (!a || t.scheduledFor! < a ? t.scheduledFor! : a), null);
  const withRead = held.filter((t) => t.read).sort((a, b) => when(b) - when(a))[0];
  const research = held.filter((t) => t.channel === 'research').reduce<Date | null>((a, t) => (!a || t.on! > a ? t.on! : a), null);
  return {
    meetingDates: days,
    lastTouch: last?.on ?? null,
    lastTouchChannel: last?.channel ?? null,
    lastFromThem,
    awaitingSince,
    nextMeeting: upcoming,
    read: withRead ? { read: withRead.read!, on: withRead.on, byName: withRead.readByName } : null,
    lastResearched: research,
    total: touches.length,
    withFirm: {
      total: firm.length,
      lastTouch: firm.filter((t) => t.on && t.on.getTime() <= now.getTime()).reduce<Date | null>((a, t) => (!a || t.on! > a ? t.on! : a), null),
      nextMeeting: firm.filter((t) => !t.on && t.scheduledFor && t.scheduledFor.getTime() > now.getTime())
        .reduce<Date | null>((a, t) => (!a || t.scheduledFor! < a ? t.scheduledFor! : a), null),
    },
  };
}

/**
 * The touchpoints of many pursuits at once, keyed `${entityId}:${vehicleId}`: each LP's own and
 * their firm's, about that vehicle or none in particular. One query for the lot.
 */
export async function touchpointsByPair(
  pairs: Array<{ entityId: string; vehicleId: string }>,
): Promise<Map<string, Touchpoint[]>> {
  const out = new Map<string, Touchpoint[]>();
  if (!pairs.length) return out;
  const db = await getDb();
  const rows = (await db.query<TouchRow>(TOUCH_SELECT, [[...new Set(pairs.map((p) => p.entityId))]])).map((r) => ({ r, t: toTouch(r) }));
  const byEntity = new Map<string, Touchpoint[]>();
  for (const { r, t } of rows) byEntity.set(r.for_entity, [...(byEntity.get(r.for_entity) ?? []), t]);
  const windows = await raiseWindows();
  for (const p of pairs) {
    const w = windows.get(p.vehicleId);
    out.set(`${p.entityId}:${p.vehicleId}`, (byEntity.get(p.entityId) ?? [])
      .filter((t) => (w ? aboutThisRaise(t, w) : !t.vehicleId || t.vehicleId === p.vehicleId)));
  }
  return out;
}

/** Summaries for many pursuits at once — the pipeline list — keyed `${entityId}:${vehicleId}`. */
export async function touchpointSummaries(
  pairs: Array<{ entityId: string; vehicleId: string }>, now = new Date(),
  touches?: Map<string, Touchpoint[]>,
): Promise<Map<string, TouchpointSummary>> {
  const out = new Map<string, TouchpointSummary>();
  if (!pairs.length) return out;
  const byPair = touches ?? await touchpointsByPair(pairs);
  for (const p of pairs) {
    const key = `${p.entityId}:${p.vehicleId}`;
    out.set(key, summarize(byPair.get(key) ?? [], now));
  }
  return out;
}


/**
 * The latest direct contact with each of a set of people and organisations (issue 0027, real): a
 * meeting or call held, or a message from them, dated today or before. A person counts by their own
 * record only — a meeting with a colleague is not a meeting with them (N55). An organisation
 * counts through the people acting for it now, and says whom.
 */
export async function directContact(entityIds: string[]): Promise<Map<string, DirectContact>> {
  const out = new Map<string, DirectContact>();
  if (!entityIds.length) return out;
  const db = await getDb();
  const rows = await db.query<{ for_entity: string; held_on: Date | string; met: boolean; via: string | null }>(
    `with t as (select unnest($1::uuid[]) as entity_id),
     reach as (
       select t.entity_id as for_entity, t.entity_id as entity_id from t
       union
       select a.org_entity, a.person_entity from identity.affiliation a join t on t.entity_id = a.org_entity
        where a.ended_on is null
     )
     select distinct on (r.for_entity) r.for_entity::text, m.held_on, m.channel in ('meeting', 'call') as met,
            case when m.entity_id = r.for_entity then null else e.display_name end as via
       from reach r
       join meetings.meeting m on m.entity_id = r.entity_id
       join identity.entity e on e.entity_id = m.entity_id
      where m.held_on is not null and m.held_on <= current_date
        and (m.channel in ('meeting', 'call') or m.direction in ('theirs', 'both'))
      order by r.for_entity, m.held_on desc, (m.entity_id = r.for_entity) desc`,
    [entityIds],
  );
  for (const r of rows) out.set(r.for_entity, { on: new Date(r.held_on), how: r.met ? 'met' : 'heard', via: r.via });
  return out;
}
