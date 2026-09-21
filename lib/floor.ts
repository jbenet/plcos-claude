import { circuitBreaker, listRuns } from '@/modules/agents';
import { bandwidthAlerts } from '@/modules/close';
import { listAsks, listConflicts, listRestrictions } from '@/modules/coordination';
import { listOpenTickets } from '@/modules/governance';
import { upcomingMeetings } from '@/modules/meetings';
import { listExposures } from '@/modules/pipeline';
import { listVehicles } from '@/modules/platform';
import { DEFAULT_PARAMS, listMethods, scoreMethods } from '@/modules/research';
import { actionableSignals } from '@/modules/signals';
import { listPursuits, rungIndex, RUNGS, type LadderRung } from '@/modules/strategy';
import type { Alarm, Dated, FloorAgents, FloorItem, FloorState, Temp } from './floor-client';

export * from './floor-client';

/**
 * The floor: everything currently trying to happen, in one projection.
 *
 * Nothing here is stored. Every field is read from the module that owns it, which is the
 * only way a wall display can be trusted — **a dashboard with its own copy of the state is
 * a dashboard that disagrees with the pages people act on.** The cost is that anything no
 * module records does not appear, and the coverage note says so.
 *
 * Two rules shape the shape of this file. Soft and hard money never merge into one number,
 * so an item carries its track and the totals are counted separately. And a rung is only
 * ever the highest one with an evidence record — nothing here infers a step from a mood.
 */

const DAY = 86_400_000;
const days = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / DAY);

function temperature(last: Date | null, now: Date): { temp: Temp; basis: string } {
  if (!last) return { temp: 'unmoved', basis: 'No dated record on this pursuit at all.' };
  const d = days(last, now);
  if (d <= 7) return { temp: 'hot', basis: `Last record ${d === 0 ? 'today' : `${d}d ago`}.` };
  if (d <= 21) return { temp: 'warm', basis: `Last record ${d}d ago.` };
  if (d <= 45) return { temp: 'cool', basis: `Nothing for ${d} days.` };
  return { temp: 'cold', basis: `Nothing for ${d} days.` };
}

export async function floorState(
  scopeSlug: string | null,
  opts: { includeGrants?: boolean } = {},
): Promise<FloorState> {
  const now = new Date();
  const [
    vehicles, pursuits, exposures, asks, conflicts, restrictions,
    meetings, tickets, runs, breaker, signals, methods, bandwidth,
  ] = await Promise.all([
    listVehicles(), listPursuits(null), listExposures(null), listAsks(null),
    listConflicts('open'), listRestrictions(), upcomingMeetings(), listOpenTickets(),
    listRuns(40), circuitBreaker(), actionableSignals(12), listMethods(), bandwidthAlerts(),
  ]);

  const vehicleBySlug = new Map(vehicles.map((v) => [v.slug, v]));
  /**
   * The grants rail is part of PL R&D, not of PL Capital (issue 0013). The organisation-wide
   * page asks for it; the "all vehicles" page under PL Capital does not, because a rail that
   * cannot be approached until a funder invites us does not belong in a capital roll-up.
   */
  const grantRails = new Set(vehicles.filter((v) => v.kind === 'grant_rail').map((v) => v.slug));
  const inScope = (slug: string) => (scopeSlug === null
    ? opts.includeGrants === true || !grantRails.has(slug)
    : slug === scopeSlug);

  const restrictedEntities = new Set(restrictions.map((r) => r.entityId));
  const conflictedEntities = new Set(conflicts.map((c) => c.entityId));
  const ticketBySubject = new Map(tickets.map((t) => [`${t.subjectId}`, t]));

  /**
   * One item per entity × vehicle. A pursuit supplies the process, an exposure supplies the
   * money, and either can exist without the other: a hard commitment with no pursuit is
   * still on the floor, and a pursuit with no number is drawn small rather than guessed at.
   */
  const items = new Map<string, FloorItem>();

  for (const p of pursuits) {
    const vehicle = vehicles.find((v) => v.id === p.vehicleId);
    if (!vehicle || !inScope(vehicle.slug)) continue;
    const last = p.events.length
      ? p.events.map((e) => e.occurredAt).sort((a, b) => b.getTime() - a.getTime())[0]!
      : null;
    const { temp, basis } = temperature(last, now);
    const blockedStep = p.plan.find((s) => s.blockedBy);
    items.set(`${p.entityId}:${vehicle.slug}`, {
      key: `${p.entityId}:${vehicle.slug}`,
      entityId: p.entityId,
      entityName: p.entityName,
      vehicleSlug: vehicle.slug,
      vehicleName: vehicle.name,
      ownerName: p.ownerName,
      rung: p.rung,
      rungIndex: rungIndex(p.rung),
      nextRung: p.nextRung,
      track: null,
      amount: null,
      probability: null,
      cashReceived: false,
      sizeBasis: 'No number from them yet, so it is drawn at the minimum size.',
      temp,
      tempBasis: basis,
      lastMoveAt: last,
      daysSinceMove: last ? days(last, now) : null,
      blocked: blockedStep?.blockedBy ?? null,
      urgent: null,
      urgentAt: null,
      conflict: conflictedEntities.has(p.entityId),
      restricted: restrictedEntities.has(p.entityId),
      openTicket: ticketBySubject.get(p.pursuitId)?.kind ?? null,
      headline: p.headline,
      path: p.events.map((e) => e.rung),
      walkedAt: p.events.map((e) => ({ rung: e.rung, at: e.occurredAt })),
      stalled: last !== null && days(last, now) > 21,
    });
  }

  for (const x of exposures) {
    if (!inScope(x.vehicleSlug)) continue;
    const key = `${x.entityId}:${x.vehicleSlug}`;
    const existing = items.get(key);
    /**
     * A countersignature and a wire are evidence records like any other, so they set the
     * rung. This is the one place a rung comes from outside the ladder table, and it comes
     * from a document, never from a mood.
     */
    const rung: LadderRung | null = x.cashReceivedAt
      ? 'cash_received'
      : x.hardenedAt ? 'commitment_accepted'
      : existing?.rung ?? (x.track === 'soft' ? 'indication_given' : null);
    const moneyMove = x.cashReceivedAt ?? x.hardenedAt ?? null;
    const last = [existing?.lastMoveAt ?? null, moneyMove]
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    /**
     * Cash in the bank is not a stalled pursuit. Without this, every wired commitment
     * reads "nothing for 69 days" in clay — the page shouting about the one outcome it
     * exists to produce.
     */
    const plain = temperature(last, now);
    const { temp, basis } = x.cashReceivedAt
      ? { temp: 'done' as const,
          basis: `Cash landed ${days(x.cashReceivedAt, now)}d ago. Finished, not stalled.` }
      : plain;
    const sizeBasis = x.track === 'hard'
      ? `Signed: ${x.evidenceRef ?? 'countersigned'}.`
      : `Their own indication${x.probability === null ? '' : `, recorded at ${Math.round(x.probability * 100)}% by ${x.ownerName}`}.`;
    const base: FloorItem = existing ?? {
      key,
      entityId: x.entityId,
      entityName: x.entityName,
      vehicleSlug: x.vehicleSlug,
      vehicleName: x.vehicleName,
      ownerName: x.ownerName,
      rung: null,
      rungIndex: -1,
      nextRung: null,
      track: null,
      amount: null,
      probability: null,
      cashReceived: false,
      sizeBasis: '',
      temp: 'unmoved',
      tempBasis: '',
      lastMoveAt: null,
      daysSinceMove: null,
      blocked: null,
      urgent: null,
      urgentAt: null,
      conflict: conflictedEntities.has(x.entityId),
      restricted: restrictedEntities.has(x.entityId),
      openTicket: null,
      headline: null,
      path: [],
      walkedAt: [],
      stalled: false,
    };
    items.set(key, {
      ...base,
      rung,
      rungIndex: rungIndex(rung),
      track: x.track,
      amount: x.amount,
      probability: x.probability,
      cashReceived: x.cashReceivedAt !== null,
      sizeBasis,
      temp,
      tempBasis: basis,
      lastMoveAt: last,
      daysSinceMove: last ? days(last, now) : null,
      stalled: last !== null && days(last, now) > 21 && !x.cashReceivedAt,
      path: [
        ...base.path,
        ...(x.hardenedAt ? (['commitment_accepted'] as LadderRung[]) : []),
        ...(x.cashReceivedAt ? (['cash_received'] as LadderRung[]) : []),
      ],
      walkedAt: [
        ...base.walkedAt,
        ...(x.hardenedAt ? [{ rung: 'commitment_accepted' as LadderRung, at: x.hardenedAt }] : []),
        ...(x.cashReceivedAt ? [{ rung: 'cash_received' as LadderRung, at: x.cashReceivedAt }] : []),
      ],
    });
  }

  // Dated things that are about to happen to an item. Urgency is always a date, never a mood.
  for (const m of meetings) {
    if (!m.scheduledFor) continue;
    for (const [key, item] of items) {
      if (item.entityId !== m.entityId) continue;
      const d = days(now, m.scheduledFor);
      if (d < 0 || d > 14) continue;
      items.set(key, {
        ...item,
        urgent: `${m.kind.replace('_', ' ')} in ${d === 0 ? 'hours' : `${d}d`}`,
        urgentAt: m.scheduledFor,
      });
    }
  }
  for (const t of tickets) {
    if (!t.expiresAt) continue;
    const d = days(now, t.expiresAt);
    if (d < 0 || d > 5) continue;
    for (const [key, item] of items) {
      if (!t.subjectLabel.includes(item.entityName)) continue;
      items.set(key, { ...item, urgent: `${t.kind} ticket expires in ${d}d`, urgentAt: t.expiresAt });
    }
  }
  for (const a of asks) {
    if (a.status !== 'blocked') continue;
    for (const [key, item] of items) {
      if (item.entityId !== a.entityId || item.vehicleName !== a.vehicleName) continue;
      items.set(key, { ...item, blocked: item.blocked ?? `Ask blocked: ${a.purpose}` });
    }
  }

  const scored = scoreMethods(methods, DEFAULT_PARAMS);
  const agents: FloorAgents = {
    running: runs.filter((r) => r.finishedAt === null).length,
    awaitingAcceptance: runs.filter((r) => r.status === 'proposed' && r.finishedAt !== null).length,
    refused: runs.filter((r) => r.status === 'refused').length,
    acceptedToday: runs.filter((r) => r.acceptedAt && days(r.acceptedAt, now) === 0).length,
    breaker: { frozen: breaker.frozen, statement: breaker.statement },
    queue: runs.slice(0, 12).map((r) => ({
      label: r.envelope.task,
      state: r.finishedAt === null ? 'running'
        : r.status === 'refused' ? 'refused'
        : r.status === 'accepted' ? 'accepted' : 'awaiting',
      who: r.envelope.escalationOwnerName,
      at: r.startedAt,
    })),
    humanQueued: scored.filter((m) => m.selected && !m.automatable).length,
    agentQueued: scored.filter((m) => m.selected && m.automatable).length,
    humanWip: DEFAULT_PARAMS.humanWip,
    agentWip: DEFAULT_PARAMS.aiWip,
  };

  const alarms: Alarm[] = [];
  for (const c of conflicts) {
    alarms.push({
      key: `conflict:${c.caseId}`, severity: 'stop', label: 'Cross-vehicle collision',
      detail: `${c.claimantA.vehicleName} and ${c.claimantB.vehicleName} both have an open ask on ${c.entityName}.`,
      entityName: c.entityName, vehicleName: null, at: c.openedAt,
    });
  }
  for (const r of restrictions) {
    alarms.push({
      key: `restriction:${r.entityId}:${r.instruction.slice(0, 12)}`, severity: 'stop',
      label: 'Do not approach', detail: r.instruction,
      entityName: r.entityName, vehicleName: null, at: null,
    });
  }
  for (const b of bandwidth) {
    alarms.push({
      key: `bandwidth:${b.kind}:${b.name}`, severity: 'soon',
      label: `${b.kind === 'owner' ? 'Owner' : 'Investor'} stretched`,
      detail: `${b.name} — ${b.detail}`, entityName: null, vehicleName: null, at: null,
    });
  }
  for (const t of tickets) {
    const d = t.expiresAt ? days(now, t.expiresAt) : null;
    if (d !== null && d <= 3) {
      alarms.push({
        key: `ticket:${t.id}`, severity: d < 0 ? 'stop' : 'soon',
        label: d < 0 ? `${t.kind} ticket expired` : `${t.kind} ticket expires in ${d}d`,
        detail: t.scope.authorizes,
        entityName: t.subjectLabel, vehicleName: t.vehicleName, at: t.expiresAt,
      });
    }
  }
  for (const s of signals.slice(0, 6)) {
    alarms.push({
      key: `signal:${s.signalId}`, severity: 'note', label: 'Unread signal',
      detail: s.headline, entityName: s.entityName ?? null, vehicleName: null, at: s.observedAt,
    });
  }
  if (breaker.frozen) {
    alarms.unshift({
      key: 'breaker', severity: 'stop', label: 'Agent autonomy frozen',
      detail: breaker.statement, entityName: null, vehicleName: null, at: null,
    });
  }

  /**
   * The fortnight ahead. Every mark is a date somebody already wrote down — nothing here
   * is a projection of when a thing "should" happen.
   */
  const schedule: Dated[] = [];
  for (const m of meetings) {
    if (!m.scheduledFor || !inScope(vehicles.find((v) => v.name === m.vehicleName)?.slug ?? '')) continue;
    if (days(now, m.scheduledFor) > 21) continue;
    schedule.push({
      key: `meeting:${m.meetingId}`, at: m.scheduledFor, kind: 'meeting',
      label: `${m.kind.replace('_', ' ')} · ${m.entityName}`,
      entityName: m.entityName, vehicleName: m.vehicleName, ownerName: m.ownerName,
    });
  }
  for (const t of tickets) {
    if (!t.expiresAt || days(now, t.expiresAt) > 21) continue;
    if (t.vehicleName && !inScope(vehicles.find((v) => v.name === t.vehicleName)?.slug ?? '')) continue;
    schedule.push({
      key: `expiry:${t.id}`, at: t.expiresAt, kind: 'expiry',
      label: `${t.kind} expires · ${t.subjectLabel}`,
      entityName: t.subjectLabel, vehicleName: t.vehicleName, ownerName: t.requestedByName,
    });
  }
  for (const c of conflicts) {
    if (!c.loserFollowupAt || days(now, c.loserFollowupAt) > 21) continue;
    schedule.push({
      key: `followup:${c.caseId}`, at: c.loserFollowupAt, kind: 'followup',
      label: `Follow up the loser · ${c.entityName}`,
      entityName: c.entityName, vehicleName: null, ownerName: null,
    });
  }
  for (const a of asks) {
    if (!a.scheduledFor || days(now, a.scheduledFor) > 21 || days(now, a.scheduledFor) < 0) continue;
    if (!inScope(vehicles.find((v) => v.name === a.vehicleName)?.slug ?? '')) continue;
    schedule.push({
      key: `ask:${a.askId}`, at: a.scheduledFor, kind: 'close',
      label: `Ask due · ${a.entityName}`,
      entityName: a.entityName, vehicleName: a.vehicleName, ownerName: a.ownerName,
    });
  }
  schedule.sort((a, b) => a.at.getTime() - b.at.getTime());

  const list = [...items.values()].filter((i) => inScope(i.vehicleSlug));
  const money = vehicles
    .filter((v) => inScope(v.slug))
    .map((v) => {
      const mine = list.filter((i) => i.vehicleSlug === v.slug);
      return {
        slug: v.slug, name: v.name,
        hard: mine.filter((i) => i.track === 'hard').reduce((n, i) => n + (i.amount ?? 0), 0),
        soft: mine.filter((i) => i.track === 'soft').reduce((n, i) => n + (i.amount ?? 0), 0),
        items: mine.length,
      };
    })
    .filter((v) => v.items > 0);

  return {
    scopeSlug,
    scopeName: scopeSlug ? vehicleBySlug.get(scopeSlug)?.name ?? scopeSlug : 'All of PL Capital',
    vehicles: vehicles.filter((v) => inScope(v.slug)).map((v) => ({ slug: v.slug, name: v.name, kind: v.kind })),
    items: list.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)),
    agents,
    alarms,
    schedule,
    money,
    asOf: now,
    coverage: {
      corpus: `${pursuits.length} pursuits, ${exposures.length} exposures, ${asks.length} asks, `
        + `${meetings.length} scheduled meetings, ${tickets.length} open tickets, ${runs.length} agent runs`,
      notInspected: [
        'Anything nobody recorded. A conversation that happened and was not written down is not on this floor.',
        'No connector is attached, so nothing here came from a mailbox, a CRM or a calendar feed.',
      ],
    },
  };
}

export const RUNG_ORDER = RUNGS;
