/** The LP page's reads (app/targets/[id]/page.tsx), apart from its markup so they can be measured and compared. */
import { type EvidenceDoc } from '@/components/ui/EvidenceRef';
import { currentUser } from '@/lib/auth';
import { shortDate } from '@/lib/time';
import { STATUS_LABEL, getPursuit, spvMarks, strategyPursuitsFor, suggestionsFor, updatesFor } from '@/lib/authz/read/strategy';
import { chooseFirstEmail } from '@/modules/email';
import { routeReading } from '@/components/routes/route-display';
import { getDb } from '@/lib/db';
import { auditFor, listVehicles } from '@/modules/platform';
import { type StatusEvent, type TouchContext } from '@/components/strategy/Timeline';
import { aboutThisRaise, type Touchpoint, raiseWindows, summarize, touchpointsFor } from '@/modules/meetings';
import { relatedLpHeadings } from '@/lib/authz/read/headings';
import { latestRun } from '@/modules/sources';
import { closeTracksFor, indicationFor } from '@/modules/pipeline';
import { claimsFor, listSourceDocs, notesFor } from '@/lib/authz/read/research';
import { restrictionsFor } from '@/modules/coordination';
import { planRoutes } from '@/lib/authz/read/network';
import { signalsFor } from '@/modules/signals';
import { firstSentence, notesAbout } from '@/lib/connectors/affinity/notes';
import { meetingTitles } from '@/lib/connectors/affinity/meetings';
import { readingsFor } from '@/lib/connectors/affinity/readings';
import { laterFacts, shownRead } from '@/lib/reads';
import { onFile } from '@/lib/reconcile';
import { listEntities } from '@/lib/authz/read/identity';
import { findOpenTicket } from '@/modules/governance';
import { linearFor, traceFor } from '@/lib/comms/read';
import { previousSendTo, sendToFor } from '@/lib/outreach/entity-reads';

/** The page's tabs (design A, 11 Oct 2026), each at its own address: ?tab=<key>; Activity is the page itself. */
export const TABS = ['activity', 'email', 'strategy', 'research', 'routes', 'people'] as const;
export type Tab = typeof TABS[number];

/** Every read the LP page's header, brief and tabs share; null when the pursuit is not there or not visible. */
export async function loadTargetWorkspace(id: string) {
  const pursuit = await getPursuit(id);
  if (!pursuit) return null;

  // Every read starts as soon as what it needs is known (perf, 17 Oct 2026): the page waited on seven rounds in a
  // row, each until its slowest read. Now one round, and inside it the reads that need another wait only for it.
  const userAt = currentUser();
  // The routes page's own search — team scope, three hops, this vehicle — so the warm intro box
  // and the page it opens agree (issue 0093).
  const kindAt = listVehicles().then((vehicles) => vehicles.find((v) => v.id === pursuit.vehicleId)?.kind ?? 'fund');
  const claimsAt = claimsFor(pursuit.entityId);
  const loggedAt = touchpointsFor(pursuit.entityId, null);
  // The comms trace (Juan, 5 Oct 2026): Affinity's records merged with the Gmail messages juanmail reported, one
  // row per message, each with its source. Everything below — the timeline, last touch, who owes a reply — reads it.
  const traceAt = traceFor(pursuit.entityId, loggedAt);
  // An organisation's contacts' meetings reach its timeline through the touchpoint read itself.
  const colleaguesAll = [] as Touchpoint[];
  // What each touchpoint was about: the meeting's title from the calendar, and the note Affinity
  // ties to the same interaction — its summary, and all of it a click away.
  const interactionOf = (ref: string | null) => {
    const m = /^interaction:([a-z-]+):(\d+):/.exec(ref ?? '');
    return m ? { type: m[1]!, id: m[2]! } : null;
  };
  const [
    vehicleKind, [entity], claims, notes, restrictions, routes, signals, affinityNotes, tracks, calendar, readings, updates, statusLog,
    trace, linear, docs, spvMarkMap, indicated, windows, relatedLps, strategyPursuits, suggestions, titles, sendTo, sendToBefore,
  ] = await Promise.all([
    kindAt,
    listEntities([pursuit.entityId]),
    claimsAt,
    notesFor(pursuit.entityId),
    restrictionsFor(pursuit.entityId),
    Promise.all([userAt, kindAt]).then(([user, vehicleKind]) =>
      planRoutes(user.handle, pursuit.entityId, 3, vehicleKind, 'team', undefined, { vehicleId: pursuit.vehicleId })),
    signalsFor(pursuit.entityId),
    notesAbout(pursuit.entityId),
    closeTracksFor(pursuit.entityId, pursuit.vehicleId),
    latestRun('affinity', 'meetings'),
    readingsFor([pursuit.entityId]),
    updatesFor(pursuit.pursuitId),
    auditFor('pursuit', pursuit.pursuitId, ['pursuit.status_set']),
    traceAt,
    linearFor(pursuit.pursuitId),
    claimsAt.then((claims) => listSourceDocs([...new Set(claims.map((c) => c.provenance.source))])),
    getDb().then((db) => spvMarks(db, [pursuit.entityId])),
    // What they indicated (docs/27 §1): shown beside soft and hard, never added to either.
    indicationFor(pursuit.entityId, pursuit.vehicleId),
    raiseWindows(),
    relatedLpHeadings(pursuit.entityId, pursuit.vehicleId),
    strategyPursuitsFor(pursuit.entityId),
    suggestionsFor(pursuit.pursuitId),
    traceAt.then((trace) => meetingTitles([...trace.touches, ...colleaguesAll].map((t) => interactionOf(t.sourceRef))
      .filter((x) => x?.type === 'meeting').map((x) => x!.id))),
    // Where their mail goes To (docs/27 §5c), and the address it replaced, to put back (red team, 17 Oct 2026).
    sendToFor([pursuit.entityId]).then((m) => m.values().next().value ?? null),
    previousSendTo(pursuit.entityId),
  ]);
  const everything = trace.touches;
  // Notes from elsewhere on the same thread (5 Oct 2026): the team's context notes here, and Linear issues linked to the pursuit.
  const extras = [
    ...notes.filter((n) => n.kind === 'context').map((n) => ({ key: `pn:${n.noteId}`, at: n.createdAt, source: 'plcos' as const, label: 'PLC OS note', text: n.body, by: n.author, href: null })),
    ...linear.filter((i) => i.completedAt ?? i.createdAt).map((i) => ({ key: `li:${i.id}`, at: (i.completedAt ?? i.createdAt)!, source: 'linear' as const,
      label: i.completedAt ? 'Linear issue, done' : 'Linear issue', text: [i.identifier, i.title].filter(Boolean).join(' '), by: null, href: i.url })),
  ];
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
  const openSuggestion = suggestions.find((x) => x.status !== 'dismissed' && x.status !== 'withdrawn');
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

  return {
    pursuit, vehicleKind, claims, notes, restrictions, routes, signals, affinityNotes, tracks, calendar, updates, statusEvents, trace, extras,
    spvHere, indicated, isPerson, windows, relatedLps, strategyPursuits, shown, counted, touchSummary, bestRoute, openSuggestion,
    emailPlan, file, proposal, theirRead, context, docMap, questions, base, count, ownClaims, sendTo, sendToBefore,
  };
}
