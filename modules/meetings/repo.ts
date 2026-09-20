import { getDb } from '@/lib/db';
import type { LadderRung } from '@/modules/strategy/client';
import type {
  DiligenceQuestion, Meeting, MeetingKind, Objection, ObjectionClass, ObjectionStatus, QuestionStatus,
} from './types';

type MeetingRow = {
  meeting_id: string; pursuit_id: string | null; entity_id: string; entity_name: string;
  vehicle_name: string; kind: MeetingKind; scheduled_for: Date | string | null;
  held_on: Date | string | null; attendees: string[]; owner_name: string;
  summary: string | null; justifies_rung: LadderRung | null; justification: string | null;
};

const MEETING_SELECT = `
  select m.meeting_id, m.pursuit_id, m.entity_id, e.display_name as entity_name,
         v.name as vehicle_name, m.kind, m.scheduled_for, m.held_on, m.attendees,
         u.name as owner_name, m.summary, m.justifies_rung, m.justification
    from meetings.meeting m
    join identity.entity e on e.entity_id = m.entity_id
    join platform.vehicle v on v.id = m.vehicle_id
    join platform.app_user u on u.id = m.owner_id`;

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
      `${MEETING_SELECT} order by coalesce(m.scheduled_for, m.held_on::timestamptz) desc nulls last`,
    )
  ).map(toMeeting);
}

export async function upcomingMeetings(): Promise<Meeting[]> {
  const db = await getDb();
  return (
    await db.query<MeetingRow>(
      `${MEETING_SELECT} where m.held_on is null and m.scheduled_for is not null
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
