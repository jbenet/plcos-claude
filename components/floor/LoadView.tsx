'use client';

import type { FloorItem, FloorState } from '@/lib/floor-client';
import { RUNG_LABEL } from '@/modules/strategy/client';
import { compactUsd, shortName, stateOf, STATE_GLYPH, TEMP_ALPHA } from './shared';

/**
 * View 2 — the load.
 *
 * Not "where is the work" but "who is carrying it". One column per person, and inside a
 * column the two tracks stand side by side rather than stacked: **a stack of soft on top
 * of hard is a blended total drawn instead of written**, and it is the same lie either way.
 *
 * Block height is the money at stake in that track. The header counts what is in flight and
 * how much of it has not moved in three weeks, because a person holding eleven things that
 * are all stalled is not busy — they are stuck, and the two look identical on a list.
 */

const COL_H = 300;
const WIP_LINE = 6;

export function LoadView({ state }: { state: FloorState }) {
  /**
   * Wired money is not load. It was work once; it is now a fact, and leaving it in the
   * bars makes the person who closed the most look like the person with the most left
   * to do — which is the exact opposite of true.
   */
  const open = state.items.filter((i) => !i.cashReceived);
  const owners = [...new Set(open.map((i) => i.ownerName))]
    .sort((a, b) => open.filter((i) => i.ownerName === b).length
      - open.filter((i) => i.ownerName === a).length);

  /** Scale on the heaviest column, so the tallest stack fills the view and no more. */
  const heaviest = Math.max(1, ...owners.map((o) => Math.max(
    open.filter((i) => i.ownerName === o && i.track === 'hard').reduce((n, i) => n + (i.amount ?? 0), 0),
    open.filter((i) => i.ownerName === o && i.track === 'soft').reduce((n, i) => n + (i.amount ?? 0), 0),
  )));

  const column = (items: FloorItem[], track: 'hard' | 'soft') => {
    const mine = items.filter((i) => i.track === track).sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
    const total = mine.reduce((n, i) => n + (i.amount ?? 0), 0);
    return (
      <div className="lstack">
        <div className="lstrack">
          {track === 'hard' ? 'Hard' : 'Soft'}
          <b>{mine.length ? compactUsd(total) : '—'}</b>
        </div>
        <div className="lsbars">
          {mine.map((i) => {
            const st = stateOf(i);
            return (
              <div
                key={i.key}
                className={`lsbar s-${st} t-${track}`}
                style={{
                  height: `${Math.max(14, ((i.amount ?? 0) / heaviest) * COL_H)}px`,
                  opacity: TEMP_ALPHA[i.temp] * 0.75 + 0.25,
                }}
                title={`${i.entityName} · ${i.vehicleName}\n${compactUsd(i.amount)} ${track} — ${i.sizeBasis}\n`
                  + `${i.rung ? RUNG_LABEL[i.rung] : 'No rung with evidence yet'}\n${i.tempBasis}`
                  + `${i.blocked ? `\nBlocked: ${i.blocked}` : ''}`}
              >
                <span className="lsn">{shortName(i.entityName, 20)}</span>
                <span className="lsv">{compactUsd(i.amount)} {STATE_GLYPH[st]}</span>
              </div>
            );
          })}
          {mine.length === 0 && <div className="lsnone">nothing</div>}
        </div>
      </div>
    );
  };

  return (
    <div className="loadview">
      <div className="lcols">
        {owners.map((owner) => {
          const mine = open.filter((i) => i.ownerName === owner);
          const wired = state.items.filter((i) => i.ownerName === owner && i.cashReceived);
          const stalled = mine.filter((i) => i.stalled).length;
          const blocked = mine.filter((i) => stateOf(i) === 'blocked').length;
          const unsized = mine.filter((i) => i.amount === null).length;
          const over = mine.length > WIP_LINE;
          return (
            <div className={`lcol${over ? ' over' : ''}`} key={owner}>
              <div className="lhead">
                <b>{owner}</b>
                <span className="lwip">
                  {mine.length} in flight{over ? ` · over ${WIP_LINE}` : ''}
                </span>
                <span className="lsub">
                  {stalled} stalled · {blocked} blocked{unsized ? ` · ${unsized} with no number` : ''}
                </span>
              </div>
              <div className="ltracks">
                {column(mine, 'hard')}
                {column(mine, 'soft')}
              </div>
              {wired.length > 0 && (
                <div className="lwired">
                  ✓ {wired.length} wired and out of the queue ·{' '}
                  {compactUsd(wired.reduce((n, i) => n + (i.amount ?? 0), 0))} hard
                </div>
              )}
              {mine.some((i) => i.amount === null) && (
                <div className="lunsized">
                  {mine.filter((i) => i.amount === null).map((i) => (
                    <span key={i.key} className={`lchip s-${stateOf(i)}`} title={i.tempBasis}>
                      {shortName(i.entityName, 22)}
                    </span>
                  ))}
                  <span className="lnote">no number from them yet — not drawn to scale, because there is no scale</span>
                </div>
              )}
            </div>
          );
        })}

        <div className="lcol agents">
          <div className="lhead">
            <b>Agents</b>
            <span className="lwip">{state.agents.running} running</span>
            <span className="lsub">
              {state.agents.awaitingAcceptance} waiting on a human · {state.agents.refused} refused
            </span>
          </div>
          <div className="lqueue">
            {state.agents.queue.map((q, i) => (
              <div className={`lq q-${q.state}`} key={i}>
                <span className="lqs">{q.state}</span>
                <span className="lqt">{q.label}</span>
                <span className="lqw">{q.who}</span>
              </div>
            ))}
            {state.agents.queue.length === 0 && <div className="lsnone">no runs on file</div>}
          </div>
          <div className="lunsized">
            <span className="lnote">
              Enrichment queue: {state.agents.humanQueued}/{state.agents.humanWip} human,{' '}
              {state.agents.agentQueued}/{state.agents.agentWip} agent.{' '}
              {state.agents.breaker.statement}
            </span>
          </div>
        </div>
      </div>

      <div className="fllegend light">
        <span>Column = one person · height = money at stake in that track</span>
        <span>Wired money is not load — it is counted under each column, not in the bars</span>
        <span><i className="sw" style={{ background: 'var(--clay)' }} /> ✕ blocked</span>
        <span><i className="sw" style={{ background: 'var(--amber)' }} /> ! dated soon</span>
        <span><i className="sw" style={{ background: 'var(--green)' }} /> ✓ cash</span>
        <span>Faint = nothing recorded lately · hard and soft never share a bar</span>
      </div>
    </div>
  );
}
