import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { LadderStepper } from '@/components/strategy/LadderStepper';
import { AdvanceForm } from '@/components/strategy/AdvanceForm';
import { EvidenceRef, type EvidenceDoc } from '@/components/ui/EvidenceRef';
import { Coverage } from '@/components/ui/Coverage';
import { auth } from '@/lib/auth';
import { shortDate } from '@/lib/time';
import {
  IMPLIED_LABEL, PASSED_BY_LABEL, RUNGS, RUNG_LABEL, RUNG_REQUIRES, STATUS_LABEL, getPursuit, impliedRung, rungIndex,
} from '@/modules/strategy';
import { StatusForm } from '@/components/strategy/StatusForm';
import { Timeline, meetingLine, type TouchContext } from '@/components/strategy/Timeline';
import { READ_LABEL, summarize, touchpointsFor } from '@/modules/meetings';
import { latestRun } from '@/modules/sources';
import { CLOSE_STATE_LABEL, closeTracksFor } from '@/modules/pipeline';
import { CloseTrack } from '@/components/strategy/CloseTrack';
import { usdM } from '@/lib/money';
import { claimLabel, claimsFor, listSourceDocs, notesFor } from '@/modules/research';
import { usdCompact } from '@/lib/money';
import { restrictionsFor } from '@/modules/coordination';
import { planRoutes, VERDICT_LABEL } from '@/modules/network';
import { signalsFor } from '@/modules/signals';
import { SignalRow } from '@/components/signals/SignalRow';
import { firstSentence, notesAbout } from '@/lib/connectors/affinity/notes';
import { meetingTitles } from '@/lib/connectors/affinity/meetings';
import { readingsFor } from '@/lib/connectors/affinity/readings';
import { laterFacts, shownRead } from '@/lib/reads';
import { onFile } from '@/lib/reconcile';
import { findOpenTicket } from '@/modules/governance';

export const dynamic = 'force-dynamic';

/** A translated amount is dollars as digits; it reads as a figure. Anything else as written. */
const claimValue = (field: string, value: string) =>
  /_usd$/.test(field) && Number.isFinite(Number(value)) ? usdCompact(Number(value)) : value;

export default async function TargetWorkspace({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pursuit = await getPursuit(id);
  if (!pursuit) notFound();

  const user = await (await auth()).currentUser();
  const [claims, docs, notes, restrictions, routes, signals, affinityNotes, touches, tracks, calendar, readings] = await Promise.all([
    claimsFor(pursuit.entityId),
    listSourceDocs(),
    notesFor(pursuit.entityId),
    restrictionsFor(pursuit.entityId),
    planRoutes(user.handle, pursuit.entityId),
    signalsFor(pursuit.entityId),
    notesAbout(pursuit.entityId),
    touchpointsFor(pursuit.entityId, pursuit.vehicleId),
    closeTracksFor(pursuit.entityId, pursuit.vehicleId),
    latestRun('affinity', 'meetings'),
    readingsFor([pursuit.entityId]),
  ]);
  const touchSummary = summarize(touches);
  // What the records here support, beside what the ladder has accepted (N57, docs/18).
  const file = onFile(pursuit, touches, tracks);
  const proposal = file.climb.length ? await findOpenTicket('STAGE', 'pursuit', pursuit.pursuitId) : null;
  const claimedRung = pursuit.source !== 'us' && pursuit.stageSaid ? impliedRung(pursuit.implied) : null;
  const theirRead = shownRead(touchSummary.read, readings, laterFacts(pursuit, tracks));
  // What each touchpoint was about: the meeting's title from the calendar, and the note Affinity
  // ties to the same interaction — its summary, and all of it a click away.
  const interactionOf = (ref: string | null) => {
    const m = /^interaction:([a-z-]+):(\d+):/.exec(ref ?? '');
    return m ? { type: m[1]!, id: m[2]! } : null;
  };
  const titles = await meetingTitles(touches.map((t) => interactionOf(t.sourceRef)).filter((x) => x?.type === 'meeting').map((x) => x!.id));
  const noteOn = new Map(affinityNotes.filter((x) => x.interaction).map((x) => [`${x.interaction!.type}:${x.interaction!.id}`, x]));
  const context: Record<string, TouchContext> = {};
  for (const t of touches) {
    const i = interactionOf(t.sourceRef);
    if (!i) continue;
    const note = noteOn.get(`${i.type}:${i.id}`);
    context[t.touchpointId] = {
      title: i.type === 'meeting' ? titles.get(i.id) ?? null : null,
      noteId: note?.noteId ?? null,
      text: note?.text ?? null,
      health: note?.health ?? false,
      // A note that mentions health never lends its first sentence: only a redacted reading (N56).
      summary: note ? note.reading?.summary ?? (note.health ? null : firstSentence(note.text)) : null,
      summaryBy: note?.reading?.summary ? note.reading.by : null,
      what: note?.reading?.what ?? null,
    };
  }

  const docMap = new Map<string, EvidenceDoc>(
    docs.map((d) => [
      d.docId,
      { docId: d.docId, title: d.title, origin: d.origin, asOf: shortDate(d.asOf), strength: d.strength, supports: d.supports },
    ]),
  );
  const questions = notes.filter((n) => n.kind === 'open_question');
  const latest = pursuit.events[pursuit.events.length - 1];

  return (
    <Page
      crumbs={[
        { label: pursuit.vehicleName, href: '/overview' },
        { label: 'Pipeline', href: `/targets?status=${pursuit.status}` },
        { label: pursuit.entityName },
      ]}
      inspector={
        <>
          {restrictions.length > 0 ? (
            <>
              <div className="lbl">Evidence · {restrictions[0]!.source ?? 'note'}</div>
              <div className="ihead">Restriction on file</div>
              <div className="imeta">
                Recorded by {restrictions[0]!.recordedByName ?? 'unattributed'} ·{' '}
                {shortDate(restrictions[0]!.recordedAt)}
              </div>
              <div className="warn">
                <div className="lbl" style={{ color: 'var(--clay)' }}>
                  Do not approach via {restrictions[0]!.connectorName ?? 'this channel'}
                </div>
                <p>{restrictions[0]!.instruction}</p>
                <p style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  The route planner excludes every path through that party and will not quietly
                  substitute another connector toward the same approach.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="lbl">Standing</div>
              <div className="ihead">{pursuit.entityName}</div>
              <div className="imeta">
                {pursuit.vehicleName} · owner {pursuit.ownerName}
              </div>
            </>
          )}

          <div style={{ marginTop: 18 }}>
            <div className="lbl">Provenance</div>
            {claims.slice(0, 3).map((c) => (
              <div className="prov" key={c.claimId}>
                <div className="p1">
                  {claimLabel(c.field)}: {claimValue(c.field, c.value)}
                </div>
                <div className="p2">
                  {c.provenance.source} · as of {shortDate(c.provenance.asOf)} · {c.provenance.confidence}
                  {c.provenance.lastVerifiedBy ? ` · verified by ${c.provenance.lastVerifiedBy}` : ' · unverified'}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 14 }}>
            <span className={`stat ${pursuit.rung === 'connector_willing' ? 'waiting' : 'ready'}`}>
              <i />
              {pursuit.rung === 'connector_willing' ? 'Waiting on counterpart' : 'Ready for review'}
            </span>
          </div>

          <div className="note">
            {pursuit.rung === 'connector_willing'
              ? 'The connector said they were happy to ask. That is the first rung and nothing more — it is not target interest, not a meeting, and not a commitment. The ladder will not advance until a reply from the target is on file.'
              : `Currently at ${pursuit.rung ? RUNG_LABEL[pursuit.rung] : 'nothing on file'}. Every rung above it is empty, and empty is rendered as empty.`}
          </div>
        </>
      }
    >
      <div className="lbl">
        LP workspace · owner {pursuit.ownerSaid ? `${pursuit.ownerSaid} (not on the team)` : pursuit.ownerName} · opened {shortDate(pursuit.openedAt)}
        {pursuit.historical ? ' · a vehicle kept for its history' : ''}
      </div>
      <h1 style={{ marginTop: 4 }}>
        <Link href={`/orgs/${pursuit.entityId}`}>{pursuit.entityName}</Link>
      </h1>
      <p className="sublede">{pursuit.headline}</p>

      {(() => {
        const p = pursuit;
        const claimed = impliedRung(p.implied);
        const differs = p.statusSource === 'us' && p.statusSaid && p.statusSaid !== p.status;
        return (
          <div className="statuspanel">
            <div className="now">
              <span className="lbl">Status</span>
              <b>{STATUS_LABEL[p.status]}</b>
              {p.status === 'passed' && (
                <span>{[p.passedBy ? PASSED_BY_LABEL[p.passedBy] : null, p.statusReason?.replace('_', ' ')].filter(Boolean).join(' · ')}</span>
              )}
              {p.status !== 'passed' && p.statusReason && <span>{p.statusReason}</span>}
              <span className="muted" style={{ fontSize: 12 }}>
                {p.statusSource === 'us'
                  ? p.statusSetAt ? `set here ${shortDate(p.statusSetAt)}${p.statusSetByName ? ` by ${p.statusSetByName}` : ''}` : 'set here'
                  : `read from Affinity${p.sourceAsOf ? ` ${shortDate(p.sourceAsOf)}` : ''} — nobody has set one here yet`}
              </span>
            </div>
            {p.nextStep && (
              <div className="said">
                <b>Next:</b> {p.nextStep}{p.nextStepOn ? ` — by ${shortDate(p.nextStepOn)}` : ''}
              </div>
            )}
            {(p.status === 'new' || p.status === 'sourcing' || p.status === 'selected') && touchSummary.meetingDates.length > 0 && (
              <div className="said differs">
                A meeting is on record, and the status is still {STATUS_LABEL[p.status]} — Discussing? It is yours to set; nothing moves it for you.
              </div>
            )}
            {tracks[0] && (
              <div className="said">
                <b>Close track:</b> {CLOSE_STATE_LABEL[tracks[0].state]} · {usdM(tracks[0].exposure.amount)}
                {tracks[0].signature && tracks[0].state === 'signed' ? ` · signed ${tracks[0].signature.on ? shortDate(tracks[0].signature.on) : `per ${tracks[0].signature.bySource === 'affinity' ? 'Affinity' : tracks[0].signature.bySource}, undated`}` : ''}
                {tracks[0].exposure.track === 'hard' ? ` · ${usdM(tracks[0].wired)} wired` : ''}
              </div>
            )}
            <div className="said">
              {meetingLine(touchSummary)}
              {p.implied.includes('met_twice') && touchSummary.meetingDates.length < 2 ? ' · Affinity says two or more' : ''}
              {p.implied.includes('met') && !p.implied.includes('met_twice') && touchSummary.meetingDates.length < 1 ? ' · Affinity says one was held' : ''}
              {touchSummary.lastTouch ? ` · last touch ${shortDate(touchSummary.lastTouch)}` : ''}
              {theirRead && !theirRead.superseded ? ` · their read: ${READ_LABEL[theirRead.read].toLowerCase()}${theirRead.on ? ` (${shortDate(theirRead.on)})` : ''}${theirRead.suggested ? ', suggested from a note' : ''}${theirRead.old ? ', old' : ''}` : ''}
              {theirRead?.superseded ? ` · an older read (${READ_LABEL[theirRead.read].toLowerCase()}, ${theirRead.on ? shortDate(theirRead.on) : 'undated'}) is superseded: since then, ${theirRead.superseded.what}` : ''}
            </div>
            {p.stageSaid && p.source !== 'us' && (
              <div className={`said${differs ? ' differs' : ''}`}>
                {differs ? <>Affinity now says &ldquo;{p.stageSaid}&rdquo;, which reads as {STATUS_LABEL[p.statusSaid!]}. </> : <>Affinity says &ldquo;{p.stageSaid}&rdquo;. </>}
                {p.implied.length > 0 && (
                  <span className="muted">
                    Its record implies {p.implied.map((i) => IMPLIED_LABEL[i]).join(', ')}
                    {claimed ? ` — a claim of ${RUNG_LABEL[claimed]}; ${p.rung ? `the ladder has ${RUNG_LABEL[p.rung]} accepted` : 'nothing on the ladder is accepted yet'}${file.to ? `, and the records on file support ${RUNG_LABEL[file.to]}` : ''}` : ''}.
                  </span>
                )}
              </div>
            )}
            <details>
              <summary>Change the status</summary>
              <StatusForm
                pursuitId={p.pursuitId}
                status={p.status}
                passedBy={p.passedBy}
                reason={p.statusReason}
                nextStep={p.nextStep}
                nextStepOn={p.nextStepOn ? p.nextStepOn.toISOString().slice(0, 10) : null}
              />
            </details>
          </div>
        );
      })()}

      <LadderStepper
        pursuit={pursuit}
        onFile={file}
        proposalId={proposal?.id ?? null}
        claimed={claimedRung ? { rung: claimedRung, word: pursuit.stageSaid! } : null}
      />

      <div className="grid2">
        <div>
          {tracks.map((t) => <CloseTrack key={t.exposure.exposureId} track={t} pursuitId={pursuit.pursuitId} />)}

          <Timeline
            touches={touches}
            summary={touchSummary}
            notes={affinityNotes}
            pursuitId={pursuit.pursuitId}
            entityId={pursuit.entityId}
            vehicleId={pursuit.vehicleId}
            vehicleName={pursuit.vehicleName}
            calendarPartial={Boolean((calendar?.detail as { stoppedAtCap?: boolean } | undefined)?.stoppedAtCap)}
            context={context}
            read={theirRead}
          />

          <div className="card">
            <div className="chead">
              <h2>Routes in</h2>
              <span className="lbl">ranked by what the evidence can carry</span>
            </div>
            {!routes || routes.routes.length === 0 ? (
              <div className="cbody">
                <p className="muted">
                  No supported route from {user.name} in the material available. That is not the
                  same as no route existing.
                </p>
              </div>
            ) : (
              routes.routes.slice(0, 3).map((route, i) => (
                <div className="route" key={i}>
                  <span className={`tier t${route.weakestTier}`}>{route.weakestTier}</span>
                  <div className="rt">
                    <b>
                      {routes.fromName} → {route.hops.map((h) => h.toName).join(' → ')}
                    </b>
                    <p>{route.reasons[0]}</p>
                  </div>
                  <div className="verdict">
                    <b className={route.verdict === 'excluded' || route.verdict === 'not_a_route' ? 'stop' : ''}>
                      {VERDICT_LABEL[route.verdict]}
                    </b>
                    {route.askLoad ? `${route.askLoad.used} of ${route.askLoad.cap} asks used` : 'direct'}
                  </div>
                </div>
              ))
            )}
            {routes && (
              <Coverage
                corpus={`${routes.coverage.edges} relationship edges, up to ${routes.coverage.maxHops} hops`}
                from={routes.coverage.from ? shortDate(routes.coverage.from) : null}
                to={routes.coverage.to ? shortDate(routes.coverage.to) : null}
                notInspected={routes.coverage.notInspected}
              />
            )}
          </div>

          {signals.length > 0 && (
            <div className="card">
              <div className="chead">
                <h2>What changed</h2>
                <span className="lbl">signals concerning this target</span>
              </div>
              {signals.map((s) => (
                <SignalRow key={s.signalId} signal={s} />
              ))}
            </div>
          )}

          <div className="card">
            <div className="chead">
              <h2>Next moves</h2>
              <span className="lbl">plan · each with its reason</span>
            </div>
            <div className="cbody">
              {pursuit.plan.length === 0 ? (
                <p className="muted">No plan recorded.</p>
              ) : (
                <ol className="moves">
                  {pursuit.plan.map((step) => (
                    <li key={step.move}>
                      {step.move}
                      <small>{step.because}</small>
                      {step.blockedBy && <span className="block">Blocked: {step.blockedBy}</span>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>

          {pursuit.nextRung && (
            <div className="card">
              <div className="chead">
                <h2>Advance the ladder</h2>
                <span className="lbl">STAGE ticket · nothing is recorded here</span>
              </div>
              {proposal ? (
                // One open STAGE ticket per pursuit (rule 3): the proposal from the records is it.
                <div className="cbody">
                  <p style={{ margin: 0, fontSize: 13 }}>
                    The records on file support {RUNG_LABEL[file.to!]}, and a proposal to record it is{' '}
                    <Link href={`/approvals?t=${proposal.id}`}>waiting for approval</Link>. Approve or reject it
                    first; a rung above it can be asked for after.
                  </p>
                </div>
              ) : (
                <AdvanceForm pursuitId={pursuit.pursuitId} nextRung={pursuit.nextRung} />
              )}
            </div>
          )}
        </div>

        <div>
          <div className="card">
            <div className="chead">
              <h2>What we know</h2>
            </div>
            <div className="cbody">
              {claims.length === 0 ? (
                <p className="muted">Nothing on file carries a full provenance tuple.</p>
              ) : (
                claims.map((c) => (
                  <div className="fact" key={c.claimId}>
                    <span>{claimLabel(c.field)}</span>
                    <span>
                      {claimValue(c.field, c.value)}
                      {docMap.has(c.provenance.source) && <EvidenceRef doc={docMap.get(c.provenance.source)!} />}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="card">
            <div className="chead">
              <h2>Open questions</h2>
              <span className="lbl">{questions.length}</span>
            </div>
            <div className="cbody">
              {questions.length === 0 ? (
                <p className="muted">None recorded.</p>
              ) : (
                questions.map((q) => (
                  <div className="fact" key={q.noteId} style={{ display: 'block' }}>
                    <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>{q.body}</div>
                    <span className={`flag ${String(q.data['status']) === 'stale' ? 'f-ev' : 'f-mute'}`} style={{ marginTop: 6, display: 'inline-block' }}>
                      {String(q.data['status'] ?? 'unknown')}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="card">
            <div className="chead">
              <h2>Ladder history</h2>
              <span className="lbl">{pursuit.events.length} record{pursuit.events.length === 1 ? '' : 's'}</span>
            </div>
            <div className="cbody">
              {pursuit.events.map((ev) => (
                <div className="prov" key={ev.eventId}>
                  <div className="p1">
                    {RUNG_LABEL[ev.rung]}
                    {ev.evidenceKind === 'not_applicable' ? ' — not applicable' : ''}
                  </div>
                  <div className="p2">
                    {shortDate(ev.occurredAt)} · {ev.evidenceKind} {ev.evidenceRef} · {ev.recordedByName}
                  </div>
                </div>
              ))}
              {file.to && (
                <p className="note" style={{ marginTop: 12 }}>
                  On file, not accepted yet: up to <b>{RUNG_LABEL[file.to]}</b>
                  {proposal ? <>, <Link href={`/approvals?t=${proposal.id}`}>waiting for approval</Link></> : ''}.
                </p>
              )}
              {(() => {
                const after = RUNGS[rungIndex(pursuit.rung) + 1 + file.climb.length];
                return after ? (
                  <p className="note" style={{ marginTop: 12 }}>
                    {file.to ? 'After that' : 'Next'}: <b>{RUNG_LABEL[after]}</b>. {RUNG_REQUIRES[after]}
                  </p>
                ) : null;
              })()}
              {latest && !pursuit.nextRung && (
                <p className="note" style={{ marginTop: 12 }}>
                  Every rung is on file. The last was {RUNG_LABEL[latest.rung]}.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </Page>
  );
}
