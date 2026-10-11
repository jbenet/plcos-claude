import { notFound } from 'next/navigation';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { getPursuit, spvMarks, statusNeedsEvidence, strategyPursuitsFor, suggestionsFor, STATUS_LABEL } from '@/lib/authz/read/strategy';
import { listEntities } from '@/lib/authz/read/identity';
import { claimsFor, notesFor } from '@/lib/authz/read/research';
import { planRoutes } from '@/lib/authz/read/network';
import { routeReading } from '@/components/routes/route-display';
import { traceFor } from '@/lib/comms/read';
import { traceState } from '@/lib/comms/trace';
import { restrictionsFor } from '@/modules/coordination';
import { aboutThisRaise, raiseWindows, summarize, touchpointsFor, type Touchpoint } from '@/modules/meetings';
import { closeTracksFor, indicationFor, CLOSE_STATE_LABEL } from '@/modules/pipeline';
import { listVehicles } from '@/modules/platform';
import { signalsFor } from '@/modules/signals';
import { usdM } from '@/lib/money';
import type { Strategy } from '@/lib/enrich/strategy';
import type { PursuitStatus } from '@/modules/strategy';

/**
 * What the compared LP page designs (A, B and C, 11 Oct 2026; docs/strategy/lp-pages.md) read: the same loaders as
 * the LP page itself, reduced to the short answers the designs show. A design trial: the current page at
 * /targets/<id> is unchanged, and nothing here writes.
 */
export async function loadLp(id: string) {
  const pursuit = await getPursuit(id);
  if (!pursuit) notFound();
  const [user, vehicles, [entity]] = await Promise.all([(async () => (await auth()).currentUser())(), listVehicles(), listEntities([pursuit.entityId])]);
  const vehicle = vehicles.find((v) => v.id === pursuit.vehicleId) ?? null;
  const kind = vehicle?.kind ?? 'fund';
  const db = await getDb();
  const [claims, notes, restrictions, routes, signals, tracks, logged, windows, suggestions, strategyPursuits, indicated, marks, others] = await Promise.all([
    claimsFor(pursuit.entityId),
    notesFor(pursuit.entityId),
    restrictionsFor(pursuit.entityId),
    planRoutes(user.handle, pursuit.entityId, 3, kind, 'team', undefined, { vehicleId: pursuit.vehicleId }),
    signalsFor(pursuit.entityId),
    closeTracksFor(pursuit.entityId, pursuit.vehicleId),
    touchpointsFor(pursuit.entityId, null),
    raiseWindows(),
    suggestionsFor(pursuit.pursuitId),
    strategyPursuitsFor(pursuit.entityId),
    indicationFor(pursuit.entityId, pursuit.vehicleId),
    spvMarks(db, [pursuit.entityId]),
    db.query<{ pursuit_id: string; name: string; slug: string; status: PursuitStatus }>(`select p.pursuit_id::text, v.name, v.slug, p.status::text status
      from strategy.active_pursuit p join platform.vehicle v on v.id = p.vehicle_id
      where identity.canonical_entity_id(p.entity_id) = identity.canonical_entity_id($1::uuid) and p.vehicle_id <> $2 and v.phase <> 'historical'
      order by v.sort_order`, [pursuit.entityId, pursuit.vehicleId]),
  ]);
  const trace = await traceFor(pursuit.entityId, logged);
  const window = windows.get(pursuit.vehicleId);
  const forRaise = (t: Touchpoint) => (!t.vehicleId || t.vehicleId === pursuit.vehicleId) && (!window || aboutThisRaise(t, window));
  const touches = trace.touches.filter(forRaise);
  const summary = summarize(touches);
  const state = traceState({ ...trace, touches });
  const now = new Date();
  // Every touch with them, newest first, for the one-line feeds; research passes are not contact.
  const feed = trace.touches.filter((t) => t.channel !== 'research' && (t.on ?? t.scheduledFor))
    .sort((a, b) => ((b.on ?? b.scheduledFor)!.getTime() - (a.on ?? a.scheduledFor)!.getTime()))
    .map((t) => ({ ...t, subject: trace.messageOf.get(t.touchpointId)?.subject ?? null, counted: forRaise(t) }));

  const live = suggestions.find((s) => s.status === 'proposed' || s.status === 'accepted') ?? null;
  const strategy = live ? { ...live, data: live.data as unknown as Strategy } : null;
  const best = (routes?.routes ?? []).filter((r) => r.foldedUnder == null && r.verdict === 'recommend')
    .sort((a, b) => routeReading(b).score - routeReading(a).score)[0] ?? null;
  const routeList = (routes?.routes ?? []).filter((r) => r.foldedUnder == null);
  const strategyOthers = (await Promise.all(strategyPursuits.filter((p) => p.pursuitId !== pursuit.pursuitId)
    .map(async (p) => ({ ...p, s: (await suggestionsFor(p.pursuitId)).find((x) => x.status === 'proposed' || x.status === 'accepted') ?? null }))))
    .filter((p) => p.s);

  const madeAt = strategy?.madeAt ?? null;
  const newer = madeAt ? feed.filter((t) => t.on && t.on > madeAt && t.on <= now) : [];
  const money = [
    tracks[0] ? `${CLOSE_STATE_LABEL[tracks[0].state]} ${usdM(tracks[0].exposure.amount)}${tracks[0].exposure.track === 'hard' && tracks[0].wired ? `, ${usdM(tracks[0].wired)} wired` : ''}` : null,
    indicated ? `Indicated ${indicated.low === indicated.high ? usdM(indicated.low) : `${usdM(indicated.low)}–${usdM(indicated.high)}`}` : null,
  ].filter(Boolean) as string[];

  return {
    pursuit, entity, vehicle, kind, user,
    restrictions, signals, tracks, claims,
    questions: notes.filter((n) => n.kind === 'open_question'),
    contextNotes: notes.filter((n) => n.kind === 'context'),
    summary, owes: state.owes, thread: state.thread, feed,
    strategy, strategyOthers, newer,
    best, routeList, routes,
    money, indicated,
    spv: marks.get(pursuit.entityId) ?? null,
    needsEvidence: statusNeedsEvidence(pursuit.status, pursuit.rung),
    others: others.map((o) => ({ pursuitId: o.pursuit_id, name: o.name, slug: o.slug, status: STATUS_LABEL[o.status] })),
    now,
  };
}

export type LpData = Awaited<ReturnType<typeof loadLp>>;
