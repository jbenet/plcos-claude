'use client';

import { useMemo, useState } from 'react';
import { useUrlParam } from '@/lib/url-state';
import type { BoardState } from '@/lib/board-client';
import type { FloorState } from '@/lib/floor-client';
import type { Lenses } from '@/lib/lenses-client';
import { filterProjection } from './projection';
import { Console } from './Console';
import { CoverageView } from './CoverageView';
import { FilterBar } from './FilterBar';
import { EMPTY_FILTER, FloorProvider, parseFloorFilter, type FloorFilter, type Selected } from './FloorContext';
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
    asks: 'Where is every LP, by status, and what is stuck where?',
    learn: 'Counts by status and lane, largest lanes first. Each cell counts the statuses that still need ladder evidence. Best for "what is the shape of the raise right now".',
  },
  {
    id: 'load', title: 'The load',
    asks: 'Who is carrying what, and is anyone holding more than they can finish?',
    learn: 'Ranks open workload by person and vehicle. Wired and passed LPs are not load. Best before assigning anything new.',
  },
  {
    id: 'flow', title: 'The flow',
    asks: 'Where does the evidence stop?',
    learn: 'The consent ladder, not the statuses: how many LPs have each rung on record, and how many went on to the next. Best for finding the rung where evidence stops arriving.',
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
    learn: 'The ladder rung by rung, with gauges read from dated evidence and a valve at every approval. Best for finding which step is slow rather than which deal is.',
  },
  {
    id: 'moves', title: 'The moves',
    asks: 'What can we do, and what does each one cost?',
    learn: 'The build menu, locked entries included, with the reason under each. Best when you have an hour and no idea what to spend it on.',
  },
  {
    id: 'grid', title: 'The grid',
    asks: 'What levers are left on each LP?',
    learn: 'LPs against levers. The status leads each row; what is open or not yet is read from the ladder. Best for spotting an LP we have run out of legal moves on.',
  },
  {
    id: 'economy', title: 'The economy',
    asks: 'What is about to run out?',
    learn: 'Person-time, goodwill, approvals, agent budget, materials, their own budget. Best before promising anyone anything.',
  },
  {
    id: 'network', title: 'The network',
    asks: 'Who can carry an ask to whom, and which paths are actually confirmed?',
    learn: 'Groups by role and vehicle, with recorded neighborhoods expanded on demand. Best before promising an introduction.',
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
    learn: 'Recency bands count dated exchanges; unknown dates have their own band. Best on a Friday.',
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
  // The tab is in the address (N65, issue 0009): a link opens it, and back steps through them.
  const [tab, setTab] = useUrlParam<TabId>('view', 'line', TABS.map((t) => t.id));
  const [filterParam, setFilterParam] = useUrlParam<string>('filter', '');
  const savedFilter = useMemo(() => parseFloorFilter(filterParam), [filterParam]);
  const [selected, setSelected] = useState<Selected>(null);
  // These projections contain shared resources or dated evidence, not per-LP metrics.
  const scopeOnly = ['plant', 'moves', 'economy', 'strip', 'clock', 'room'].includes(tab);
  const filter = scopeOnly ? EMPTY_FILTER : savedFilter;
  const setFilter = (next: FloorFilter) => { setFilterParam(JSON.stringify(next), next.find !== savedFilter.find ? 'replace' : 'push'); setSelected(null); };
  const active = TABS.find((t) => t.id === tab)!;

  /**
   * One filter, applied to the projection before any view sees it. The board's rows and
   * the lenses are narrowed by the same item keys, so a search reshapes every tab at once
   * — and the count in the bar says how many were hidden.
   */
  const view = useMemo(() => {
    return filterProjection(state, board, lenses, filter);
  }, [state, board, lenses, filter]);

  return (
    <FloorProvider value={{ selected, select: setSelected, filter, setFilter }}>
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

      {scopeOnly ? <p className="cover"><b>Full page scope: {state.scopeName}.</b> This view includes shared resources or dated records. LP filters are paused here; choose a vehicle in the navigation to change scope.</p> : <FilterBar state={state} filter={filter} onChange={setFilter} shown={view.state.items.length} bands={[...new Set([...board.territories.map(t => t.band), 'Not inspected'])].sort()} />}

      <div className={`floorsplit${selected ? ' open' : ''}`}>
        <div className="card floorcard">
          <div className="chead">
            <h2>{active.title}</h2>
            <span className="lbl">{view.state.items.length} items · {state.scopeName}</span>
          </div>
          <div className="floorbody" key={JSON.stringify(filter)}>
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

      <FloorList key={JSON.stringify(filter)} state={view.state} />
    </FloorProvider>
  );
}
