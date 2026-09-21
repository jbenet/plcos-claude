import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { moduleCrumbs } from '@/lib/nav';
import { vehicleSelection } from '@/lib/session';
import { shortDate } from '@/lib/time';
import { listPursuits, RUNG_LABEL } from '@/modules/strategy';
import {
  listMeetings, listObjections, listQuestions, MEETING_LABEL, objectionTally, OBJECTION_LABEL,
} from '@/modules/meetings';

export const dynamic = 'force-dynamic';

const OBJ_FLAG: Record<string, string> = {
  open: 'f-block', answered: 'f-ok', accepted: 'f-ok', fatal: 'f-block',
};
const Q_FLAG: Record<string, string> = {
  open: 'f-ev', answered: 'f-ok', blocked: 'f-block', withdrawn: 'f-mute',
};

export default async function DecisionRoom({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const selection = await vehicleSelection();
  const { e } = await searchParams;
  const [pursuits, tally, allObjections, allQuestions, meetings] = await Promise.all([
    listPursuits(), objectionTally(), listObjections(), listQuestions(), listMeetings(),
  ]);

  const withWork = pursuits.filter((p) =>
    allObjections.some((o) => o.entityId === p.entityId) ||
    allQuestions.some((q) => q.entityId === p.entityId),
  );
  const focus = withWork.find((p) => p.entityId === e) ?? withWork[0] ?? null;
  const objections = focus ? allObjections.filter((o) => o.entityId === focus.entityId) : [];
  const questions = focus ? allQuestions.filter((q) => q.entityId === focus.entityId) : [];
  const theirMeetings = focus ? meetings.filter((m) => m.entityId === focus.entityId) : [];

  // The decision timeline: ladder events and meetings, merged and ordered.
  const timeline = focus
    ? [
        ...focus.events.map((ev) => ({
          at: ev.occurredAt,
          label: RUNG_LABEL[ev.rung],
          detail: ev.evidenceNote,
          kind: 'rung' as const,
          ref: `${ev.evidenceKind} ${ev.evidenceRef}`,
        })),
        ...theirMeetings
          .filter((m) => m.heldOn)
          .map((m) => ({
            at: m.heldOn!,
            label: MEETING_LABEL[m.kind],
            detail: m.summary ?? '',
            kind: 'meeting' as const,
            ref: m.attendees.join(', '),
          })),
      ].sort((a, b) => a.at.getTime() - b.at.getTime())
    : [];

  return (
    <Page
      crumbs={moduleCrumbs('decisions', selection.current?.name ?? null)}
      queue={
        <>
          <div className="qhead">
            <div className="lbl">Module 10 · what is still unanswered</div>
            <h2>{withWork.length} in diligence</h2>
            <p>
              Questions, objections and the evidence that would close them. A target with nothing
              open is not in this list.
            </p>
          </div>
          {withWork.map((p) => {
            const openO = allObjections.filter((o) => o.entityId === p.entityId && o.status === 'open').length;
            const openQ = allQuestions.filter((q) => q.entityId === p.entityId && q.status !== 'answered').length;
            return (
              <Link
                key={p.pursuitId}
                href={`/decisions?e=${p.entityId}`}
                className={`tix${focus?.entityId === p.entityId ? ' on' : ''}`}
              >
                <b>{p.entityName}</b>
                <p>
                  {p.vehicleName} · {p.rung ? RUNG_LABEL[p.rung] : 'nothing on file'}
                </p>
                <span className={`flag ${openO + openQ > 0 ? 'f-ev' : 'f-ok'}`}>
                  {openO} objection{openO === 1 ? '' : 's'} · {openQ} question{openQ === 1 ? '' : 's'}
                </span>
              </Link>
            );
          })}
        </>
      }
      inspector={
        <>
          <div className="lbl">Objection taxonomy</div>
          <div className="ihead">What comes up, and how often</div>
          <div className="imeta">Closed classes, across every target</div>
          {tally.map((t) => (
            <div className="kv" key={t.class}>
              <span>{OBJECTION_LABEL[t.class]}</span>
              <span>
                {t.answered} of {t.raised} answered
              </span>
            </div>
          ))}
          <div className="scope">
            <div className="lbl">Why the classes are closed</div>
            <p>
              A free-text objection cannot be counted, and an objection you cannot count is one you
              will keep answering from scratch. Eight classes; anything that does not fit is a
              signal that the list is wrong, not that the field should be free.
            </p>
          </div>
          <div className="note">
            An answer with no source is an assertion. <code>answer_source</code> is on every row
            and shown wherever the answer is.
          </div>
        </>
      }
    >
      {!focus ? (
        <>
          <div className="lbl">Module 10 · Convert &amp; coordinate</div>
          <h1>Nothing is in diligence.</h1>
          <p className="sublede">
            The decision room fills when someone records a question or an objection. Nothing has
            been recorded.
          </p>
        </>
      ) : (
        <>
          <div className="lbl">
            Decision room · {focus.vehicleName} · owner {focus.ownerName}
          </div>
          <h1>{focus.entityName}</h1>
          <p className="sublede">
            {objections.filter((o) => o.status === 'open').length} open objections,{' '}
            {questions.filter((q) => q.status !== 'answered').length} outstanding questions, and the
            timeline of what has actually happened. Currently at{' '}
            <b>{focus.rung ? RUNG_LABEL[focus.rung] : 'nothing on file'}</b>.
          </p>

          <div className="grid2">
            <div>
              <div className="card">
                <div className="chead">
                  <h2>Objections</h2>
                  <span className="lbl">tagged, so they can be counted</span>
                </div>
                {objections.map((o) => (
                  <div className="row" key={o.objectionId} style={{ alignItems: 'flex-start' }}>
                    <span className="kind k-stage" style={{ width: 110 }}>
                      {OBJECTION_LABEL[o.class]}
                    </span>
                    <div className="t">
                      <b style={{ fontWeight: 500, lineHeight: 1.45 }}>{o.statement}</b>
                      {o.answer ? (
                        <span style={{ display: 'block', marginTop: 5, lineHeight: 1.5 }}>
                          {o.answer}
                          <span className="mono" style={{ fontSize: 10, marginLeft: 6 }}>
                            {o.answerSource ?? 'no source'} · {o.answeredByName}
                          </span>
                        </span>
                      ) : (
                        <span style={{ display: 'block', marginTop: 5, color: 'var(--clay)' }}>
                          No answer on file. It will come up again.
                        </span>
                      )}
                    </div>
                    <div className="state">
                      <span className={`flag ${OBJ_FLAG[o.status]}`}>{o.status}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="card">
                <div className="chead">
                  <h2>Diligence questions</h2>
                  <span className="lbl">each with an owner and a date</span>
                </div>
                <table className="list">
                  <thead>
                    <tr>
                      <th>Question</th>
                      <th style={{ width: 100 }}>Owner</th>
                      <th style={{ width: 110 }}>Due</th>
                      <th style={{ width: 110 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {questions.map((q) => (
                      <tr key={q.questionId}>
                        <td>
                          <b>{q.question}</b>
                          {q.answer && (
                            <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                              {q.answer} · <span className="mono">{q.answerSource ?? 'no source'}</span>
                            </div>
                          )}
                        </td>
                        <td className="muted">{q.ownerName ?? '—'}</td>
                        <td className="mono" style={{ color: q.overdue ? 'var(--clay)' : 'var(--muted)' }}>
                          {q.dueOn ? shortDate(q.dueOn) : '—'}
                        </td>
                        <td>
                          <span className={`flag ${Q_FLAG[q.status]}`}>{q.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="cover">
                  <b>Evidence gap:</b>{' '}
                  {questions.filter((q) => q.status !== 'answered').length} of {questions.length}{' '}
                  questions have no answer on file, and{' '}
                  {objections.filter((o) => o.status === 'open').length} objections have none
                  either. Those are the things that will decide this, and none of them is a
                  scheduling problem.
                </p>
              </div>
            </div>

            <div>
              <div className="card">
                <div className="chead">
                  <h2>Decision timeline</h2>
                  <span className="lbl">{timeline.length} events</span>
                </div>
                <div className="cbody">
                  {timeline.length === 0 ? (
                    <p className="muted">Nothing has happened yet.</p>
                  ) : (
                    timeline.map((t, i) => (
                      <div className="prov" key={i}>
                        <div className="p1">
                          <span
                            className={`flag ${t.kind === 'rung' ? 'f-ok' : 'f-mute'}`}
                            style={{ marginRight: 6 }}
                          >
                            {t.kind}
                          </span>
                          {t.label}
                        </div>
                        <div className="p2" style={{ fontFamily: 'var(--sans)', fontSize: 11.5, lineHeight: 1.5 }}>
                          {shortDate(t.at)} · {t.detail}
                        </div>
                        <div className="p2">{t.ref}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="card">
                <div className="chead">
                  <h2>Links</h2>
                </div>
                <div className="cbody">
                  <Link className="btn" href={`/targets/${focus.pursuitId}`} style={{ display: 'block', textAlign: 'center', padding: 8, marginBottom: 8 }}>
                    Target workspace
                  </Link>
                  <Link className="btn" href={`/meetings?e=${focus.entityId}`} style={{ display: 'block', textAlign: 'center', padding: 8, marginBottom: 8 }}>
                    Prep brief
                  </Link>
                  <Link className="btn" href={`/orgs/${focus.entityId}`} style={{ display: 'block', textAlign: 'center', padding: 8 }}>
                    Dossier
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </Page>
  );
}
