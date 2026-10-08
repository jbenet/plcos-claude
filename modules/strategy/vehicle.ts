import { dakotaCapacities } from '@/lib/connectors/dakota/view';
import { config } from '@/config/deployment';
import { getDb } from '@/lib/db';
import { CONTEXT_BY_RULE, isStale, type Strategy } from '@/lib/enrich/strategy';
import { vehicleTotals, listExposures } from '@/modules/pipeline';
import { touchpointSummaries, touchpointsByPair } from '@/modules/meetings';
import { buildCache } from '@/lib/build-cache';
import { strategyRouteSummaries, type RecordedRoute } from '@/modules/network';
import { listPursuits } from './repo';

/** One vehicle's pursuits and their touchpoints, read once per revision for both the list and the
 * vehicle's plan, which each read them in full (performance pass, 8 Oct 2026). Immutable to callers. */
export const pursuitsOn = buildCache((vehicleId: string) => listPursuits(vehicleId));
export const touchesOn = buildCache(async (vehicleId: string) =>
  touchpointsByPair((await pursuitsOn(vehicleId)).map((p) => ({ entityId: p.entityId, vehicleId }))));
import { STATUSES, type PursuitStatus } from './types';

const rules = config.strategyRanking;
const DAY = 86_400_000;
export interface Transition { pursuitId: string; from: PursuitStatus; to: PursuitStatus; at: Date }
/** Old audit rows used display labels. Normalize them; never infer history from today's stock. */
export function statusId(value: unknown): PursuitStatus | null {
  return STATUSES.find(s => s.id === String(value).toLowerCase() || s.label.toLowerCase() === String(value).toLowerCase())?.id ?? null;
}
export function conversionFor(status: PursuitStatus, transitions: Transition[]) {
  const outgoing = transitions.filter(t => t.from === status && t.to !== status);
  const observed = new Set(outgoing.map(t => t.pursuitId));
  const forward = new Set(outgoing.filter(t => t.to !== 'passed' &&
    STATUSES.findIndex(s => s.id === t.to) > STATUSES.findIndex(s => s.id === status)).map(t => t.pursuitId));
  // GUESS: neutral prior shrinks sparse histories. This is a relative progress factor,
  // not a probability of legal commitment. The denominator excludes unobserved exits.
  return { observed: observed.size, forward: forward.size,
    factor: (forward.size + rules.conversionPriorWeight) / (observed.size + rules.conversionPriorWeight) };
}
/** Only a clean, closed dollar range supplies a midpoint. Prose, open bands and
 * amounts belonging to someone else remain unknown instead of being parsed as money. */
export function capacityEstimate(band: string | undefined): number | null {
  if (!band) return null;
  const m = /^\$([\d.]+)(K|M)?[–-]\$?([\d.]+)(K|M)$/i.exec(band.trim());
  if (!m) return null;
  const unit = (u: string) => u.toUpperCase() === 'M' ? 1e6 : 1e3;
  const lo = Number(m[1]) * unit(m[2] ?? m[4]!); const hi = Number(m[3]) * unit(m[4]!);
  return lo >= 0 && hi >= lo ? (lo + hi) / 2 : null;
}
export function actionScore(input: { capacity: number | null; likelihood: number | null; route: number | null; days: number | null; conversion: number; held: boolean }) {
  if (input.held || input.capacity === null || input.likelihood === null || input.route === null || input.days === null) return null;
  if (![input.capacity, input.likelihood, input.route, input.days, input.conversion].every(Number.isFinite) || input.days <= 0) return null;
  const expected = input.capacity * input.likelihood * input.route;
  return { expected, priority: expected * input.conversion / input.days };
}
interface SuggestionRow { pursuit_id: string; suggestion_id: string; data: Partial<Strategy>; body: string; made_at: Date; made_by: string; status: string }
interface ProfileRow { entity_id: string; note_id: string; at: Date; data: { researched?: { at?: string; by?: string; corrected?: Array<{ at: string }> }; profile?: { capacity?: { band: string; basis: string } } } }

/** One projection over the same pursuits, exposures and suggestions used by LP pages.
 * No fit rows are required, and no global edge total is used as vehicle coverage. */
export async function vehicleStrategy(vehicleId: string, now = new Date()) {
  const db = await getDb();
  const [pursuits, totals, exposures] = await Promise.all([pursuitsOn(vehicleId), vehicleTotals(), listExposures(vehicleId)]);
  const total = totals.find(t => t.vehicleId === vehicleId);
  if (!total) return null;
  const ids = [...new Set(pursuits.map(p => p.entityId))];
  const [suggestions, profiles, claims, restrictions, owners, history, touches, routes, contexts, dakota] = await Promise.all([
    db.query<SuggestionRow>(`select distinct on (s.pursuit_id) s.pursuit_id, s.suggestion_id, s.data, s.body, s.made_at, s.made_by, s.status
      from strategy.suggestion s join strategy.active_pursuit p using(pursuit_id) join platform.vehicle v on v.id=p.vehicle_id
      where p.vehicle_id=$1 and s.status in ('proposed','accepted')
        and (nullif(trim(s.data#>>'{ask,vehicle}'),'') is null or lower(trim(s.data#>>'{ask,vehicle}')) in (lower(v.name),lower(v.slug)))
      order by s.pursuit_id, s.created_at desc, s.suggestion_id`, [vehicleId]),
    // Each LP's aliases first (identity.alias_pairs), so these are index probes rather than a
    // canonical_entity_id() call on every row of the table (performance pass, 8 Oct 2026).
    db.query<ProfileRow>(`select distinct on (a.canonical_id) a.canonical_id entity_id, n.note_id, n.created_at as at, n.data
      from identity.alias_pairs($1::uuid[]) a join research.note n on n.entity_id=a.entity_id where n.kind='public_profile'
      order by a.canonical_id,n.created_at desc,n.note_id`, [ids]),
    db.query<{ entity_id: string; n: string }>(`select a.canonical_id entity_id,count(*)::text n
      from identity.alias_pairs($1::uuid[]) a join research.claim c on c.entity_id=a.entity_id where c.superseded_by is null group by 1`, [ids]),
    db.query<{ entity_id: string; instruction: string; scope: string; at: Date }>(`select a.canonical_id entity_id,
      r.instruction,r.scope::text,r.recorded_at as at from identity.alias_pairs($1::uuid[]) a join coordination.restriction r on r.entity_id=a.entity_id
      where r.expires_at is null or r.expires_at > $2::date`, [ids, now]),
    db.query<{ pursuit_id: string; active: boolean }>(`select p.pursuit_id,u.active from strategy.active_pursuit p join platform.app_user u on u.id=p.owner_id where p.vehicle_id=$1`, [vehicleId]),
    db.query<{ subject_id: string; at: Date; detail: Record<string, unknown> }>(`select p.pursuit_id::text as subject_id,a.at,a.detail from platform.audit_log a
      join strategy.active_pursuit p on p.pursuit_id = case when a.subject_type='pursuit'
        and a.subject_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then strategy.canonical_pursuit_id(a.subject_id::uuid) end
      where p.vehicle_id=$1 and a.action='pursuit.status_set' and a.at <= $2 order by a.at,a.id`, [vehicleId, now]),
    touchesOn(vehicleId).then((t) => touchpointSummaries(pursuits, now, t)), strategyRouteSummaries(ids, total.kind),
    db.query<{ entity_id: string; at: Date }>(`select a.canonical_id entity_id,max(n.created_at) at
      from identity.alias_pairs($1::uuid[]) a join research.note n on n.entity_id=a.entity_id where n.kind='context'
        and coalesce(n.data->>'vehicleId', '') in ('', $2::text) and not ${CONTEXT_BY_RULE} group by 1`, [ids, vehicleId]),
    dakotaCapacities(db, ids),
  ]);
  const transitions = history.flatMap(r => {
    const from = statusId(r.detail.fromId ?? r.detail.from), to = statusId(r.detail.toId ?? r.detail.to);
    return from && to && from !== to ? [{ pursuitId: r.subject_id, from, to, at: new Date(r.at) }] : [];
  });
  const bySuggestion = new Map(suggestions.map(s => [s.pursuit_id, s]));
  const byProfile = new Map(profiles.map(s => [s.entity_id, s]));
  const byClaims = new Map(claims.map(s => [s.entity_id, Number(s.n)]));
  const byContext = new Map(contexts.map(s => [s.entity_id, new Date(s.at).toISOString()]));
  const byOwner = new Map(owners.map(s => [s.pursuit_id, s.active]));
  // Grouped once, not filtered per pursuit (quadratic in the vehicle's size).
  const limitsOf = new Map<string, typeof restrictions>(), exposuresOf = new Map<string, typeof exposures>();
  for (const r of restrictions) limitsOf.set(r.entity_id, [...(limitsOf.get(r.entity_id) ?? []), r]);
  for (const x of exposures) exposuresOf.set(x.entityId, [...(exposuresOf.get(x.entityId) ?? []), x]);
  const since = new Date(now); since.setUTCHours(0, 0, 0, 0); since.setUTCDate(since.getUTCDate() - (since.getUTCDay() + 6) % 7);
  const rows = pursuits.map(p => {
    const suggestion = bySuggestion.get(p.pursuitId) ?? null;
    const strategy = suggestion?.data ?? null;
    const profile = byProfile.get(p.entityId) ?? null;
    const route: RecordedRoute | null = routes.get(p.entityId) ?? null;
    const touch = touches.get(`${p.entityId}:${vehicleId}`);
    const limits = limitsOf.get(p.entityId) ?? [];
    const soft = (exposuresOf.get(p.entityId) ?? []).filter(x => x.track === 'soft');
    const hard = (exposuresOf.get(p.entityId) ?? []).filter(x => x.track === 'hard');
    const profileAt = profile?.data.researched?.at ? new Date(profile.data.researched.at) : profile?.at ? new Date(profile.at) : null;
    const strategyAt = suggestion ? new Date(suggestion.made_at) : null;
    const stale = Boolean(strategyAt && ((now.getTime() - strategyAt.getTime()) / DAY > rules.staleDays
      || (strategy?.made && isStale({ made: strategy.made }, profile?.data.researched?.at
        ? { researched: { ...profile.data.researched, at: profile.data.researched.at } } : null,
        undefined, undefined, byContext.get(p.entityId), total.kind)) || (profileAt && profileAt > strategyAt)));
    const routeStale = Boolean(route && (!route.current || (now.getTime() - route.at.getTime()) / DAY > rules.staleDays));
    const capacityBand = strategy?.scores?.capacity?.band ?? profile?.data.profile?.capacity?.band;
    const capacity = soft.length ? soft.reduce((n, x) => n + x.amount, 0) : capacityEstimate(capacityBand) ?? dakota.get(p.entityId)?.amount ?? null;
    const usingDakota = !soft.length && capacityEstimate(capacityBand) === null && dakota.has(p.entityId);
    const capacityBasis = soft.length ? 'Recorded soft amount in this vehicle; not hard committed.' : usingDakota ? dakota.get(p.entityId)!.basis : strategy?.scores?.capacity?.basis ?? profile?.data.profile?.capacity?.basis ?? 'No supported capacity basis.';
    const propensity = strategy?.scores?.propensity;
    const likelihood = propensity && propensity.level !== 'unknown' ? rules.likelihood[propensity.level] : null;
    const decision = strategy?.scores?.timeToDecision;
    const days = decision && decision.band !== 'unknown' ? rules.decisionDays[decision.band] : null;
    const routeWeight = route?.count && route.tier && !routeStale ? rules.routeWeight[route.tier] : null;
    const conversion = conversionFor(p.status, transitions);
    const closed = p.closedAt !== null || p.status === 'passed';
    const held = closed || limits.length > 0 || stale || total.kind === 'grant_rail' || strategy?.list === 'not now' || strategy?.list === '2027' || hard.length > 0;
    const score = actionScore({ capacity, likelihood, route: routeWeight, days, conversion: conversion.factor, held });
    const lastActivity = touch?.lastTouch ?? p.statusSetAt ?? p.openedAt;
    const idleDays = Math.max(0, Math.floor((now.getTime() - lastActivity.getTime()) / DAY));
    const overdue = Boolean(p.nextStepOn && p.nextStepOn.toISOString().slice(0, 10) < now.toISOString().slice(0, 10));
    const risks: string[] = [];
    if (!closed) {
      if (limits.length) risks.push('Restricted approach — review the target’s instructions');
      if (overdue) risks.push('Next action overdue');
      if (idleDays >= rules.stalledDays) risks.push(`${idleDays} days without recorded activity (warning threshold is a guess)`);
      if (!byOwner.get(p.pursuitId)) risks.push('Owner unavailable');
      if (stale) risks.push('Strategy needs refreshing');
      if (routeStale) risks.push('Route evidence needs refreshing');
      if (strategy?.risks) risks.push(...strategy.risks);
    }
    const action = closed ? 'Review the recorded outcome' : limits.length ? 'Review restriction; do not approach'
      : stale ? 'Refresh the strategy against newer evidence'
      : p.nextStep || strategy?.next?.what || p.plan[0]?.move || (hard.length ? 'Review close and cash receipt' : !profile && !(byClaims.get(p.entityId) ?? 0) ? 'Research capacity and fit'
        : !route?.count ? 'Find and assess a route' : 'Write a vehicle-specific strategy');
    const group = closed ? 'Closed or passed' : limits.length ? 'Review restrictions' : stale ? 'Refresh strategy'
      : p.nextStep ? 'Recorded next actions' : strategy?.next?.what ? 'Proposed next actions' : p.plan.length ? 'Recorded next actions' : 'Fill evidence gaps';
    const workFactors = closed ? [] : [
      { label: 'Target restriction needs review', points: limits.length ? rules.evidenceWork.restriction : 0 },
      { label: 'Recorded action overdue', points: overdue ? rules.evidenceWork.overdue : 0 },
      { label: 'Soft indication to substantiate', points: soft.length ? rules.evidenceWork.soft : 0 },
      { label: 'Strategy needs refreshing', points: stale ? rules.evidenceWork.staleStrategy : 0 },
      { label: 'Route search needs refreshing', points: routeStale ? rules.evidenceWork.staleRoute : 0 },
      { label: 'Owner unavailable', points: !byOwner.get(p.pursuitId) ? rules.evidenceWork.noOwner : 0 },
      { label: 'Research missing', points: !profile && !byClaims.get(p.entityId) ? rules.evidenceWork.missingResearch : 0 },
      { label: 'Strategy missing', points: !suggestion && !p.headline && !p.plan.length ? rules.evidenceWork.missingStrategy : 0 },
    ].filter(f => f.points > 0);
    const workPriority = workFactors.reduce((n, f) => n + f.points, 0);
    return { workFactors, workPriority, pursuit: p, suggestion, profileAt, claimCount: byClaims.get(p.entityId) ?? 0, route, limits, touch,
      capacity, capacityBand, capacityBasis, usingDakota, likelihood, propensity, days, decision, routeWeight, conversion, score,
      action, group, risks, idleDays, stale, closed, held, ownerActive: byOwner.get(p.pursuitId) ?? false };
  });
  rows.sort((a, b) => (b.score?.priority ?? -1) - (a.score?.priority ?? -1) || Number(a.closed) - Number(b.closed) || b.workPriority - a.workPriority || a.pursuit.entityName.localeCompare(b.pursuit.entityName));
  return { total, rows, now, since, transitions, exposures,
    weekly: transitions.filter(t => t.at >= since),
    added: pursuits.filter(p => p.openedAt >= since && p.openedAt <= now).length,
    hardened: exposures.filter(x => x.track === 'hard' && x.hardenedAt && x.hardenedAt >= since && x.hardenedAt <= now).reduce((n, x) => n + x.amount, 0),
    counts: STATUSES.map(s => ({ ...s, count: pursuits.filter(p => p.status === s.id).length, conversion: conversionFor(s.id, transitions) })),
  };
}
export type VehicleStrategy = NonNullable<Awaited<ReturnType<typeof vehicleStrategy>>>;
export type StrategyAction = VehicleStrategy['rows'][number];

/** A vehicle's plan, built once per revision for the list and the strategy page (performance pass,
 * 8 Oct 2026); `now` is the build's. Immutable to callers. */
export const strategyOf = buildCache((vehicleId: string) => vehicleStrategy(vehicleId));
