import Link from 'next/link';
import { Page } from '@/components/shell/Page';
import { moduleCrumbs } from '@/lib/nav';
import { vehicleSelection } from '@/lib/session';
import { shortDate } from '@/lib/time';
import { listPursuits, RUNG_LABEL, RUNG_REQUIRES } from '@/modules/strategy';
import {
  listMeetings, MEETING_LABEL, OBJECTION_LABEL, prepBrief, upcomingMeetings,
} from '@/modules/meetings';

export const dynamic = 'force-dynamic';

export default async function Meetings({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const selection = await vehicleSelection();
  const { e } = await searchParams;
  const [all, upcoming, pursuits] = await Promise.all([
    listMeetings(), upcomingMeetings(), listPursuits(),
  ]);
  const focusEntity = e ?? upcoming[0]?.entityId ?? all[0]?.entityId;
  const pursuit = pursuits.find((p) => p.entityId === focusEntity);
  const brief = focusEntity && pursuit ? await prepBrief(focusEntity, pursuit.vehicleId) : null;
  const held = all.filter((m) => m.heldOn);

  return (
    <Page
      crumbs={moduleCrumbs('meetings', selection.current?.name ?? null)}
      queue={
        <>
          <div className="qhead">
            <div className="lbl">Module 11 · prep and follow-through</div>
            <h2>{upcoming.length} scheduled</h2>
            <p>The brief is built from what the record can support, and names what it cannot.</p>
          </div>
          {upcoming.map((m) => (
            <Link
              key={m.meetingId}
              href={`/meetings?e=${m.entityId}`}
              className={`tix${m.entityId === focusEntity ? ' on' : ''}`}
            >
              <div className="tixtop">
                <span className="kind k-intro">{m.kind ? MEETING_LABEL[m.kind] : 'Meeting'}</span>
                <span className="age">{m.scheduledFor ? shortDate(m.scheduledFor) : ''}</span>
              </div>
              <b>{m.entityName}</b>
              <p>{m.attendees.join(', ')}</p>
            </Link>
          ))}
          <div className="qhead" style={{ borderTop: '1px solid var(--line)' }}>
            <div className="lbl">Held</div>
            <p>What each one actually justifies.</p>
          </div>
          {held.map((m) => (
            <Link key={m.meetingId} href={`/meetings?e=${m.entityId}`} className="tix">
              <div className="tixtop">
                <span className="kind k-chore">{m.kind ? MEETING_LABEL[m.kind] : 'Meeting'}</span>
                <span className="age">{m.heldOn ? shortDate(m.heldOn) : ''}</span>
              </div>
              <b>{m.entityName}</b>
              <p>
                Justifies: {m.justifiesRung ? RUNG_LABEL[m.justifiesRung] : 'nothing new'}
              </p>
            </Link>
          ))}
        </>
      }
    >
      {!brief ? (
        <>
          <div className="lbl">Module 11 · Convert &amp; coordinate</div>
          <h1>Nothing is scheduled.</h1>
          <p className="sublede">A prep brief exists for a meeting. There is no meeting.</p>
        </>
      ) : (
        <>
          <div className="lbl">
            Prep brief · {brief.vehicleName}
            {brief.meeting?.scheduledFor ? ` · ${shortDate(brief.meeting.scheduledFor)}` : ''}
          </div>
          <h1>{brief.entityName}</h1>
          <p className="sublede">
            {brief.meeting
              ? `${brief.meeting.kind ? MEETING_LABEL[brief.meeting.kind] : 'Meeting'} with ${brief.meeting.attendees.join(', ')}. `
              : 'No meeting scheduled. '}
            Currently at{' '}
            <b>{brief.currentRung ? RUNG_LABEL[brief.currentRung] : 'nothing on file'}</b> on the
            consent ladder.
          </p>

          {brief.restriction && (
            <div className="warn" style={{ marginBottom: 14 }}>
              <div className="lbl" style={{ color: 'var(--clay)' }}>
                Restriction on file
              </div>
              <p>{brief.restriction}</p>
            </div>
          )}

          <div className="grid2">
            <div>
              <div className="card">
                <div className="chead">
                  <h2>What the brief may say</h2>
                  <span className="lbl">{brief.supported.length} supported claims</span>
                </div>
                <div className="cbody">
                  {brief.supported.length === 0 && (
                    <div className="empty">
                      <span className="stat unavailable">
                        <i />
                        Nothing statable
                      </span>
                      <h3>Nothing about {brief.entityName} can be stated in a brief.</h3>
                      <p>
                        Every claim on file fails the provenance test, so the brief has no content
                        rather than thin content. Walking into a meeting knowing that is very
                        different from walking in with two sentences that sound like facts.
                      </p>
                    </div>
                  )}
                  {brief.supported.map((s) => (
                    <div className="fact" key={s.field}>
                      <span>{s.field}</span>
                      <span>
                        {s.value}
                        <div className="mono muted" style={{ fontSize: 10, fontWeight: 400, marginTop: 2 }}>
                          {s.source} · {shortDate(s.asOf)} ·{' '}
                          {s.verifiedBy ? `verified by ${s.verifiedBy}` : 'unverified'}
                        </div>
                      </span>
                    </div>
                  ))}
                </div>
                {brief.refused.length > 0 && (
                  <>
                    <div className="chead" style={{ borderTop: '1px solid var(--line)' }}>
                      <h2 style={{ fontSize: 14 }}>What it refuses to say</h2>
                      <span className="lbl">{brief.refused.length}</span>
                    </div>
                    <div className="cbody">
                      {brief.refused.map((r) => (
                        <div className="fact" key={r.field}>
                          <span style={{ color: 'var(--clay)' }}>{r.field}</span>
                          <span style={{ fontWeight: 400, maxWidth: '68%', textAlign: 'right' }}>{r.why}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                <p className="cover">
                  A brief that cannot show source, as-of, confidence and who verified it does not
                  make the claim. The refused rows are listed rather than omitted, because a brief
                  with gaps quietly removed reads as complete.
                </p>
              </div>

              <div className="card">
                <div className="chead">
                  <h2>Open objections</h2>
                  <span className="lbl">answer these or expect them again</span>
                </div>
                {brief.openObjections.length === 0 ? (
                  <div className="cbody">
                    <p className="muted">Nothing open.</p>
                  </div>
                ) : (
                  brief.openObjections.map((o) => (
                    <div className="row" key={o.objectionId} style={{ alignItems: 'flex-start' }}>
                      <span className="kind k-stage" style={{ width: 110 }}>
                        {OBJECTION_LABEL[o.class]}
                      </span>
                      <div className="t">
                        <b style={{ fontWeight: 400, lineHeight: 1.5 }}>{o.statement}</b>
                      </div>
                      <div className="state">
                        <b>{o.status}</b>
                        no answer on file
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div>
              <div className="card">
                <div className="chead">
                  <h2>Open questions</h2>
                  <span className="lbl">{brief.openQuestions.length}</span>
                </div>
                <div className="cbody">
                  {brief.openQuestions.length === 0 ? (
                    <p className="muted">None outstanding.</p>
                  ) : (
                    brief.openQuestions.map((q) => (
                      <div className="fact" key={q.questionId} style={{ display: 'block' }}>
                        <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{q.question}</div>
                        <div style={{ marginTop: 5 }}>
                          <span className={`flag ${q.overdue ? 'f-block' : 'f-mute'}`}>
                            {q.status}
                            {q.dueOn ? ` · ${shortDate(q.dueOn)}` : ''}
                          </span>
                          <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>
                            {q.ownerName}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="card">
                <div className="chead">
                  <h2>What a reply would justify</h2>
                </div>
                <div className="cbody">
                  <p style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                    This target sits at{' '}
                    <b>{brief.currentRung ? RUNG_LABEL[brief.currentRung] : 'nothing on file'}</b>.
                  </p>
                  {pursuit?.nextRung && (
                    <>
                      <div className="fact">
                        <span>Next rung</span>
                        <span>{RUNG_LABEL[pursuit.nextRung]}</span>
                      </div>
                      <p className="note" style={{ marginTop: 10 }}>
                        {RUNG_REQUIRES[pursuit.nextRung]}
                      </p>
                      <Link className="btn p" href={`/targets/${pursuit.pursuitId}`} style={{ display: 'inline-block', padding: 8, marginTop: 10 }}>
                        Record it on the ladder
                      </Link>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="chead">
              <h2>What each held meeting justifies</h2>
              <span className="lbl">usually less than the person who ran it would like</span>
            </div>
            {held.map((m) => (
              <div className="row" key={m.meetingId} style={{ alignItems: 'flex-start' }}>
                <span className="kind k-chore" style={{ width: 110 }}>
                  {m.kind ? MEETING_LABEL[m.kind] : 'Meeting'}
                </span>
                <div className="t">
                  <b>
                    {m.entityName} · {m.heldOn ? shortDate(m.heldOn) : ''}
                  </b>
                  <span style={{ display: 'block', lineHeight: 1.5 }}>{m.summary}</span>
                  {m.justification && (
                    <span style={{ display: 'block', marginTop: 5, color: 'var(--ink)' }}>
                      {m.justification}
                    </span>
                  )}
                </div>
                <div className="state" style={{ width: 150 }}>
                  <b>{m.justifiesRung ? RUNG_LABEL[m.justifiesRung] : 'Nothing new'}</b>
                  and nothing above it
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Page>
  );
}
