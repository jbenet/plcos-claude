import { Suspense } from 'react';
import { DakotaClaims } from '@/components/entity/DakotaClaims';
import { coalescePage } from '@/lib/page-render';
import Link from '@/components/ui/AppLink';
import { notFound } from 'next/navigation';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { StatusStepper } from '@/components/strategy/StatusStepper';
import { AdvanceForm } from '@/components/strategy/AdvanceForm';
import { EvidenceRef } from '@/components/ui/EvidenceRef';
import { Coverage } from '@/components/ui/Coverage';
import { shortDate } from '@/lib/time';
import { IMPLIED_LABEL, PASSED_BY_LABEL, RUNG_LABEL, STATUS_LABEL, impliedRung, statusNeedsEvidence } from '@/lib/authz/read/strategy';
import { draftingOn, KIND_LABEL } from '@/modules/email';
import { StatusForm } from '@/components/strategy/StatusForm';
import { Timeline, meetingLine } from '@/components/strategy/Timeline';
import { READ_LABEL } from '@/modules/meetings';
import { LpUnitCard, LpUnitLine, LpUnitTags } from '@/components/strategy/LpUnit';
import { SpvCard } from '@/components/strategy/SpvCard';
import { CLOSE_STATE_LABEL } from '@/modules/pipeline';
import { CloseTrack } from '@/components/strategy/CloseTrack';
import { usdM } from '@/lib/money';
import { claimLabel } from '@/lib/authz/read/research';
import { usdCompact } from '@/lib/money';
import { VERDICT_LABEL } from '@/lib/authz/read/network';
import { SignalRow } from '@/components/signals/SignalRow';
import { ConnectionFeedback } from '@/components/routes/ConnectionFeedback';
import { PublicProfile } from '@/components/entity/PublicProfile';
import { SuggestedStrategy } from '@/components/strategy/SuggestedStrategy';
import { AddContext } from '@/components/strategy/AddContext';
import { OrgPeople, WarmIntroBox } from '@/components/strategy/LpSideCards';
import hd from './lp-header.module.css';
import { RUNGS, rungIndex } from '@/modules/strategy';
import { BeforeOutreach } from '@/components/strategy/BeforeOutreach';
import { EmailDrafts } from '@/components/email/EmailDrafts';
import { OutreachContext } from '@/components/outreach/OutreachContext';
import { decideSuggestionAction, restoreSendToAction, withdrawIndicationAction } from '@/app/targets/actions';
import type { Strategy } from '@/lib/enrich/strategy';
import { Info } from '@/components/ui/Info';
import { TABS, type Tab, loadTargetWorkspace } from './load';

export const dynamic = 'force-dynamic';

/** A translated amount is dollars as digits; it reads as a figure. Anything else as written. */
const claimValue = (field: string, value: string) =>
  /_usd$/.test(field) && Number.isFinite(Number(value)) ? usdCompact(Number(value)) : value;

const TAB_LABEL: Record<Tab, string> = { activity: 'Activity', email: 'Email', strategy: 'Strategy', research: 'Research', routes: 'Routes', people: 'People' };

async function TargetWorkspace({ params, searchParams }: {
  params: Promise<{ id: string }>;
  /** The timeline's filter and page size (N81): a vehicle's slug, 'unclear' or 'none'; how many rows. */
  searchParams: Promise<{ tl?: string; tln?: string; tab?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? '') ? sp.tab as Tab : 'activity';
  const d = await loadTargetWorkspace(id);
  if (!d) notFound();
  const {
    pursuit, vehicleKind, claims, notes, restrictions, routes, signals, affinityNotes, tracks, calendar, updates, statusEvents, trace, extras,
    spvHere, indicated, isPerson, windows, relatedLps, strategyPursuits, shown, counted, touchSummary, bestRoute, openSuggestion,
    emailPlan, file, proposal, theirRead, context, docMap, questions, base, count, ownClaims, sendTo, sendToBefore,
  } = d;
  return (
    <Page
      crumbs={[
        { label: pursuit.vehicleName, href: '/overview' },
        { label: 'Pipeline', href: `/targets?status=${pursuit.status}` },
        // The name that leads the page: the LP unit's own (docs/23).
        { label: pursuit.entityName },
      ]}
    >
      {(() => {
        // The header (Juan, 11 Oct 2026: "super verbose ... humans get overloaded with noise"): the status, its
        // ladder and where it came from on one row of chips, with each long reason on hover. It replaces the
        // status panel, the stepper and the side panel; the stepper and the ladder request open in place.
        const p = pursuit;
        const claimed = impliedRung(p.implied);
        const differs = p.statusSource === 'us' && p.statusSaid && p.statusSaid !== p.status;
        const needs = statusNeedsEvidence(p.status, p.rung);
        const early = (p.status === 'new' || p.status === 'sourcing' || p.status === 'selected' || p.status === 'connecting') && touchSummary.meetingDates.length > 0;
        const why = p.statusSource === 'us'
          ? `${p.statusSetByName ?? 'Someone'} set it here${p.statusSetAt ? ` on ${shortDate(p.statusSetAt)}` : ''}${p.statusReason ? `: “${p.statusReason.replace(/_/g, ' ').replace(/[.!?…]+$/, '')}”` : ', with no reason given'}.`
          : p.source === 'mail_desk'
            ? `The mail desk added this LP on its own from mail${p.statusSetAt ? ` on ${shortDate(p.statusSetAt)}` : ''}; nobody has set a status here yet.`
          : p.stageSaid
            ? `Affinity reads “${p.stageSaid}”, which maps to ${STATUS_LABEL[p.status]}. Someone set it in Affinity; when and why, Affinity doesn’t say.`
            : 'Nobody has set one: this is where every LP starts.';
        const ladder = `On the ladder: ${p.rung ? RUNG_LABEL[p.rung] : 'nothing yet'}.${claimed ? ` Affinity’s record claims ${RUNG_LABEL[claimed]}.` : ''}${file.to ? ` The records on file support ${RUNG_LABEL[file.to]}.` : ''}`;
        const t0 = tracks[0];
        return (
          <header className={hd.head}>
            <div className={hd.meta}>
              Owner {p.ownerSaid ? `${p.ownerSaid} (not on the team)` : p.ownerName} · opened {shortDate(p.openedAt)}
              {p.historical ? ' · a vehicle kept for its history' : ''}
            </div>
            <h1 className={hd.name}><Link href={`/orgs/${p.entityId}`}>{p.entityName}</Link></h1>
            {isPerson ? (
              <div className="h1second">
                {/* The firms come from the vehicle's pipeline, rebuilt after any write: the page shows without waiting for it. */}
                <Suspense fallback={<LpUnitTags capacity={p.lpCapacity} review={p.lpReview} historical={p.historical} />}>
                  <LpUnitLine pursuitId={p.pursuitId} personId={p.entityId} vehicleId={p.vehicleId} capacity={p.lpCapacity} review={p.lpReview} historical={p.historical} />
                </Suspense>
              </div>
            ) : relatedLps.length > 0 && (
              <div className="h1second">
                <span className="muted">Also individual LPs here: </span>
                {relatedLps.map((lp, i) => <span key={lp.pursuitId}>{i > 0 ? ' · ' : ''}<Link href={`/targets/${lp.pursuitId}`}>{lp.name}</Link></span>)}
              </div>
            )}
            {p.headline && <p className={hd.sub} title={p.headline}>{p.headline}</p>}

            <div className={hd.chips}>
              <span className={`${hd.chip} ${hd.cg}`} title={`${why} ${ladder}`}>
                <b>{STATUS_LABEL[p.status]}</b>
                <span className={hd.ladder} aria-label={ladder}>{RUNGS.map((r, i) => <i key={r} className={p.rung && i <= rungIndex(p.rung) ? hd.on : undefined} />)}</span>
                {p.status === 'passed' && (p.passedBy || p.statusReason) && <span className={hd.cut}>{[p.passedBy ? PASSED_BY_LABEL[p.passedBy] : null, p.statusReason?.replace('_', ' ')].filter(Boolean).join(' · ')}</span>}
              </span>
              <span className={`${hd.chip} ${hd.cm}`} title={why}>
                {p.statusSource === 'us' ? `set here${p.statusSetAt ? ` ${shortDate(p.statusSetAt)}` : ''}` : p.stageSaid ? `Affinity “${p.stageSaid}”` : 'not set yet'}
              </span>
              {p.nextStep && <span className={hd.chip} title={p.nextStep}><span className={hd.cut}>Next: {p.nextStep}</span>{p.nextStepOn ? <span className="muted">by {shortDate(p.nextStepOn)}</span> : null}</span>}
              {t0 && (
                <span className={hd.chip} title="Hard means countersigned; soft and hard never blend (rule 1).">
                  {CLOSE_STATE_LABEL[t0.state]} {usdM(t0.exposure.amount)}
                  {t0.exposure.track === 'hard' && t0.wired ? ` · ${usdM(t0.wired)} wired` : ''}
                </span>
              )}
              {indicated && (
                <span className={hd.chip} data-indicated title={`${shortDate(indicated.on)}${indicated.source === 'spv seat' ? ', IOI in the SPV war room' : indicated.recordedByName ? `, recorded by ${indicated.recordedByName}` : ''}. An indication, not a commitment: beside soft and hard, added to neither.`}>
                  Indicated: {indicated.low === indicated.high ? usdM(indicated.low) : `${usdM(indicated.low)}–${usdM(indicated.high)}`}
                  {indicated.source === 'us' && (
                    <form action={withdrawIndicationAction} style={{ display: 'inline' }}>
                      <input type="hidden" name="pursuitId" value={p.pursuitId} />
                      <button type="submit" className="linkbtn" title="Withdraw this amount, with nothing in its place. It stays on record; an SPV seat it moved to IOI goes back to where it was.">withdraw</button>
                    </form>
                  )}
                </span>
              )}
              {(sendTo || sendToBefore) && (
                <span className={`${hd.chip} ${hd.cm}`} data-send-to title={sendTo ? `Mail to them goes To this address, their main contact cc'd. Set by ${sendTo.setBy} ${shortDate(new Date(sendTo.setAt))}.` : 'No send-to address now.'}>
                  {sendTo ? `Send to: ${sendTo.email}` : 'No send-to'}
                  {sendToBefore && (
                    <form action={restoreSendToAction} style={{ display: 'inline' }}>
                      <input type="hidden" name="pursuitId" value={p.pursuitId} />
                      <input type="hidden" name="email" value={sendToBefore.email} />
                      <span className="muted" title={`Set by ${sendToBefore.setBy ?? 'someone'} ${shortDate(new Date(sendToBefore.setAt))}; replaced by ${sendToBefore.replacedBy ?? 'someone'}${sendToBefore.autonomous ? ' on its own' : ''} ${shortDate(new Date(sendToBefore.replacedAt))}.`}> · was {sendToBefore.email} </span>
                      <button type="submit" className="linkbtn">restore</button>
                    </form>
                  )}
                </span>
              )}
              {touchSummary.lastFromThem && !touchSummary.awaitingSince
                ? <span className={`${hd.chip} ${hd.ca}`}>We owe a reply · {shortDate(touchSummary.lastFromThem)}</span>
                : touchSummary.awaitingSince && p.status !== 'passed'
                  ? <span className={hd.chip}>Waiting on them · {shortDate(touchSummary.awaitingSince)}</span>
                  : null}
              <span className={`${hd.chip} ${hd.cm}`} title={meetingLine(touchSummary)}>
                {touchSummary.meetingDates.length === 0 ? 'No meeting' : `${touchSummary.meetingDates.length} ${touchSummary.meetingDates.length === 1 ? 'meeting' : 'meetings'}`}
                {touchSummary.lastTouch ? ` · last ${shortDate(touchSummary.lastTouch)}` : ''}
              </span>
              {theirRead && !theirRead.superseded && (
                <span className={`${hd.chip} ${hd.cm}`} title={theirRead.suggested ? 'Suggested from a note' : undefined}>
                  Their read: {READ_LABEL[theirRead.read].toLowerCase()}{theirRead.old ? ', old' : ''}
                </span>
              )}
              {needs && (
                <span className={`${hd.chip} ${hd.ca}`} title={`${STATUS_LABEL[p.status]} claims ${RUNG_LABEL[needs]}; the ladder hasn’t confirmed it${file.byRung[needs] ? ', though the record is on file' : ''}.`}>Needs evidence</span>
              )}
              {vehicleKind === 'spv' && spvHere?.stance === 'does-not' && (
                <span className={`${hd.chip} ${hd.cr}`} title="Check the SPVs card before moving them to Selected or further.">Doesn’t do SPVs{spvHere.short ? ` · ${spvHere.short}` : ''}</span>
              )}
              {early && <span className={`${hd.chip} ${hd.ca}`} title="A meeting is on record. The status is yours to set; nothing moves it for you.">Met, still {STATUS_LABEL[p.status]}</span>}
              {p.stageSaid && p.source !== 'us' && differs && (
                <span className={`${hd.chip} ${hd.ca}`} title={p.implied.length ? `Its record implies ${p.implied.map((i) => IMPLIED_LABEL[i]).join(', ')}.` : undefined}>Affinity now says “{p.stageSaid}”</span>
              )}
            </div>

            {restrictions.map((r) => (
              <p key={r.restrictionId} className={hd.stop} role="alert">
                <b>Do not approach via {r.connectorName ?? 'this channel'}</b> · {r.instruction}
                <span className="muted"> · {r.recordedByName ?? 'unattributed'}, {shortDate(r.recordedAt)}</span>
                <Info>The route planner excludes every path through that party and will not quietly substitute another connector toward the same approach (rule 8).</Info>
              </p>
            ))}

            <div className={hd.acts}>
              {draftingOn() && <Link className="btn p" href={`${base}?tab=email`}>Draft an email</Link>}
              <details className={hd.more}>
                <summary className="btn">Change the status</summary>
                <div className={hd.panel}>
                  <StatusForm
                    pursuitId={p.pursuitId}
                    status={p.status}
                    passedBy={p.passedBy}
                    reason={p.statusReason}
                    nextStep={p.nextStep}
                    nextStepOn={p.nextStepOn ? p.nextStepOn.toISOString().slice(0, 10) : null}
                  />
                </div>
              </details>
              <details className={hd.more}>
                <summary className="btn">The ladder{proposal ? ' · 1 to confirm' : ''}</summary>
                <div className={hd.panel}>
                  <StatusStepper pursuit={p} onFile={file} proposalId={proposal?.id ?? null} track={t0 ?? null} />
                  {p.nextRung && (proposal ? (
                    // One open STAGE ticket per pursuit (rule 3): the proposal from the records is it.
                    <p style={{ margin: '10px 0 0', fontSize: 13 }}>
                      The records support {RUNG_LABEL[file.to!]}: <Link href={`/approvals?t=${proposal.id}`}>approve or reject it</Link> first.
                    </p>
                  ) : <AdvanceForm pursuitId={p.pursuitId} nextRung={p.nextRung} />)}
                </div>
              </details>
            </div>
          </header>
        );
      })()}

      {(() => {
        // The brief (design A, Juan 11 Oct 2026): why they'd care, the next step, the way in and the ask, one line
        // each. A person's next step leads; the strategy's is marked suggested, with Accept beside it.
        const st = (openSuggestion?.data ?? null) as Strategy | null;
        const next = pursuit.nextStep ? { what: pursuit.nextStep, meta: pursuit.nextStepOn ? `by ${shortDate(pursuit.nextStepOn)}` : null, suggested: false }
        : st?.next ? { what: st.next.what, meta: [st.next.who, st.next.when].filter(Boolean).join(' · ') || null, suggested: openSuggestion?.status === 'proposed' } : null;
        if (!st && !next && !bestRoute) return null;
        return (
        <section className={`card ${hd.brief}`} aria-label="The plan">
          <dl className={hd.plan}>
            {st?.angle && <><dt>Why</dt><dd className={hd.clip} title={st.angle}>{st.angle}</dd></>}
            <dt>Next</dt>
            <dd>{next ? <><b className={hd.clip} title={next.what}>{next.what}</b> {next.meta && <span className="muted">{next.meta}</span>}{next.suggested && <span className="muted"> · suggested</span>}</> : <span className="muted">None set</span>}</dd>
            <dt>Way in</dt>
            <dd>{bestRoute ? <><span className={`tier t${bestRoute.weakestTier}`}>{bestRoute.weakestTier}</span> {[bestRoute.fromName ?? routes?.fromName, ...bestRoute.hops.map((h) => h.toName)].filter(Boolean).join(' → ')}</>
              // The strategy's own route, shown only when no path is on file: say so (red team, 17 Oct 2026).
              : st?.route ? <><span className={`tier t${st.route.tier}`}>{st.route.tier}</span> {st.route.via} <span className="muted">· the strategy&rsquo;s suggestion; no path on file</span></>
                : <span className="muted">{routes ? 'No supported route found' : 'No route search could run'}</span>}</dd>
            {st?.ask && <><dt>Ask</dt><dd>{st.ask.shape}{st.ask.range ? ` · ${st.ask.range}` : ''} <span className="muted">· {st.list === 'this year' ? 'this year' : st.list === '2027' ? '2027' : 'not now'}</span></dd></>}
          </dl>
          {openSuggestion?.status === 'proposed' && !pursuit.nextStep && (
            <form action={decideSuggestionAction} className={hd.acts}>
              <input type="hidden" name="suggestionId" value={openSuggestion.suggestionId} />
              <input type="hidden" name="pursuitId" value={pursuit.pursuitId} />
              <button className="btn" name="decision" value="accept" type="submit">Accept next step</button>
              <Link href={`${base}?tab=strategy`}>Full strategy</Link>
            </form>
          )}
        </section>
        );
      })()}

      {/* Each kind of detail on its own tab, with its own address (design A, step 2). */}
      <nav className={hd.tabs} aria-label="LP detail">
        {TABS.map((k) => (
        // The other tabs are fetched whole as soon as the page shows, so a tab click answers at once (16 Oct 2026).
        <Link key={k} href={k === 'activity' ? base : `${base}?tab=${k}`} aria-current={k === tab ? 'page' : undefined} prefetch={k === tab ? undefined : true}>
          {TAB_LABEL[k]}{count[k] ? <small>{count[k]}</small> : null}
        </Link>
        ))}
      </nav>

      {tab === 'activity' && <>
        {tracks.map((t) => <CloseTrack key={t.exposure.exposureId} track={t} pursuitId={pursuit.pursuitId} />)}
        {signals.length > 0 && (
          <div className="card">
            <div className="chead">
              <h2>What changed</h2>
            </div>
            {signals.map((s) => (
              <SignalRow key={s.signalId} signal={s} compact />
            ))}
          </div>
        )}
        <Timeline
          touches={shown}
          counted={counted}
          windows={[...windows.values()]}
          summary={touchSummary}
          notes={affinityNotes}
          pursuitId={pursuit.pursuitId}
          entityId={pursuit.entityId}
          vehicleId={pursuit.vehicleId}
          vehicleName={pursuit.vehicleName}
          calendarPartial={Boolean((calendar?.detail as { stoppedAtCap?: boolean } | undefined)?.stoppedAtCap)}
          context={context}
          sameAs={Object.fromEntries(trace.sameAs)}
          subjects={Object.fromEntries([...trace.messageOf].map(([k, m]) => [k, m.subject ?? '']))}
          mismatches={trace.flags.map((f) => f.text)}
          extras={extras}
          read={theirRead}
          status={pursuit.status}
          today={new Date().toISOString().slice(0, 10)}
          updates={updates}
          statusEvents={statusEvents}
          ladder={pursuit.events}
          onRecord={file.byRung}
          proposalId={proposal?.id ?? null}
          filter={sp.tl ?? 'all'}
          limit={Math.max(1, Math.min(5000, Number(sp.tln) || 40))}
          path={`/targets/${pursuit.pursuitId}`}
        />
        {pursuit.plan.length > 0 && <div className="card">
          <div className="chead">
            <h2>Next moves</h2>
          </div>
          <div className="cbody">
            <ol className="moves">
                {pursuit.plan.map((step) => (
                  <li key={step.move}>
                    {step.move}
                    <small>{step.because}</small>
                    {step.blockedBy && <span className="block">Blocked: {step.blockedBy}</span>}
                  </li>
                ))}
              </ol>
          </div>
        </div>}
      </>}
      {tab === 'email' && <>
        {/* What the sender needs to decide, in place of an approval (Juan, 5 Oct 2026). */}
        <OutreachContext entityId={pursuit.entityId} vehicleId={pursuit.vehicleId} pursuitId={pursuit.pursuitId} trace={trace}
          connectorId={emailPlan.purpose === 'intro_ask' ? emailPlan.connector?.entityId ?? null : null}
          connectorName={emailPlan.purpose === 'intro_ask' ? emailPlan.connector?.name ?? null : null} />
        {/* The first message, written here and moved to the person's own Gmail Drafts (docs/25). Above the
            timeline (Juan, 3 Oct 2026: under a 4,000 px timeline and the strategies it was never seen). */}
        <EmailDrafts
          title="Email"
          lede={`${KIND_LABEL[emailPlan.kind]}${emailPlan.sender ? `, from ${emailPlan.sender}` : ''}, about ${pursuit.vehicleName}. ${emailPlan.why}`}
          where={{ pursuitId: pursuit.pursuitId }}
          create={emailPlan.purpose === 'intro_ask' && emailPlan.connector
            ? { purpose: 'intro_ask', vehicleId: pursuit.vehicleId, pursuitId: pursuit.pursuitId, connectorId: emailPlan.connector.entityId }
            : { purpose: 'first_message', vehicleId: pursuit.vehicleId, pursuitId: pursuit.pursuitId }}
          path={`/targets/${pursuit.pursuitId}?tab=email`}
          startLabel={emailPlan.purpose === 'intro_ask' && emailPlan.connector ? `Draft the intro ask to ${emailPlan.connector.name}` : 'Draft the first message'}
          alternative={emailPlan.purpose === 'intro_ask' && emailPlan.connector
            ? { label: 'Draft the first message to them instead', create: { purpose: 'first_message', vehicleId: pursuit.vehicleId, pursuitId: pursuit.pursuitId } }
            : null}
        />
      </>}
      {tab === 'strategy' && <>
        {strategyPursuits.map((p) => <SuggestedStrategy key={p.pursuitId} pursuitId={p.pursuitId} vehicleName={p.vehicleName} context={notes.filter((n) => n.kind === 'context').map((n) => ({ by: n.author, at: n.createdAt, body: n.body }))} />)}
        {/* Context or a correction from the team (issue 0016): research on this LP, read first by the strategy workflow. */}
        <AddContext
          pursuitId={pursuit.pursuitId}
          entityId={pursuit.entityId}
          vehicleId={pursuit.vehicleId}
          notes={notes.filter((n) => n.kind === 'context').map((n) => ({ id: n.noteId, by: n.author, on: shortDate(n.createdAt), body: n.body }))}
        />
        {questions.length > 0 && <div className="card">
          <div className="chead">
            <h2>Open questions</h2>
            <span className="lbl">{questions.length}</span>
          </div>
          <div className="cbody">
            {(
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
        </div>}
      </>}
      {tab === 'research' && <>
        {ownClaims.length > 0 && <div className="card">
          <div className="chead">
            <h2>What we know</h2>
          </div>
          <div className="cbody">
            {(
              ownClaims.map((c) => (
                <div className="fact" key={c.claimId} title={`${c.provenance.source} · as of ${shortDate(c.provenance.asOf)} · ${c.provenance.confidence}${c.provenance.lastVerifiedBy ? ` · verified by ${c.provenance.lastVerifiedBy}` : ' · unverified'}`}>
                  <span>{claimLabel(c.field)}</span>
                  <span>
                    {claimValue(c.field, c.value)}
                    {docMap.has(c.provenance.source) && <EvidenceRef doc={docMap.get(c.provenance.source)!} />}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>}
        <BeforeOutreach entityId={pursuit.entityId} />
        <DakotaClaims entityId={pursuit.entityId} />
        <PublicProfile entityId={pursuit.entityId} />
      </>}
      {tab === 'routes' && <>
        <WarmIntroBox search={routes} entityId={pursuit.entityId} />
        <div className="card">
          <div className="chead">
            <h2>Routes in</h2>
            <span className="lbl">best first</span>
          </div>
          {!routes || routes.routes.length === 0 ? (
            <div className="cbody">
              <p className="muted">{routes
                ? `No supported route found from the team or PL in the relationships on file${routes.candidateCounts ? ` (${routes.candidateCounts.total} paths looked at)` : ''}.`
                : 'No route search could run: nothing on file to start one from. That is not the same as no route.'}</p>
            </div>
          ) : (
            routes.routes.filter((r) => r.foldedUnder == null).slice(0, 3).map((route, i) => (
              <div className="route" key={i}>
                <span className={`tier t${route.weakestTier}`}>{route.weakestTier}</span>
                <div className="rt">
                  <b>
                    {route.fromName ?? routes.fromName} → {route.hops.map((h) => h.toName).join(' → ')}
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
        <ConnectionFeedback key={pursuit.entityId} lp={pursuit.entityId} />
      </>}
      {tab === 'people' && <>
        {/* An organisation that is the LP lists its people (issue 0092). */}
        {(() => {
          // The LP unit (docs/23): an organisation's page lists its people; a person's asks who the LP is.
          // Both read the vehicle's pipeline, rebuilt after any write (0.27 s on the Mac's copy, 15 Oct 2026): the rest of
          // the page is sent first and this card follows.
          return <Suspense fallback={null}>{isPerson
            ? <LpUnitCard pursuitId={pursuit.pursuitId} personId={pursuit.entityId} personName={pursuit.entityName} vehicleId={pursuit.vehicleId}
                capacity={pursuit.lpCapacity} review={pursuit.lpReview} historical={pursuit.historical} />
            : <OrgPeople orgId={pursuit.entityId} orgName={pursuit.entityName} vehicleId={pursuit.vehicleId} currentPursuitId={pursuit.pursuitId} />}</Suspense>;
        })()}
        {/* Whether they do SPVs (Juan, 27 Sep 2026): the stance, its evidence, and a person's setting. */}
        <SpvCard entityId={pursuit.entityId} entityName={pursuit.entityName} spvVehicle={vehicleKind === 'spv'} />
      </>}
    </Page>
  );
}

export default coalescePage('/targets/[id]', TargetWorkspace);
