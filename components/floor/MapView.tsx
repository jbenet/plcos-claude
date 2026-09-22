'use client';

import type { BoardState, Territory } from '@/lib/board-client';
import { EXPLORED_LABEL, HOLDING_LABEL } from '@/lib/board-client';
import { compactUsd, shortName } from './shared';

/**
 * View 6 — the map.
 *
 * The ground, rather than the work. Every name we could approach is placed by the two
 * rubric dimensions that decide whether approaching is worth it at all: **can they write
 * this cheque** and **does the mandate actually match**. Size is the cheque, colour is who
 * holds the ground.
 *
 * The strip underneath is the fog, and it is the point of the view. A name nobody has
 * scored cannot be placed, and placing it anyway — at the middle, at zero, wherever — would
 * turn "we have not looked" into "we looked and it was mediocre". Those are opposite facts.
 */

const W = 1000;
const H = 470;
const PAD = { l: 92, r: 30, t: 34, b: 58 };

const HOLD_FILL: Record<string, string> = {
  wired: 'var(--fl-green)', ours: 'var(--fl-ink)', contested: 'var(--fl-purple)',
  restricted: 'var(--fl-clay)', open: 'var(--fl-amber)',
};

export function MapView({ board }: { board: BoardState }) {
  const placed = board.territories.filter((t) => t.capacity !== null && t.affinity !== null);
  const fogged = board.territories.filter((t) => t.capacity === null || t.affinity === null);

  const top = Math.max(1, ...board.territories.map((t) => t.cheque ?? 0));
  const r = (t: Territory) => 5 + Math.sqrt((t.cheque ?? 0) / top) * 21;
  const x = (v: number) => PAD.l + v * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - v * (H - PAD.t - PAD.b);

  return (
    <div className="floordark mapview">
      <svg viewBox={`0 0 ${W} ${H}`} className="flsvg" role="img"
           aria-label="Every name placed by capacity and mandate fit, with the unscored ones held back">
        <rect x={x(0.5)} y={PAD.t} width={x(1) - x(0.5)} height={y(0.5) - PAD.t} className="mquad good" />
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={x(v)} y1={PAD.t} x2={x(v)} y2={y(0)} className="mgrid" />
            <line x1={x(0)} y1={y(v)} x2={x(1)} y2={y(v)} className="mgrid" />
            <text x={x(v)} y={y(0) + 14} className="mtick" textAnchor="middle">{v}</text>
            <text x={PAD.l - 8} y={y(v) + 3} className="mtick" textAnchor="end">{v}</text>
          </g>
        ))}
        <text x={x(0.5)} y={H - 24} className="maxis" textAnchor="middle">
          AFFINITY — does the mandate actually match
        </text>
        <text x={16} y={y(0.5)} className="maxis" textAnchor="middle" transform={`rotate(-90 16 ${y(0.5)})`}>
          CAPACITY — can they write it
        </text>
        <text x={x(0.98)} y={PAD.t + 14} className="mquadl" textAnchor="end">WHERE THE MONEY IS</text>
        <text x={x(0.02)} y={PAD.t + 14} className="mquadl">BIG, WRONG SHAPE</text>
        <text x={x(0.02)} y={y(0.02)} className="mquadl">NEITHER</text>
        <text x={x(0.98)} y={y(0.02)} className="mquadl" textAnchor="end">RIGHT SHAPE, SMALL</text>

        {placed.map((t) => (
          <g key={t.entityId} className="mdot">
            <title>{[(`${t.name} · ${t.segment}\n`), (`Capacity ${t.capacity} · affinity ${t.affinity} · propensity ${t.propensity ?? '—'} · time ${t.timeToDecision ?? '—'}\n`), (`${t.band}. ${t.scoreBasis}\n`), (`${compactUsd(t.cheque)} — ${t.chequeBasis}\n`), (`${HOLDING_LABEL[t.holding]}${t.ownerName ? `, ${t.ownerName}` : ''} · ${t.edges} edges on file`)].join('')}</title>
            <circle
              cx={x(t.affinity!)} cy={y(t.capacity!)} r={r(t)}
              fill={HOLD_FILL[t.holding]} fillOpacity={t.holding === 'open' ? 0.18 : 0.42}
              stroke={HOLD_FILL[t.holding]}
              strokeDasharray={t.holding === 'open' ? '3 2' : undefined}
            />
            <text x={x(t.affinity!)} y={y(t.capacity!) - r(t) - 4} className="mname" textAnchor="middle">
              {shortName(t.name, 20)}
            </text>
          </g>
        ))}
      </svg>

      <div className="fogbank">
        <div className="foghead">
          <span className="lbl">The fog</span>
          <b>{fogged.length} of {board.territories.length} names cannot be placed</b>
          <span className="fognote">{board.fog.note}</span>
        </div>
        <div className="fogtiles">
          {fogged.map((t) => (
            <span key={t.entityId} className={`fogtile e-${t.explored} h-${t.holding}`}
                  title={`${t.name} · ${t.segment}\n${EXPLORED_LABEL[t.explored]}\n${t.scoreBasis}\n${t.edges} edges on file`}>
              {shortName(t.name, 22)}
              <i>{t.explored === 'researched' ? 'researched' : 'name only'}</i>
            </span>
          ))}
        </div>
      </div>

      <div className="fllegend">
        <span>Size = cheque they could write</span>
        <span><i className="sw" style={{ background: 'var(--fl-ink)' }} /> we are working it</span>
        <span><i className="sw" style={{ background: 'var(--fl-amber)' }} /> nobody is</span>
        <span><i className="sw" style={{ background: 'var(--fl-purple)' }} /> contested between vehicles</span>
        <span><i className="sw" style={{ background: 'var(--fl-clay)' }} /> do not approach</span>
        <span><i className="sw" style={{ background: 'var(--fl-green)' }} /> wired</span>
      </div>
    </div>
  );
}
