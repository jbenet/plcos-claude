import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/shell/Page';
import { LadderStepper } from '@/components/strategy/LadderStepper';
import { AdvanceForm } from '@/components/strategy/AdvanceForm';
import { EvidenceRef, type EvidenceDoc } from '@/components/ui/EvidenceRef';
import { Coverage } from '@/components/ui/Coverage';
import { auth } from '@/lib/auth';
import { shortDate } from '@/lib/time';
import { getPursuit, RUNG_LABEL, RUNG_REQUIRES } from '@/modules/strategy';
import { claimsFor, listSourceDocs, notesFor } from '@/modules/research';
import { restrictionsFor } from '@/modules/coordination';
import { planRoutes, VERDICT_LABEL } from '@/modules/network';
import { signalsFor } from '@/modules/signals';
import { SignalRow } from '@/components/signals/SignalRow';

export const dynamic = 'force-dynamic';

export default async function TargetWorkspace({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pursuit = await getPursuit(id);
  if (!pursuit) notFound();

  const user = await (await auth()).currentUser();
  const [claims, docs, notes, restrictions, routes, signals] = await Promise.all([
    claimsFor(pursuit.entityId),
    listSourceDocs(),
    notesFor(pursuit.entityId),
    restrictionsFor(pursuit.entityId),
    planRoutes(user.handle, pursuit.entityId),
    signalsFor(pursuit.entityId),
  ]);

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
        { label: 'Conversion strategy', href: '/targets' },
        { label: `${pursuit.entityName} · ${pursuit.vehicleName}` },
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
                  {c.field}: {c.value}
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
        Target workspace · owner {pursuit.ownerName} · opened {shortDate(pursuit.openedAt)}
      </div>
      <h1 style={{ marginTop: 4 }}>
        <Link href={`/orgs/${pursuit.entityId}`}>{pursuit.entityName}</Link>
      </h1>
      <p className="sublede">{pursuit.headline}</p>

      <LadderStepper pursuit={pursuit} />

      <div className="grid2">
        <div>
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
              <AdvanceForm pursuitId={pursuit.pursuitId} nextRung={pursuit.nextRung} />
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
                    <span>{c.field}</span>
                    <span>
                      {c.value}
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
              {pursuit.nextRung && (
                <p className="note" style={{ marginTop: 12 }}>
                  Next: <b>{RUNG_LABEL[pursuit.nextRung]}</b>. {RUNG_REQUIRES[pursuit.nextRung]}
                </p>
              )}
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
