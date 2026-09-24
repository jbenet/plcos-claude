import { config } from '@/config/deployment';
import { circuitBreaker } from '@/modules/agents';
import { connectorLoad, listAsks, listConflicts, listRestrictions } from '@/modules/coordination';
import { listAssets } from '@/modules/content';
import { FIRM_CLASS_LABEL, listFirmProfiles } from '@/modules/fit';
import { listOpenTickets } from '@/modules/governance';
import { listEntities } from '@/modules/identity';
import { coverageGaps } from '@/modules/library';
import { listMeetings, listObjections } from '@/modules/meetings';
import { listEdges } from '@/modules/network';
import { poolChecks } from '@/modules/pipeline';
import { listVehicles } from '@/modules/platform';
import { DEFAULT_PARAMS, listMethods, scoreMethods } from '@/modules/research';
import { BAND_LABEL, ranked } from '@/modules/scoring';
import { listPursuits, RUNG_LABEL, RUNG_REQUIRES, RUNGS, type LadderRung, type PursuitStatus } from '@/modules/strategy';
import type {
  BoardRow, BoardState, CellState, Explored, Holding, Move, Resource, Station, Territory,
} from './board-client';
import { LEVERS } from './board-client';
import type { FloorState } from './floor-client';

export * from './board-client';

const DAY = 86_400_000;
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY);

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

/**
 * The board: the ground, the machine, the moves and what they cost.
 *
 * It takes the floor as an input rather than rebuilding it — one projection of state, two
 * readings of it. What it adds is everything that is *not* in flight: names nobody has
 * looked at, moves nobody has made, and the four or five resources that quietly run out.
 */
export async function boardState(scopeSlug: string | null, floor: FloorState): Promise<BoardState> {
  const now = new Date();
  const [
    entities, profiles, vehicles, pursuits, asks, conflicts, restrictions,
    edges, tickets, meetings, objections, assets, loads, pools, methods, breaker, gaps,
  ] = await Promise.all([
    listEntities(), listFirmProfiles(), listVehicles(), listPursuits(null), listAsks(null),
    listConflicts('open'), listRestrictions(), listEdges(), listOpenTickets(), listMeetings(),
    listObjections(), listAssets(), connectorLoad(), poolChecks(), listMethods(),
    circuitBreaker(), coverageGaps(),
  ]);

  const inScope = (slug: string | null) => scopeSlug === null || slug === scopeSlug;
  const scopedVehicles = vehicles.filter((v) => inScope(v.slug));

  /** The rubric, per vehicle in scope, merged by taking each entity's best reading. */
  const rankings = await Promise.all(scopedVehicles.map((v) => ranked(v.id)));
  const scoreByEntity = new Map<string, (typeof rankings)[number][number]>();
  for (const list of rankings) {
    for (const s of list) {
      const prev = scoreByEntity.get(s.entityId);
      if (!prev || (s.score ?? -1) > (prev.score ?? -1)) scoreByEntity.set(s.entityId, s);
    }
  }

  const profileByEntity = new Map(profiles.map((p) => [p.entityId, p]));
  const restrictedIds = new Set(restrictions.map((r) => r.entityId));
  const contestedIds = new Set(conflicts.map((c) => c.entityId));
  const edgeCount = new Map<string, number>();
  for (const e of edges) {
    edgeCount.set(e.fromEntity, (edgeCount.get(e.fromEntity) ?? 0) + 1);
    edgeCount.set(e.toEntity, (edgeCount.get(e.toEntity) ?? 0) + 1);
  }

  const floorByEntity = new Map(floor.items.map((i) => [i.entityId, i]));
  const teamNames = new Set(['Juan', 'Mara Vance', 'Sam Ferreira', 'Inés Duarte', 'Tomás Reyes']);
  /**
   * What is still being worked. A passed LP is off, for now — they declined or we stopped
   * (docs/17) — so it sits at no station, and no move is "available" on it: an ask toward an
   * LP who said no is the substitution rule 8 forbids, not an opportunity.
   */
  const live = floor.items.filter((i) => i.status !== 'passed');

  /**
   * One territory per name we could conceivably approach. Names with nothing on them are
   * the point of the view, not noise to be filtered out — an empty quadrant is the most
   * useful thing a map of this can show.
   */
  const territories: Territory[] = entities
    .filter((e) => !teamNames.has(e.displayName))
    .map((e) => {
      const scored = scoreByEntity.get(e.entityId);
      const profile = profileByEntity.get(e.entityId);
      const item = floorByEntity.get(e.entityId);
      const factor = (d: string) => {
        const f = scored?.factors.find((x) => x.dimension === d);
        return f ? Number(f.value) : null;
      };
      const explored: Explored = scored ? 'scored' : profile ? 'researched' : 'named';
      const holding: Holding = restrictedIds.has(e.entityId) ? 'restricted'
        : contestedIds.has(e.entityId) ? 'contested'
        : item?.cashReceived ? 'wired'
        : item ? 'ours' : 'open';
      return {
        entityId: e.entityId,
        name: e.displayName,
        segment: profile ? FIRM_CLASS_LABEL[profile.firmClass] : e.entityType === 'person' ? 'Individual' : 'Unclassified',
        capacity: factor('capacity'),
        affinity: factor('affinity'),
        propensity: factor('propensity'),
        timeToDecision: factor('time_to_decision'),
        band: scored ? BAND_LABEL[scored.band] : 'Not scored',
        scoreBasis: scored
          ? scored.missing.length
            ? `Missing ${scored.missing.join(', ')} — a partial rubric is not a score.`
            : `Scored on all four, leading on ${scored.leading ?? '—'}.`
          : 'Nobody has scored this name against the rubric.',
        cheque: item?.amount ?? profile?.checkBandMax ?? null,
        chequeBasis: item?.amount != null ? item.sizeBasis
          : profile?.checkBandMax != null ? 'Their published cheque band, not a number from them.'
          : 'No figure of any kind on file.',
        holding,
        explored,
        ownerName: item?.ownerName ?? null,
        rung: item?.rung ?? null,
        edges: edgeCount.get(e.entityId) ?? 0,
        vehicleName: item?.vehicleName ?? null,
      };
    });

  /**
   * The machine, with a gauge at every station — and the stations are the ladder's rungs, not
   * the statuses. In, out and dwell are counted from dated evidence records, which the ladder
   * has and a status does not: a status moves in any direction and says nothing happened.
   *
   * Dwell is measured between two evidence records on the same pursuit, which is the only
   * honest reading available: it says how long this system took to learn the next thing,
   * not how long the LP took to decide.
   */
  const scopedPursuits = pursuits.filter((p) => {
    const v = vehicles.find((x) => x.id === p.vehicleId);
    return inScope(v?.slug ?? null);
  });
  const dwellsByRung = new Map<string, number[]>();
  const outByRung = new Map<string, number>();
  const inByRung = new Map<string, number>();
  for (const p of scopedPursuits) {
    const walk = [...p.events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    walk.forEach((ev, i) => {
      if (daysBetween(ev.occurredAt, now) <= 30) {
        inByRung.set(ev.rung, (inByRung.get(ev.rung) ?? 0) + 1);
      }
      const next = walk[i + 1];
      if (!next) return;
      dwellsByRung.set(ev.rung, [...(dwellsByRung.get(ev.rung) ?? []), daysBetween(ev.occurredAt, next.occurredAt)]);
      if (daysBetween(next.occurredAt, now) <= 30) {
        outByRung.set(ev.rung, (outByRung.get(ev.rung) ?? 0) + 1);
      }
    });
  }

  const GATES: Partial<Record<LadderRung, { kind: string; note: string }>> = {
    connector_willing: { kind: 'INTRO_ASK', note: 'No ask leaves this station without an approved, unexpired ticket.' },
    target_opted_in: { kind: 'SEND', note: 'Materials are gated by the wrap matrix at send time.' },
    indication_given: { kind: 'STAGE', note: 'Moving a rung is itself an approval, so a hopeful reading cannot promote itself.' },
    commitment_accepted: { kind: 'MONEY', note: 'Hardening and cash are separate states and separate tickets.' },
  };

  const stations: Station[] = [
    {
      // Not "Sourced": Sourcing is a status now, and these names have no pursuit at all.
      key: 'sourced', label: 'Names nobody is working',
      requires: 'A name in the system with no pursuit on any vehicle. Nothing more is claimed.',
      wip: territories.filter((t) => t.holding === 'open').length,
      in30: 0, out30: 0, dwell: null,
      blocked: territories.filter((t) => t.holding === 'restricted').length,
      gate: null, gateOpen: 0,
      gateNote: 'No gate. Sourcing a name costs nothing and promises nothing.',
    },
    ...RUNGS.map((r): Station => {
      const gate = GATES[r];
      return {
        key: r,
        // The rung's own label: the second one reads "LP opted in", never "Target opted in".
        label: RUNG_LABEL[r],
        requires: RUNG_REQUIRES[r],
        wip: live.filter((i) => i.rung === r).length,
        in30: inByRung.get(r) ?? 0,
        out30: outByRung.get(r) ?? 0,
        dwell: median(dwellsByRung.get(r) ?? []),
        blocked: live.filter((i) => i.rung === r && (i.blocked || i.restricted || i.conflict)).length,
        gate: gate?.kind ?? null,
        gateOpen: gate ? tickets.filter((t) => t.kind === gate.kind).length : 0,
        gateNote: gate?.note ?? 'No approval gates this step.',
      };
    }),
  ];

  // The moves, and what each one needs before it can be made.
  const scored = scoreMethods(methods, DEFAULT_PARAMS);
  const quarterCap = config.guard.asksPerConnectorPerQuarter;
  const spentConnectors = loads.filter((l) => l.used >= quarterCap).length;
  /**
   * What a move is available on is still read from the ladder: each one needs the record below
   * it, and a status is not a record. The status is said beside the count, so "6 available"
   * also says where those six stand — often a status ahead of its evidence, which is what
   * recording that evidence would fix.
   */
  const openable = live.filter((i) => i.rung === 'connector_willing' && !i.blocked && !i.restricted);
  const sendable = live.filter((i) => ['target_opted_in', 'meeting_held', 'indication_given'].includes(i.rung ?? ''));
  const meetable = live.filter((i) => i.rung === 'target_opted_in');
  const indicatable = live.filter((i) => i.rung === 'meeting_held');
  const hardenable = live.filter((i) => i.rung === 'indication_given');
  const cashable = live.filter((i) => i.rung === 'commitment_accepted');
  const byStatus = (items: typeof live) => {
    const out: Partial<Record<PursuitStatus, number>> = {};
    for (const i of items) out[i.status] = (out[i.status] ?? 0) + 1;
    return out;
  };

  const moves: Move[] = [
    {
      key: 'research', family: 'Discover', label: 'Enrich a name we have not scored',
      requires: 'Nothing. This is the only move with no prerequisite.',
      available: territories.filter((t) => t.explored !== 'scored').length,
      blocked: 0, blockedWhy: null, gate: null,
      cost: `${scored.filter((m) => m.automatable && m.status === 'available').length} agent-runnable methods on file`,
      payoff: 'Turns a name into something the rubric can rank.',
      runner: 'agent',
    },
    {
      key: 'route', family: 'Discover', label: 'Find a warm route',
      requires: 'A recorded relationship edge. Co-attendance is a clue, not a route.',
      available: territories.filter((t) => t.holding === 'open' && t.edges > 0).length,
      blocked: territories.filter((t) => t.holding === 'open' && t.edges === 0).length,
      blockedWhy: 'No edge on file touches them, which is a statement about our records.',
      gate: null,
      cost: 'Minutes. The enumeration is a recursive CTE.',
      payoff: 'A tier-A route is worth more than any amount of persistence.',
      runner: 'either',
    },
    {
      key: 'ask', family: 'Open', label: 'Ask a connector for an introduction',
      requires: 'A willing connector, an approved INTRO_ASK ticket, and goodwill left this quarter.',
      available: openable.length,
      byStatus: byStatus(openable),
      blocked: live.filter((i) => i.rung === 'connector_willing' && (i.blocked || i.restricted)).length,
      blockedWhy: [
        'Willing connectors whose ask is stopped by a restriction, a collision or a guard.',
        spentConnectors > 0
          ? `${spentConnectors} connector${spentConnectors === 1 ? ' has' : 's have'} also used this quarter's allowance.`
          : null,
      ].filter(Boolean).join(' '),
      gate: 'INTRO_ASK',
      cost: 'One of this connector’s asks this quarter. It does not come back.',
      payoff: 'The only step that turns a willing connector into a target who has heard of us.',
      runner: 'human',
    },
    {
      key: 'send', family: 'Open', label: 'Send them something',
      requires: 'An approved SEND ticket and an asset the wrap matrix permits for this vehicle.',
      available: sendable.length,
      byStatus: byStatus(sendable),
      blocked: assets.filter((a) => a.flags.length > 0).length,
      blockedWhy: 'Assets carrying an open refresh flag — a claim underneath them moved.',
      gate: 'SEND',
      cost: 'A version of a canonical asset, and the staleness clock starts.',
      payoff: 'Answers the questions a meeting would otherwise spend its first twenty minutes on.',
      runner: 'human',
    },
    {
      key: 'meet', family: 'Advance', label: 'Hold a meeting',
      requires: 'The LP opted in themselves. A connector relaying optimism is not an opt-in.',
      available: meetable.length,
      byStatus: byStatus(meetable),
      blocked: 0, blockedWhy: null, gate: null,
      cost: `${meetings.filter((m) => m.scheduledFor && m.scheduledFor > now).length} already on the calendar`,
      payoff: 'The rung most likely to be claimed without evidence, and the easiest to evidence.',
      runner: 'human',
    },
    {
      key: 'answer', family: 'Advance', label: 'Answer an open objection',
      requires: 'An objection recorded against a class, and something in the library that answers it.',
      available: objections.filter((o) => o.status === 'open').length,
      blocked: gaps.length,
      blockedWhy: 'Questions the library has no answer for yet.',
      gate: null,
      cost: 'Someone writes the answer once and it is reusable.',
      payoff: 'Objections are the only honest forward-looking signal a meeting produces.',
      runner: 'either',
    },
    {
      key: 'indicate', family: 'Advance', label: 'Record an indication',
      requires: 'A number or a range from them. Enthusiasm is not an indication.',
      available: indicatable.length,
      byStatus: byStatus(indicatable),
      blocked: 0, blockedWhy: null, gate: 'STAGE',
      cost: 'Nothing, and that is the danger — it is free to claim and expensive to be wrong about.',
      payoff: 'The first rung where a figure exists at all.',
      runner: 'human',
    },
    {
      key: 'harden', family: 'Close', label: 'Move soft to hard',
      requires: 'Signed and countersigned. This is the only step that moves a number between tracks.',
      available: hardenable.length,
      byStatus: byStatus(hardenable),
      blocked: 0, blockedWhy: null, gate: 'MONEY',
      cost: 'Counsel time, and a conserved-pool check against everything else they have with us.',
      payoff: 'The only number that appears in a headline.',
      runner: 'human',
    },
    {
      key: 'cash', family: 'Close', label: 'Record the wire',
      requires: 'The money landed. A separate state from the commitment, always.',
      available: cashable.length,
      byStatus: byStatus(cashable),
      blocked: 0, blockedWhy: null, gate: 'MONEY',
      cost: 'None.',
      payoff: 'The only state that cannot be argued with.',
      runner: 'human',
    },
  ];

  /**
   * The action economy, as a grid. A lever is spent, blocked, available, or not yet reachable
   * — and "not yet" is different from "blocked" in a way that matters when you are choosing
   * what to do this week. "Not yet" is read from the ladder: a lever waits on a record, never
   * on a status. Wired and passed LPs are left off, because nothing is left to pull on either.
   */
  const rungAt = (r: LadderRung | null) => (r === null ? -1 : RUNGS.indexOf(r));
  const rows: BoardRow[] = live
    .filter((i) => !i.cashReceived)
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))
    .slice(0, 22)
    .map((i) => {
      const at = rungAt(i.rung);
      const theirAsks = asks.filter((a) => a.entityId === i.entityId);
      const theirMeetings = meetings.filter((m) => m.entityId === i.entityId);
      const theirObjections = objections.filter((o) => o.entityId === i.entityId);
      const blockedNote = i.restricted ? 'A do-not-approach instruction is on file.'
        : i.conflict ? 'Two vehicles have an open ask on them.'
        : i.blocked ?? '';
      const cell = (state: CellState, note: string) => ({ state, note });
      const gate = (ok: boolean, state: CellState, note: string, lockedNote: string) =>
        (ok ? cell(state, note) : cell('locked', lockedNote));
      return {
        key: i.key,
        entityId: i.entityId,
        pursuitId: i.pursuitId,
        name: i.entityName,
        vehicleName: i.vehicleName,
        ownerName: i.ownerName,
        status: i.status,
        needsEvidence: i.needsEvidence,
        rung: i.rung,
        ladderRung: i.ladderRung,
        stake: i.amount,
        cells: {
          route: (edgeCount.get(i.entityId) ?? 0) > 0
            ? cell('open', `${edgeCount.get(i.entityId)} recorded edge${edgeCount.get(i.entityId) === 1 ? '' : 's'} touch them.`)
            : cell('blocked', 'No edge on file touches them.'),
          ask: blockedNote ? cell('blocked', blockedNote)
            : theirAsks.some((a) => a.madeAt) ? cell('spent', 'An ask has already been made this quarter.')
            : at >= 0 ? cell('open', 'A connector is willing and the allowance is unspent.')
            : cell('locked', 'Nobody willing to ask has been recorded.'),
          meet: theirMeetings.some((m) => m.heldOn) ? cell('done', 'A meeting has happened.')
            : theirMeetings.some((m) => m.scheduledFor) ? cell('spent', 'One is on the calendar.')
            : gate(at >= 1, 'open', 'They opted in, so a meeting can be asked for.',
                   'They have not opted in themselves yet.'),
          material: assets.length > 0
            ? gate(at >= 1, 'open', 'An approved asset exists for this wrap.',
                   'Nothing to send until they have opted in.')
            : cell('blocked', 'No approved asset for this vehicle.'),
          answer: theirObjections.length === 0
            ? cell('locked', 'No objection recorded, so there is nothing to answer.')
            : theirObjections.every((o) => o.status !== 'open')
              ? cell('done', 'Every recorded objection has an answer.')
              : cell('open', `${theirObjections.filter((o) => o.status === 'open').length} open.`),
          structure: i.track === 'soft' || at >= 3
            ? cell('open', 'An instrument choice is live for them.')
            : cell('locked', 'Structure is a conversation you have after a meeting.'),
          number: at >= 3 ? cell('done', 'A figure from them is on file.')
            : gate(at >= 2, 'open', 'A meeting has happened; a number can be asked for.',
                   'No meeting, so no number to ask for.'),
          close: at >= 4 ? cell('open', 'Countersignature is the next thing.')
            : cell('locked', 'Nothing to close until there is a number.'),
        },
      };
    });

  // What runs out. Every cap says where it came from, and a guess says it is a guess.
  // Person-time is what is in flight: not wired, not passed — the same count as the load.
  const owners = [...new Set(live.filter((i) => !i.cashReceived).map((i) => i.ownerName))];
  const heaviest = owners
    .map((o) => ({ o, n: live.filter((i) => i.ownerName === o && !i.cashReceived).length }))
    .sort((a, b) => b.n - a.n);
  const overPools = pools.filter((p) => p.status === 'over');
  const unverifiedPools = pools.filter((p) => p.status === 'unverified');
  const staleAssets = assets.filter((a) => a.flags.length > 0);

  const resources: Resource[] = [
    {
      key: 'people', label: 'Person-time', used: heaviest[0]?.n ?? 0, cap: 6, unit: 'items in flight',
      basis: 'Six is a working guess, not a measured limit. Replace it with real cycle times.',
      tone: (heaviest[0]?.n ?? 0) > 6 ? 'over' : (heaviest[0]?.n ?? 0) > 4 ? 'tight' : 'ok',
      detail: heaviest.map((h) => `${h.o} ${h.n}`).join(' · '),
    },
    {
      key: 'goodwill', label: 'Connector goodwill',
      used: loads.reduce((n, l) => n + l.used, 0), cap: loads.length * quarterCap, unit: 'asks this quarter',
      basis: `${quarterCap} per connector per quarter — marked GUESS in config/deployment.ts.`,
      tone: spentConnectors > 0 ? 'tight' : 'ok',
      detail: loads.length === 0 ? 'No asks carried through any connector yet.'
        : loads.map((l) => `${l.name} ${l.used}/${quarterCap}`).join(' · '),
    },
    {
      key: 'approvals', label: 'Open approvals', used: tickets.length, cap: null, unit: 'tickets waiting',
      basis: 'No cap. Every one of them is a mutation that fails closed until somebody decides.',
      tone: tickets.length > 5 ? 'tight' : 'ok',
      detail: tickets.map((t) => t.kind).join(' · ') || 'Nothing waiting.',
    },
    {
      key: 'agents', label: 'Agent correction budget',
      used: Math.round(breaker.hoursThisWeek), cap: breaker.budgetHours, unit: 'hours this week',
      basis: 'The circuit breaker. Past it, new agent autonomy freezes.',
      tone: breaker.frozen ? 'over' : breaker.hoursThisWeek > breaker.budgetHours * 0.6 ? 'tight' : 'ok',
      detail: breaker.statement,
    },
    {
      key: 'materials', label: 'Sendable materials',
      used: assets.length - staleAssets.length, cap: assets.length, unit: 'assets clean',
      basis: 'An asset is stale the moment a claim underneath it moves.',
      tone: staleAssets.length > 0 ? 'tight' : 'ok',
      detail: staleAssets.length === 0 ? 'Nothing carrying a refresh flag.'
        : `${staleAssets.length} flagged: ${staleAssets.map((a) => a.title).join(', ')}`,
    },
    {
      key: 'pool', label: 'Conserved capital pool',
      used: overPools.length, cap: pools.length, unit: 'actors over their budget',
      basis: 'Their stated budget against everything they have with us, across every vehicle.',
      tone: overPools.length > 0 ? 'over' : unverifiedPools.length > 0 ? 'unknown' : 'ok',
      detail: overPools.length
        ? `${overPools.map((p) => p.entityName).join(', ')} — the sum across vehicles exceeds what they said they have.`
        : `${unverifiedPools.length} budget${unverifiedPools.length === 1 ? '' : 's'} nobody has verified.`,
    },
  ];

  const fog = {
    scored: territories.filter((t) => t.explored === 'scored').length,
    researched: territories.filter((t) => t.explored === 'researched').length,
    named: territories.filter((t) => t.explored === 'named').length,
    note: 'A name with no rubric score is not a weak target. It is an unopened one, and the '
      + 'map draws the difference rather than ranking them together.',
  };

  return {
    territories,
    stations,
    moves,
    rows,
    resources,
    goodwill: loads.map((l) => ({
      name: l.name, used: l.used, cap: quarterCap,
      basis: 'Asks carried in the last three months, against the quarterly allowance.',
    })),
    fog,
  };
}

export { LEVERS };
