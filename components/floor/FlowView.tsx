'use client';

import type { FloorState } from '@/lib/floor-client';
import { RUNG_LABEL, RUNG_REQUIRES, RUNGS, type LadderRung } from '@/modules/strategy/client';
import { compactUsd, shortName, stateOf } from './shared';

/**
 * View 3 — the flow.
 *
 * The other views draw where things are. This one draws **where things stop**. A node is a
 * rung, its height is how many pursuits have ever had evidence for that rung, and a ribbon
 * is how many of them carried on to the next one. The gap between a node and the ribbon
 * leaving it is the drop-off, drawn as a hanging pool under the node.
 *
 * That pool is the useful part. Everything above it is a process working; the pool is the
 * work that entered a station and never left, which no status list surfaces because every
 * row in it looks fine on its own.
 */

const W = 1000;
const H = 380;
const NODE_W = 26;
const TOP = 76;

export function FlowView({ state }: { state: FloorState }) {
  const has = (r: LadderRung) => state.items.filter((i) => i.path.includes(r));
  const counts = RUNGS.map((r) => has(r).length);
  const maxCount = Math.max(1, ...counts);
  const unit = (H - TOP - 60) / maxCount;

  const gap = (W - 90) / RUNGS.length;
  const x = (i: number) => 60 + i * gap;

  const advanced = (i: number) => {
    const here = RUNGS[i]!;
    const next = RUNGS[i + 1];
    if (!next) return [];
    return state.items.filter((it) => it.path.includes(here) && it.path.includes(next));
  };
  /** Sitting at this rung right now, and nothing recorded for three weeks. */
  const stuckAt = (r: LadderRung) => state.items.filter((i) => i.rung === r && i.stalled);
  const restingAt = (r: LadderRung) => state.items.filter((i) => i.rung === r);

  return (
    <div className="flowview">
      <svg viewBox={`0 0 ${W} ${H}`} className="flsvg" role="img"
           aria-label="How many pursuits reached each rung, and how many carried on">
        {RUNGS.map((r, i) => {
          const n = counts[i]!;
          const h = Math.max(4, n * unit);
          const y = TOP + (H - TOP - 60 - h) / 2;
          const moved = advanced(i).length;
          const nextH = Math.max(2, moved * unit);
          const nextY = i + 1 < RUNGS.length
            ? TOP + (H - TOP - 60 - Math.max(4, counts[i + 1]! * unit)) / 2
            : 0;
          const stuck = stuckAt(r);
          const resting = restingAt(r);
          return (
            <g key={r}>
              {i + 1 < RUNGS.length && moved > 0 && (
                <path
                  className="fribbon"
                  d={`M${x(i) + NODE_W},${y} C${x(i) + gap * 0.55},${y} ${x(i) + gap * 0.45},${nextY} ${x(i + 1)},${nextY}
                     L${x(i + 1)},${nextY + nextH} C${x(i) + gap * 0.45},${nextY + nextH} ${x(i) + gap * 0.55},${y + nextH} ${x(i) + NODE_W},${y + nextH} Z`}
                />
              )}
              <rect x={x(i)} y={y} width={NODE_W} height={h} rx={3} className="fnode" />
              <text x={x(i)} y={TOP - 46} className="fnl">{String(i + 1).padStart(2, '0')}</text>
              <text x={x(i)} y={TOP - 32} className="fnt">{RUNG_LABEL[r]}</text>
              <text x={x(i)} y={y - 7} className="fnn">{n}</text>
              <title>{`${RUNG_LABEL[r]} — ${RUNG_REQUIRES[r]}`}</title>

              {/* The pool: what is sitting at this rung, and what has gone quiet in it. */}
              {resting.length > 0 && (
                <g transform={`translate(${x(i)}, ${H - 46})`}>
                  <rect x={-6} y={-8} width={NODE_W + 12} height={26} rx={4}
                        className={stuck.length ? 'fpool stuck' : 'fpool'} />
                  <text x={NODE_W / 2 - 6} y={8} className="fpn" textAnchor="middle">
                    {resting.length}
                  </text>
                </g>
              )}
              {stuck.length > 0 && (
                <text x={x(i) + NODE_W / 2} y={H - 4} className="fps" textAnchor="middle">
                  {stuck.length} stalled
                </text>
              )}
            </g>
          );
        })}
        <text x={2} y={H - 52} className="fpl">Sitting</text>
        <text x={2} y={H - 42} className="fpl">here now</text>
      </svg>

      <div className="fstalls">
        {RUNGS.map((r) => {
          const stuck = stuckAt(r);
          if (stuck.length === 0) return null;
          return (
            <div className="fstall" key={r}>
              <div className="lbl">Stalled at {RUNG_LABEL[r]}</div>
              {stuck.map((i) => (
                <div className="fsrow" key={i.key}>
                  <b>{shortName(i.entityName, 26)}</b>
                  <span className="mono">{compactUsd(i.amount)}</span>
                  <span className={`flag ${stateOf(i) === 'blocked' ? 'f-block' : 'f-mute'}`}>
                    {i.daysSinceMove ?? '—'}d
                  </span>
                  <span className="fswhy">{i.blocked ?? i.tempBasis}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {counts[4]! > counts[2]! && (
        <p className="cover fwhy">
          <b>The funnel is the wrong way round, and that is the finding.</b>{' '}
          {counts[4]} pursuits have a commitment and {counts[5]} have cash, while only{' '}
          {counts[2]} ever recorded a meeting — because the closed ones were closed before any
          of this existed, and their early rungs were never written down. The left of this
          drawing is what the system knows; the right is what the bank knows. They will only
          agree about deals that start from here.
        </p>
      )}

      <div className="fllegend light">
        <span>Node height = pursuits that ever reached that rung</span>
        <span>Ribbon = the ones that carried on to the next</span>
        <span>Pool = sitting there now · outlined in clay when nothing has moved for 3 weeks</span>
        <span>This counts pursuits, not money — a count and a total answer different questions</span>
      </div>
    </div>
  );
}
