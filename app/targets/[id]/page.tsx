import { DakotaClaims } from '@/components/entity/DakotaClaims';
import { coalescePage } from '@/lib/page-render';
import Link from '@/components/ui/AppLink';
import { notFound } from 'next/navigation';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { StatusStepper } from '@/components/strategy/StatusStepper';
import { AdvanceForm } from '@/components/strategy/AdvanceForm';
import { EvidenceRef, type EvidenceDoc } from '@/components/ui/EvidenceRef';
import { Coverage } from '@/components/ui/Coverage';
import { auth } from '@/lib/auth';
import { shortDate } from '@/lib/time';
import {
  IMPLIED_LABEL, PASSED_BY_LABEL, RUNG_LABEL, STATUS_LABEL, getPursuit, impliedRung, spvMarks, statusNeedsEvidence, strategyPursuitsFor, suggestionsFor, updatesFor,
} from '@/lib/authz/read/strategy';
import { chooseFirstEmail, draftingOn, KIND_LABEL } from '@/modules/email';
import { routeReading } from '@/components/routes/route-display';
import { getDb } from '@/lib/db';
import { auditFor } from '@/modules/platform';
import { StatusForm } from '@/components/strategy/StatusForm';
import { Timeline, meetingLine, type StatusEvent, type TouchContext } from '@/components/strategy/Timeline';
import { READ_LABEL, aboutThisRaise, type Touchpoint, raiseWindows, summarize, touchpointsFor } from '@/modules/meetings';
import { relatedLpHeadings } from '@/lib/authz/read/headings';
import { LpUnitCard, LpUnitLine } from '@/components/strategy/LpUnit';
import { SpvCard } from '@/components/strategy/SpvCard';
import { latestRun } from '@/modules/sources';
import { CLOSE_STATE_LABEL, closeTracksFor, indicationFor } from '@/modules/pipeline';
import { CloseTrack } from '@/components/strategy/CloseTrack';
import { usdM } from '@/lib/money';
import { claimLabel, claimsFor, listSourceDocs, notesFor } from '@/lib/authz/read/research';
import { usdCompact } from '@/lib/money';
import { restrictionsFor } from '@/modules/coordination';
import { planRoutes, VERDICT_LABEL } from '@/lib/authz/read/network';
import { signalsFor } from '@/modules/signals';
import { SignalRow } from '@/components/signals/SignalRow';
import { firstSentence, notesAbout } from '@/lib/connectors/affinity/notes';
import { meetingTitles } from '@/lib/connectors/affinity/meetings';
import { readingsFor } from '@/lib/connectors/affinity/readings';
import { laterFacts, shownRead } from '@/lib/reads';
import { onFile } from '@/lib/reconcile';
import { ConnectionFeedback } from '@/components/routes/ConnectionFeedback';
import { PublicProfile } from '@/components/entity/PublicProfile';
import { SuggestedStrategy } from '@/components/strategy/SuggestedStrategy';
import { AddContext } from '@/components/strategy/AddContext';
import { OrgPeople, WarmIntroBox } from '@/components/strategy/LpSideCards';
import hd from './lp-header.module.css';
import { RUNGS, rungIndex } from '@/modules/strategy';
import { listEntities } from '@/lib/authz/read/identity';
import { listVehicles } from '@/modules/platform';
import { BeforeOutreach } from '@/components/strategy/BeforeOutreach';
import { findOpenTicket } from '@/modules/governance';
import { EmailDrafts } from '@/components/email/EmailDrafts';
import { OutreachContext } from '@/components/outreach/OutreachContext';
import { linearFor, traceFor } from '@/lib/comms/read';
import { decideSuggestionAction } from '@/app/targets/actions';
import type { Strategy } from '@/lib/enrich/strategy';
import { Info } from '@/components/ui/Info';

export const dynamic = 'force-dynamic';

/** A translated amount is dollars as digits; it reads as a figure. Anything else as written. */
const claimValue = (field: string, value: string) =>
  /_usd$/.test(field) && Number.isFinite(Number(value)) ? usdCompact(Number(value)) : value;

/** The page's tabs (design A, 11 Oct 2026), each at its own address: ?tab=<key>; Activity is the page itself. */
const TABS = ['activity', 'email', 'strategy', 'research', 'routes', 'people'] as const;
type Tab = typeof TABS[number];
const TAB_LABEL: Record<Tab, string> = { activity: 'Activity', email: 'Email', strategy: 'Strategy', research: 'Research', routes: 'Routes', people: 'People' };

async function TargetWorkspace({ params, searchParams }: {
  params: Promise<{ id: string }>;
  /** The timeline's filter and page size (N81): a vehicle's slug, 'unclear' or 'none'; how many rows. */
  searchParams: Promise<{ tl?: string; tln?: string; tab?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? '') ? sp.tab as Tab : 'activity';
  const pursuit = await getPursuit(id);
  if (!pursuit) notFound();

  const [user, vehicles, [entity]] = await Promise.all([(async () => (await auth()).currentUser())(), listVehicles(), listEntities([pursuit.entityId])]);
  // The routes page's own search — team scope, three hops, this vehicle — so the warm intro box
  // and the page it opens agree (issue 0093).
  const vehicleKind = vehicles.find((v) => v.id === pursuit.vehicleId)?.kind ?? 'fund';
  const [claims, notes, restrictions, routes, signals, affinityNotes, tracks, calendar, readings, logged, updates, statusLog] = await Promise.all([
    claimsFor(pursuit.entityId),
    notesFor(pursuit.entityId),
    restrictionsFor(pursuit.entityId),
    planRoutes(user.handle, pursuit.entityId, 3, vehicleKind, 'team', undefined, { vehicleId: pursuit.vehicleId }),
    signalsFor(pursuit.entityId),
    notesAbout(pursuit.entityId),
    closeTracksFor(pursuit.entityId, pursuit.vehicleId),
    latestRun('affinity', 'meetings'),
    readingsFor([pursuit.entityId]),
    touchpointsFor(pursuit.entityId, null),
    updatesFor(pursuit.pursuitId),
    auditFor('pursuit', pursuit.pursuitId, ['pursuit.status_set']),
  ]);
  // The comms trace (Juan, 5 Oct 2026): Affinity's records merged with the Gmail messages juanmail reported, one
  // row per message, each with its source. Everything below — the timeline, last touch, who owes a reply — reads it.
  const [trace, linear] = await Promise.all([traceFor(pursuit.entityId, logged), linearFor(pursuit.pursuitId)]);
  const everything = trace.touches;
  // Notes from elsewhere on the same thread (5 Oct 2026): the team's context notes here, and Linear issues linked to the pursuit.
  const extras = [
    ...notes.filter((n) => n.kind === 'context').map((n) => ({ key: `pn:${n.noteId}`, at: n.createdAt, source: 'plcos' as const, label: 'PLC OS note', text: n.body, by: n.author, href: null })),
    ...linear.filter((i) => i.completedAt ?? i.createdAt).map((i) => ({ key: `li:${i.id}`, at: (i.completedAt ?? i.createdAt)!, source: 'linear' as const,
      label: i.completedAt ? 'Linear issue, done' : 'Linear issue', text: [i.identifier, i.title].filter(Boolean).join(' '), by: null, href: i.url })),
  ];
  const [docs, spvMarkMap, indicated] = await Promise.all([
    listSourceDocs([...new Set(claims.map((c) => c.provenance.source))]),
    spvMarks(await getDb(), [pursuit.entityId]),
    // What they indicated (docs/27 §1): shown beside soft and hard, never added to either.
    indicationFor(pursuit.entityId, pursuit.vehicleId),
  ]);
  const spvHere = spvMarkMap.get(pursuit.entityId);
  // Status changes, for the timeline (N61). Before N61 the log kept a reason only for a pass;
  // the latest change's reason is still on the pursuit, so it is read from there.
  const statusEvents: StatusEvent[] = statusLog.map((a, i) => {
    const d = a.detail as { from?: string; to?: string; reason?: string; updateId?: string };
    const last = i === statusLog.length - 1 && d.to === STATUS_LABEL[pursuit.status];
    return {
      at: a.at, from: d.from ?? '?', to: d.to ?? '?', byName: a.actor,
      reason: d.reason ?? (last ? pursuit.statusReason : null), updateId: d.updateId ?? null,
    };
  });
  // The page's LP is the pursuit's own unit (issue 0111, docs/23): a person's page is theirs as an
  // individual, with their firm as context. Before, a person whose firm was the LP led with the firm
  // and borrowed its other people's meetings (issue 0013); that pursuit now belongs to the firm.
  const isPerson = entity?.entityType === 'person';
  const [colleaguesAll, windows, relatedLps, strategyPursuits] = await Promise.all([
    // An organisation's contacts' meetings reach its timeline through the touchpoint read itself.
    Promise.resolve([] as Touchpoint[]),
    raiseWindows(),
    relatedLpHeadings(pursuit.entityId, pursuit.vehicleId),
    strategyPursuitsFor(pursuit.entityId),
  ]);
  const window = windows.get(pursuit.vehicleId);
  const forRaise = (t: Touchpoint) => (!t.vehicleId || t.vehicleId === pursuit.vehicleId)
    && (!window || aboutThisRaise(t, window));
  const touches = everything.filter(forRaise);
  const colleagues = colleaguesAll.filter(forRaise);
  // Every touchpoint with them shows on the timeline, each saying what it is about (N81); those
  // tagged with this vehicle are counted for it.
  const shown = [...everything, ...colleaguesAll];
  const counted = new Set([...touches, ...colleagues].map((t) => t.touchpointId));
  const touchSummary = summarize(touches);
  // Which email to offer first (docs/email-guidelines.md §Kinds): the strategy's own first message
  // when it has one; else the best warm route decides — through someone, to an LP who has not met
  // us, the first email is the intro ask to that connector, not a cold note from whoever clicks.
  const everSummary = summarize(everything);
  const bestRoute = (routes?.routes ?? []).filter((r) => r.foldedUnder == null && r.verdict === 'recommend')
    .sort((a, b) => routeReading(b).score - routeReading(a).score)[0] ?? null;
  const openSuggestion = (await suggestionsFor(pursuit.pursuitId)).find((x) => x.status !== 'dismissed' && x.status !== 'withdrawn');
  const emailPlan = chooseFirstEmail({
    firstMessage: (openSuggestion?.data as { firstMessage?: unknown } | null)?.firstMessage ?? null,
    best: bestRoute ? {
      holder: bestRoute.fromName ?? routes?.fromName ?? null,
      connector: bestRoute.connectorIds[0] ? { entityId: bestRoute.connectorIds[0], name: bestRoute.connectorNames[0] ?? 'the connector' } : null,
      tier: bestRoute.weakestTier,
    } : null,
    metUs: everSummary.meetingDates.length > 0 || Boolean(everSummary.lastFromThem),
  });
  // What the records here support, beside what the ladder has accepted (N57, docs/18).
  const file = onFile(pursuit, touches, tracks);
  const proposal = file.climb.length ? await findOpenTicket('STAGE', 'pursuit', pursuit.pursuitId) : null;
  const theirRead = shownRead(touchSummary.read, readings, laterFacts(pursuit, tracks));
  // What each touchpoint was about: the meeting's title from the calendar, and the note Affinity
  // ties to the same interaction — its summary, and all of it a click away.
  const interactionOf = (ref: string | null) => {
    const m = /^interaction:([a-z-]+):(\d+):/.exec(ref ?? '');
    return m ? { type: m[1]!, id: m[2]! } : null;
  };
  const titles = await meetingTitles(shown.map((t) => interactionOf(t.sourceRef)).filter((x) => x?.type === 'meeting').map((x) => x!.id));
  const noteOn = new Map(affinityNotes.filter((x) => x.interaction).map((x) => [`${x.interaction!.type}:${x.interaction!.id}`, x]));
  const context: Record<string, TouchContext> = {};
  for (const t of shown) {
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
  const base = `/targets/${pursuit.pursuitId}`;
  const count: Partial<Record<Tab, number>> = {
    activity: shown.length, strategy: strategyPursuits.length, routes: (routes?.routes ?? []).filter((r) => r.foldedUnder == null).length,
  };
  // Public-source facts (N64) are in their own card, with their pages; these are the rest.
  const ownClaims = claims.filter((c) => !c.field.startsWith('public.'));

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
                <LpUnitLine pursuitId={p.pursuitId} personId={p.entityId} vehicleId={p.vehicleId} capacity={p.lpCapacity} review={p.lpReview} />
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
              : st?.route ? <><span className={`tier t${st.route.tier}`}>{st.route.tier}</span> {st.route.via}</>
                : <span className="muted">No supported route found</span>}</dd>
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
        <Link key={k} href={k === 'activity' ? base : `${base}?tab=${k}`} aria-current={k === tab ? 'page' : undefined}>
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
              <p className="muted">No supported route found from the team or PL.</p>
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
          return isPerson
            ? <LpUnitCard pursuitId={pursuit.pursuitId} personId={pursuit.entityId} personName={pursuit.entityName} vehicleId={pursuit.vehicleId}
                capacity={pursuit.lpCapacity} review={pursuit.lpReview} historical={pursuit.historical} />
            : <OrgPeople orgId={pursuit.entityId} orgName={pursuit.entityName} vehicleId={pursuit.vehicleId} currentPursuitId={pursuit.pursuitId} />;
        })()}
        {/* Whether they do SPVs (Juan, 27 Sep 2026): the stance, its evidence, and a person's setting. */}
        <SpvCard entityId={pursuit.entityId} entityName={pursuit.entityName} spvVehicle={vehicleKind === 'spv'} />
      </>}
    </Page>
  );
}

export default coalescePage('/targets/[id]', TargetWorkspace);
