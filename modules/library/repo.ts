import { getDb } from '@/lib/db';
import type { Answer, AnswerStatus, CoverageGap } from './types';

type Row = {
  answer_id: string; question: string; answer: string; version: number;
  status: AnswerStatus; approved_by_name: string | null; approved_on: Date | string | null;
  expires_on: Date | string | null; supersedes: string | null; owner_name: string;
};

export async function listAnswers(): Promise<Answer[]> {
  const db = await getDb();
  const rows = await db.query<Row>(
    `select a.answer_id, a.question, a.answer, a.version, a.status, u2.name as approved_by_name,
            a.approved_on, a.expires_on, a.supersedes, u.name as owner_name
       from library.answer a
       join platform.app_user u on u.id = a.owner_id
       left join platform.app_user u2 on u2.id = a.approved_by
      order by (a.status <> 'approved'), a.question`,
  );
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.answer_id);
  const sources = await db.query<{
    answer_id: string; claim_id: string | null; doc_id: string | null;
    note: string | null; field: string | null; value: string | null;
    entity_name: string | null; superseded_by: string | null; title: string | null;
  }>(
    `select s.answer_id, s.claim_id, s.doc_id, s.note, c.field, c.value,
            e.display_name as entity_name, c.superseded_by, d.title
       from library.answer_source s
       left join research.claim c on c.claim_id = s.claim_id
       left join identity.entity e on e.entity_id = c.entity_id
       left join research.source_doc d on d.doc_id = s.doc_id
      where s.answer_id = any($1::uuid[])`,
    [ids],
  );
  const uses = await db.query<{ answer_id: string; context: string; entity_name: string | null; used_on: Date | string }>(
    `select u.answer_id, u.context, e.display_name as entity_name, u.used_on
       from library.answer_use u
       left join identity.entity e on e.entity_id = u.entity_id
      where u.answer_id = any($1::uuid[]) order by u.used_on desc`,
    [ids],
  );

  return rows.map((r) => {
    const mine = sources.filter((s) => s.answer_id === r.answer_id);
    const supersededSource = mine.find((s) => s.superseded_by !== null);
    const expired = r.expires_on !== null && new Date(r.expires_on).getTime() < Date.now();
    return {
      answerId: r.answer_id, question: r.question, answer: r.answer, version: r.version,
      status: r.status, approvedByName: r.approved_by_name,
      approvedOn: r.approved_on ? new Date(r.approved_on) : null,
      expiresOn: r.expires_on ? new Date(r.expires_on) : null,
      supersedes: r.supersedes, ownerName: r.owner_name,
      sources: mine.map((s) => ({
        claimId: s.claim_id, docId: s.doc_id, note: s.note,
        label: s.claim_id ? `${s.entity_name} · ${s.field}: ${s.value}` : `${s.doc_id} · ${s.title}`,
      })),
      uses: uses
        .filter((u) => u.answer_id === r.answer_id)
        .map((u) => ({ context: u.context, entityName: u.entity_name, usedOn: new Date(u.used_on) })),
      stale: expired || Boolean(supersededSource),
      staleReason: supersededSource
        ? 'A claim this answer rests on has been superseded. The answer is still approved, which is exactly the situation this flag exists for.'
        : expired
          ? `Expired on ${new Date(r.expires_on!).toISOString().slice(0, 10)}. An answer goes stale on a date as well as on a fact.`
          : null,
    };
  });
}

/**
 * The gap analysis, as a query.
 *
 * Every objection and diligence question that has been raised, matched loosely against the
 * library. What comes back is a backlog: the questions people keep being asked with nothing
 * approved behind them.
 */
export async function coverageGaps(): Promise<CoverageGap[]> {
  const db = await getDb();
  const answers = await db.query<{ answer_id: string; question: string; status: AnswerStatus }>(
    'select answer_id, question, status from library.answer',
  );

  const raised = await db.query<{ text: string; kind: 'objection' | 'diligence'; entity_name: string }>(
    `select o.statement as text, 'objection'::text as kind, e.display_name as entity_name
       from meetings.objection o join identity.entity e on e.entity_id = o.entity_id
     union all
     select q.question, 'diligence'::text, e.display_name
       from meetings.diligence_question q join identity.entity e on e.entity_id = q.entity_id`,
  );

  /**
   * Issue 0006. The old matcher wanted two shared words over four characters, so "fee load"
   * and "fee terms" shared nothing and an answered question was reported as uncovered.
   *
   * This one stems crudely (plurals and a few endings), drops stopwords, and keeps short
   * domain words like fee, lock and term that the length filter was throwing away. It still
   * over-reports rather than under-reports, deliberately: a gap listed twice wastes a
   * minute, a gap hidden is the question you keep being asked and never write down.
   */
  const STOP = new Set([
    'about', 'above', 'after', 'again', 'their', 'there', 'these', 'those', 'which', 'would',
    'could', 'should', 'being', 'where', 'while', 'other', 'against', 'because', 'before',
    'what', 'with', 'that', 'this', 'from', 'have', 'they', 'your', 'ours', 'than', 'into',
  ]);
  const stem = (w: string) => w
    .replace(/(ies)$/, 'y')
    .replace(/(sses|ches|shes|xes)$/, '')
    .replace(/([^s])s$/, '$1')
    .replace(/(ing|ed|ly)$/, '');
  const words = (s: string) => new Set(
    s.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/[\s-]+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map(stem)
      .filter((w) => w.length > 2),
  );

  const byText = new Map<string, CoverageGap>();
  for (const r of raised) {
    const existing = byText.get(r.text);
    if (existing) {
      existing.occurrences += 1;
      if (!existing.entities.includes(r.entity_name)) existing.entities.push(r.entity_name);
      continue;
    }
    const rw = words(r.text);
    let best: { answerId: string; question: string; status: AnswerStatus; overlap: number } | null = null;
    for (const a of answers) {
      const aw = words(a.question);
      const overlap = [...rw].filter((w) => aw.has(w)).length;
      // Two shared stems, or one shared stem that is rare enough to be the subject itself.
      const rare = [...rw].filter((w) => aw.has(w) && w.length >= 6).length;
      if ((overlap >= 2 || rare >= 1) && (!best || overlap > best.overlap)) {
        best = { answerId: a.answer_id, question: a.question, status: a.status, overlap };
      }
    }
    byText.set(r.text, {
      question: r.text, kind: r.kind, occurrences: 1, entities: [r.entity_name],
      nearest: best ? { answerId: best.answerId, question: best.question, status: best.status } : null,
    });
  }

  return [...byText.values()].sort(
    (a, b) => Number(a.nearest !== null) - Number(b.nearest !== null) || b.occurrences - a.occurrences,
  );
}
