'use client';

import { useMemo, useState } from 'react';
import type { BoardState } from '@/lib/board-client';
import type { FloorState } from '@/lib/floor-client';
import type { Lenses } from '@/lib/lenses-client';
import { Console } from './Console';
import { CoverageView } from './CoverageView';
import { FilterBar } from './FilterBar';
import { EMPTY_FILTER, FloorProvider, matches, type FloorFilter, type Selected } from './FloorContext';
import { LeverageView } from './LeverageView';
import { NetworkView } from './NetworkView';
import { RadarView } from './RadarView';
import { StripView } from './StripView';
import { ClockView } from './ClockView';
import { FlowView } from './FlowView';
import { FloorList } from './FloorList';
import { LineView } from './LineView';
import { LoadView } from './LoadView';
import { EconomyView } from './EconomyView';
import { GridView } from './GridView';
import { MapView } from './MapView';
import { MovesView } from './MovesView';
import { PlantView } from './PlantView';
import { RoomView } from './RoomView';

/**
 * Ten drawings, two projections, one vocabulary.
 *
 * They are experiments, not features, and they are deliberately not variations on a theme:
 * each answers a different question and each is wrong for the other nine. The tab strip
 * says which question it answers, because a picture nobody can state the question for is
 * decoration.
 *
 * The first five read the floor — what is happening. The second five read the board — the
 * ground it is happening on, the machine it moves through, the moves available and what
 * they cost.
 */

const TABS = [
  {
    id: 'line', title: 'The line',
    asks: 'Where is every pursuit, and what is stuck at which station?',
    learn: 'Reads like a factory: stations left to right, work sitting in them. Best for "what is the shape of the raise right now".',
  },
  {
    id: 'load', title: 'The load',
    asks: 'Who is carrying what, and is anyone holding more than they can finish?',
    learn: 'Ignores stage entirely and sorts by person. Best before assigning anything new.',
  },
  {
    id: 'flow', title: 'The flow',
    asks: 'Where does work stop moving?',
    learn: 'The ladder as a funnel with the drop-off drawn. Best for finding the station that is actually the bottleneck.',
  },
  {
    id: 'clock', title: 'The clock',
    asks: 'What is about to happen, and what has no date at all?',
    learn: 'Three weeks forward plus the undated pile. Best on a Monday.',
  },
  {
    id: 'room', title: 'The room',
    asks: 'Is anything on fire?',
    learn: 'Instruments, not art. Best as a wall display and hardest to misread.',
  },
  {
    id: 'map', title: 'The map',
    asks: 'What ground is there, and how much of it have we even looked at?',
    learn: 'The universe placed by capacity and fit, with everything unscored held back in the fog. Best for deciding where to point the next month.',
  },
  {
    id: 'plant', title: 'The plant',
    asks: 'What does the whole machine look like, station by station?',
    learn: 'Gauges at every step and a valve at every approval. Best for finding which station is slow rather than which deal is.',
  },
  {
    id: 'moves', title: 'The moves',
    asks: 'What can we do, and what does each one cost?',
    learn: 'The build menu, locked entries included, with the reason under each. Best when you have an hour and no idea what to spend it on.',
  },
  {
    id: 'grid', title: 'The grid',
    asks: 'What levers are left on each target?',
    learn: 'Targets against levers. Best for spotting a target we have run out of legal moves on.',
  },
  {
    id: 'economy', title: 'The economy',
    asks: 'What is about to run out?',
    learn: 'Person-time, goodwill, approvals, agent budget, materials, their own budget. Best before promising anyone anything.',
  },
  {
    id: 'network', title: 'The network',
    asks: 'Who can carry an ask to whom, and which paths are actually confirmed?',
    learn: 'Us, the people who could carry it, the money — and only recorded lines between them. Best before promising an introduction.',
  },
  {
    id: 'leverage', title: 'The leverage',
    asks: 'What one piece of work would release several next moves?',
    learn: 'A prerequisite on the left, everything waiting behind it on the right. Best when there is an hour and six things want it.',
  },
  {
    id: 'coverage', title: 'The coverage',
    asks: 'What do we actually have on file, and where are we flying blind?',
    learn: 'Six kinds of record per pursuit, least recorded first. Best before writing a brief that sounds confident.',
  },
  {
    id: 'radar', title: 'The radar',
    asks: 'When did anybody last actually speak to them?',
    learn: 'Distance is time since a dated exchange, and the list beside it is everyone nobody has spoken to. Best on a Friday.',
  },
  {
    id: 'strip', title: 'The strip',
    asks: 'What happened in the last fortnight, and what is dated in the next?',
    learn: 'A month of operations per vehicle, with the undated pile counted beside it. Best for the weekly review.',
  },
] as const;

const GROUPS: Array<{ title: string; note: string; ids: TabId[] }> = [
  { title: 'State of play', note: 'what is happening', ids: ['line', 'load', 'flow', 'clock', 'room'] },
  { title: 'The space and the moves', note: 'what could happen, and at what cost', ids: ['map', 'plant', 'moves', 'grid', 'economy'] },
  { title: 'Reach, leverage and blind spots', note: 'who can move whom, what to unblock, what is not recorded', ids: ['network', 'leverage', 'coverage', 'radar', 'strip'] },
];

type TabId = typeof TABS[number]['id'];

export function FloorTabs({ state, board, lenses }: { state: FloorState; board: BoardState; lenses: Lenses }) {
  const [tab, setTab] = useState<TabId>('line');
  const [filter, setFilter] = useState<FloorFilter>(EMPTY_FILTER);
  const [selected, setSelected] = useState<Selected>(null);
  const active = TABS.find((t) => t.id === tab)!;

  /**
   * One filter, applied to the projection before any view sees it. The board's rows and
   * the lenses are narrowed by the same item keys, so a search reshapes every tab at once
   * — and the count in the bar says how many were hidden.
   */
  const view = useMemo(() => {
    const items = state.items.filter((i) => matches(i, filter));
    const keep = new Set(items.map((i) => i.key));
    const entities = new Set(items.map((i) => i.entityId));
    const money = state.money.map((m) => ({
      ...m,
      hard: items.filter((i) => i.vehicleSlug === m.slug && i.track === 'hard').reduce((n, i) => n + (i.amount ?? 0), 0),
      soft: items.filter((i) => i.vehicleSlug === m.slug && i.track === 'soft').reduce((n, i) => n + (i.amount ?? 0), 0),
      items: items.filter((i) => i.vehicleSlug === m.slug).length,
    })).filter((m) => m.items > 0);
    const filteredState: FloorState = { ...state, items, money };
    const filteredBoard: BoardState = {
      ...board,
      rows: board.rows.filter((r) => keep.has(`${r.entityId}:${state.items.find((i) => i.entityId === r.entityId && i.vehicleName === r.vehicleName)?.vehicleSlug ?? ''}`)),
      territories: filter.find.trim() || filter.owner !== 'everyone' || filter.signal !== 'all' || filter.stage !== 'all'
        ? board.territories.filter((t) => entities.has(t.entityId))
        : board.territories,
    };
    const filteredLenses: Lenses = {
      ...lenses,
      network: {
        ...lenses.network,
        nodes: lenses.network.nodes.filter((n) => n.role !== 'target' || keep.has(n.id.slice(2))),
        links: lenses.network.links.filter((l) => !l.to.startsWith('t:') || keep.has(l.to.slice(2))),
      },
      leverage: {
        ...lenses.leverage,
        prerequisites: lenses.leverage.prerequisites
          .map((p) => ({ ...p, dependents: p.dependents.filter((d) => keep.has(d.key)) }))
          .filter((p) => p.dependents.length > 0),
      },
      coverage: { ...lenses.coverage, rows: lenses.coverage.rows.filter((r) => keep.has(r.key)) },
      radar: {
        ...lenses.radar,
        dots: lenses.radar.dots.filter((d) => keep.has(d.key)),
        offRadar: lenses.radar.offRadar.filter((d) => keep.has(d.key)),
      },
    };
    return { state: filteredState, board: filteredBoard, lenses: filteredLenses };
  }, [state, board, lenses, filter]);

  return (
    <FloorProvider value={{ selected, select: setSelected, filter }}>
      {GROUPS.map((g) => (
        <div key={g.title}>
          <div className="floorgroup">
            <span className="lbl">{g.title}</span>
            <span className="muted">{g.note}</span>
          </div>
          <div className="floortabs" role="tablist" aria-label={g.title}>
            {g.ids.map((id) => {
              const t = TABS.find((x) => x.id === id)!;
              return (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  className={tab === t.id ? 'on' : ''}
                  onClick={() => setTab(t.id)}
                >
                  <b>{t.title}</b>
                  <span>{t.asks}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <FilterBar state={state} filter={filter} onChange={setFilter} shown={view.state.items.length} />

      <div className={`floorsplit${selected ? ' open' : ''}`}>
        <div className="card floorcard">
          <div className="chead">
            <h2>{active.title}</h2>
            <span className="lbl">{view.state.items.length} items · {state.scopeName}</span>
          </div>
          <div className="floorbody">
            {tab === 'line' && <LineView state={view.state} />}
            {tab === 'load' && <LoadView state={view.state} />}
            {tab === 'flow' && <FlowView state={view.state} />}
            {tab === 'clock' && <ClockView state={view.state} />}
            {tab === 'room' && <RoomView state={view.state} />}
            {tab === 'map' && <MapView board={view.board} />}
            {tab === 'plant' && <PlantView board={view.board} floor={view.state} />}
            {tab === 'moves' && <MovesView board={view.board} />}
            {tab === 'grid' && <GridView board={view.board} />}
            {tab === 'economy' && <EconomyView board={view.board} />}
            {tab === 'network' && <NetworkView network={view.lenses.network} />}
            {tab === 'leverage' && <LeverageView leverage={view.lenses.leverage} />}
            {tab === 'coverage' && <CoverageView coverage={view.lenses.coverage} />}
            {tab === 'radar' && <RadarView radar={view.lenses.radar} />}
            {tab === 'strip' && <StripView strip={view.lenses.strip} />}
          </div>
          <p className="cover"><b>What this one is for.</b> {active.learn}</p>
        </div>
        {selected && <Console state={state} board={board} />}
      </div>

      <FloorList state={view.state} />
    </FloorProvider>
  );
}
