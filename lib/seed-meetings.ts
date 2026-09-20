import type { Db } from './db';

/**
 * L11 seed: two meetings that happened, one that is scheduled, and the objections and
 * diligence questions they produced.
 *
 * The Northwood meeting is the interesting one: it justifies "meeting held" and nothing
 * above it, and the seeded STAGE ticket asks for a rung the meeting does not support.
 */
export async function seedMeetings(db: Db): Promise<{ meetings: number; objections: number; questions: number }> {
  const existing = await db.one<{ n: string }>('select count(*)::text as n from meetings.meeting');
  if (existing && Number(existing.n) > 0) return { meetings: 0, objections: 0, questions: 0 };

  const users = await db.query<{ id: string; handle: string }>('select id, handle from platform.app_user');
  const entities = await db.query<{ entity_id: string; display_name: string }>(
    'select entity_id, display_name from identity.entity',
  );
  const vehicles = await db.query<{ id: string; slug: string }>('select id, slug from platform.vehicle');
  const pursuits = await db.query<{ pursuit_id: string; entity_id: string; vehicle_id: string }>(
    'select pursuit_id, entity_id, vehicle_id from strategy.pursuit',
  );
  const u = (h: string) => users.find((x) => x.handle === h)!.id;
  const e = (n: string) => entities.find((x) => x.display_name === n)!.entity_id;
  const neurotech = vehicles.find((x) => x.slug === 'neurotech')!.id;
  const pursuitOf = (entity: string) =>
    pursuits.find((p) => p.entity_id === e(entity) && p.vehicle_id === neurotech)?.pursuit_id ?? null;
  const on = (iso: string) => new Date(`${iso}T14:00:00Z`);

  let objections = 0;
  let questions = 0;

  await db.transaction(async (tx) => {
    const meetings: Array<{
      entity: string; kind: string; held?: string; scheduled?: string; attendees: string[];
      owner: string; summary?: string; rung?: string; justification?: string;
      objections?: Array<{ class: string; statement: string; status: string; answer?: string; source?: string; by?: string }>;
    }> = [
      {
        entity: 'Cedar Trust', kind: 'pitch', held: '2026-08-20',
        attendees: ['Ivo Lindqvist', 'two of the investment team', 'Mara Vance', 'Juan'],
        owner: 'mara',
        summary: 'Full pitch. Thesis landed; the questions were all about structure and fees.',
        rung: 'meeting_held',
        justification: 'A meeting happened, with a date and a list of who was in it. Nothing was indicated.',
        objections: [
          { class: 'terms', statement: 'Fee load is above what their committee has approved for emerging managers.', status: 'answered', answer: 'Fee break at $4M and above, documented in the side-letter template.', source: 'doc:side-letter-template-v3', by: 'tomas' },
          { class: 'track_record', statement: 'First-time fund with no realised exits.', status: 'answered', answer: 'Three prior vehicles at the operating company, with audited marks.', source: 'doc:track-record-2026', by: 'juan' },
          { class: 'liquidity', statement: 'Ten-year lock is long against their spending policy.', status: 'accepted', answer: 'They accepted it after seeing the recycling provision.', source: 'doc:lpa-v4', by: 'tomas' },
        ],
      },
      {
        entity: 'Northwood Capital', kind: 'intro', held: '2026-09-08',
        attendees: ['Priya Raman', 'one analyst', 'Juan'],
        owner: 'juan',
        summary: '45 minutes. Neuro thesis and team. No terms discussed, no number mentioned by either side.',
        rung: 'meeting_held',
        justification:
          'A meeting happened. Asking for a DDQ pack is process interest, not an indication — ' +
          'so this justifies meeting held and nothing above it.',
        objections: [
          { class: 'track_record', statement: 'Wants to see the operating-company marks independently verified.', status: 'open' },
          { class: 'timing', statement: 'Their emerging-manager slots for 2026 may already be allocated.', status: 'open' },
          { class: 'governance', statement: 'Asked who else sits on the investment committee.', status: 'answered', answer: 'No external IC; decisions are the GPs with an advisory board on conflicts.', source: 'doc:lpa-v4', by: 'juan' },
        ],
      },
      {
        entity: 'Northwood Capital', kind: 'diligence', scheduled: '2026-09-24',
        attendees: ['Priya Raman', 'two analysts', 'Juan', 'Mara Vance'],
        owner: 'juan',
        summary: 'DDQ walkthrough. They asked for it on 31 August.',
      },
      {
        entity: 'Okonjo Family Office', kind: 'follow_up', scheduled: '2026-11-12',
        attendees: ['Michael Okonjo', 'Juan'],
        owner: 'juan',
        summary: 'At the neurotech conference. Costs no connector goodwill — see the signal.',
      },
    ];

    for (const m of meetings) {
      const rows = await tx.query<{ meeting_id: string }>(
        `insert into meetings.meeting
           (pursuit_id, entity_id, vehicle_id, kind, scheduled_for, held_on, attendees,
            owner_id, summary, justifies_rung, justification)
         values ($1,$2,$3,$4::meetings.meeting_kind,$5,$6::date,$7,$8,$9,
                 $10::strategy.ladder_rung,$11)
         returning meeting_id`,
        [
          pursuitOf(m.entity), e(m.entity), neurotech, m.kind,
          m.scheduled ? on(m.scheduled) : null, m.held ?? null, m.attendees,
          u(m.owner), m.summary ?? null, m.rung ?? null, m.justification ?? null,
        ],
      );
      const meetingId = rows[0]!.meeting_id;
      for (const o of m.objections ?? []) {
        await tx.query(
          `insert into meetings.objection
             (meeting_id, entity_id, class, statement, status, answer, answer_source, answered_by, answered_at)
           values ($1,$2,$3::meetings.objection_class,$4,$5::meetings.objection_status,$6,$7,$8,$9)`,
          [meetingId, e(m.entity), o.class, o.statement, o.status, o.answer ?? null,
           o.source ?? null, o.by ? u(o.by) : null, o.by ? new Date() : null],
        );
        objections += 1;
      }
    }

    const ddq: Array<{ entity: string; question: string; due: string; owner: string; status: string; answer?: string; source?: string }> = [
      { entity: 'Northwood Capital', question: 'Audited marks for the three prior operating-company vehicles.', due: '2026-09-30', owner: 'juan', status: 'open' },
      { entity: 'Northwood Capital', question: 'Key-person provisions and what happens on a departure.', due: '2026-09-30', owner: 'tomas', status: 'answered', answer: 'Two named key persons, 24-month suspension trigger.', source: 'doc:lpa-v4' },
      { entity: 'Northwood Capital', question: 'Valuation policy for pre-revenue neuro assets.', due: '2026-10-07', owner: 'juan', status: 'open' },
      { entity: 'Northwood Capital', question: 'Reference calls with two prior co-investors.', due: '2026-09-18', owner: 'mara', status: 'open' },
      { entity: 'Cedar Trust', question: 'Confirmation of the fee break mechanics in the side letter.', due: '2026-09-12', owner: 'tomas', status: 'answered', answer: 'Drafted and countersigned with the subscription pack.', source: 'doc:side-letter-cedar' },
      { entity: 'Roos Foundation', question: 'Does the trust deed permit a fund LP position at all?', due: '2026-10-31', owner: 'tomas', status: 'blocked' },
    ];

    for (const q of ddq) {
      await tx.query(
        `insert into meetings.diligence_question
           (entity_id, vehicle_id, question, asked_on, due_on, owner_id, status, answer, answer_source, answered_at)
         values ($1,$2,$3,'2026-09-08'::date,$4::date,$5,$6::meetings.question_status,$7,$8,$9)`,
        [e(q.entity), neurotech, q.question, q.due, u(q.owner), q.status,
         q.answer ?? null, q.source ?? null, q.answer ? new Date() : null],
      );
      questions += 1;
    }
  });

  return { meetings: 4, objections, questions };
}
