'use client';

import { useState } from 'react';
import type { BoardState } from '@/lib/board-client';
import type { FloorState } from '@/lib/floor-client';
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
] as const;

const GROUPS: Array<{ title: string; note: string; ids: TabId[] }> = [
  { title: 'State of play', note: 'what is happening', ids: ['line', 'load', 'flow', 'clock', 'room'] },
  { title: 'The space and the moves', note: 'what could happen, and at what cost', ids: ['map', 'plant', 'moves', 'grid', 'economy'] },
];

type TabId = typeof TABS[number]['id'];

export function FloorTabs({ state, board }: { state: FloorState; board: BoardState }) {
  const [tab, setTab] = useState<TabId>('line');
  const active = TABS.find((t) => t.id === tab)!;

  return (
    <>
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

      <div className="card floorcard">
        <div className="chead">
          <h2>{active.title}</h2>
          <span className="lbl">{state.items.length} items · {state.scopeName}</span>
        </div>
        <div className="floorbody">
          {tab === 'line' && <LineView state={state} />}
          {tab === 'load' && <LoadView state={state} />}
          {tab === 'flow' && <FlowView state={state} />}
          {tab === 'clock' && <ClockView state={state} />}
          {tab === 'room' && <RoomView state={state} />}
          {tab === 'map' && <MapView board={board} />}
          {tab === 'plant' && <PlantView board={board} floor={state} />}
          {tab === 'moves' && <MovesView board={board} />}
          {tab === 'grid' && <GridView board={board} />}
          {tab === 'economy' && <EconomyView board={board} />}
        </div>
        <p className="cover"><b>What this one is for.</b> {active.learn}</p>
      </div>

      <FloorList state={state} />
    </>
  );
}
