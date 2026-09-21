'use client';

import type { Dated, FloorState } from '@/lib/floor-client';
import { shortName } from './shared';

/**
 * View 4 — the clock.
 *
 * Three weeks forward, one row per lane, one mark per dated record. Nothing on it is a
 * prediction: every mark is a date somebody already wrote down, which is why the left-hand
 * column matters more than the timeline does.
 *
 * That column holds the work with **no date on it at all**. On a factory floor that is the
 * pile in the corner, and it is where a raise quietly dies — not in the things that are
 * late, but in the things nobody ever scheduled.
 */

const DAYS = 21;
const ROW_H = 34;
const LEFT = 150;
const W = 1000;
const TOP = 40;

const KIND_MARK: Record<Dated['kind'], string> = {
  meeting: '●', expiry: '◆', followup: '■', close: '▲', seat: '◇',
};
const KIND_LABEL: Record<Dated['kind'], string> = {
  meeting: 'Meeting', expiry: 'Expiry', followup: 'Dated follow-up', close: 'Ask due', seat: 'Seat',
};

export function ClockView({ state }: { state: FloorState }) {
  const now = new Date(state.asOf);
  now.setHours(0, 0, 0, 0);
  const dayIndex = (d: Date) => Math.floor((d.getTime() - now.getTime()) / 86_400_000);

  const byVehicle = state.scopeSlug === null;
  const laneOf = (d: Dated) => (byVehicle ? d.vehicleName ?? 'Across vehicles' : d.ownerName ?? 'Unassigned');
  const lanes = [...new Set(state.schedule.map(laneOf))];
  if (lanes.length === 0) lanes.push(byVehicle ? 'Across vehicles' : 'Unassigned');

  const colW = (W - LEFT) / DAYS;
  const height = TOP + lanes.length * ROW_H + 24;

  const undated = state.items.filter((i) => !i.urgentAt && !i.cashReceived);

  return (
    <div className="floordark clockview">
      <div className="clockgrid">
        <div className="clockpile">
          <div className="lbl">No date on it</div>
          <div className="cpn">{undated.length}</div>
          <p>
            Work with nothing scheduled against it. Not late — <b>unscheduled</b>, which is
            the state nobody notices.
          </p>
          <div className="cplist">
            {undated.slice(0, 14).map((i) => (
              <div className="cprow" key={i.key} title={`${i.tempBasis}${i.blocked ? `\nBlocked: ${i.blocked}` : ''}`}>
                <span className={`cpdot t-${i.temp}`} />
                <span className="cpname">{shortName(i.entityName, 22)}</span>
                <span className="cpdays">{i.daysSinceMove === null ? 'never' : `${i.daysSinceMove}d`}</span>
              </div>
            ))}
            {undated.length > 14 && <div className="cpmore">+{undated.length - 14} more in the list below</div>}
          </div>
        </div>

        <svg viewBox={`0 0 ${W} ${height}`} className="flsvg" role="img"
             aria-label="Everything dated in the next three weeks">
          {Array.from({ length: DAYS }, (_, d) => {
            const day = new Date(now.getTime() + d * 86_400_000);
            const weekend = day.getDay() === 0 || day.getDay() === 6;
            return (
              <g key={d}>
                {weekend && (
                  <rect x={LEFT + d * colW} y={TOP - 14} width={colW} height={height - TOP} className="cweekend" />
                )}
                {d % 7 === 0 && (
                  <line x1={LEFT + d * colW} y1={TOP - 18} x2={LEFT + d * colW} y2={height - 20} className="cweek" />
                )}
                <text x={LEFT + d * colW + colW / 2} y={TOP - 22} className="cday" textAnchor="middle">
                  {d === 0 ? 'today' : day.getDate()}
                </text>
              </g>
            );
          })}

          {lanes.map((lane, li) => {
            const y = TOP + li * ROW_H;
            const marks = state.schedule.filter((d) => laneOf(d) === lane);
            return (
              <g key={lane}>
                <line x1={0} y1={y + ROW_H - 6} x2={W} y2={y + ROW_H - 6} className="crow" />
                <text x={2} y={y + 14} className="clane">{lane}</text>
                <text x={2} y={y + 27} className="clanes">{marks.length} dated</text>
                {marks.map((m, k) => {
                  const d = dayIndex(new Date(m.at));
                  if (d < 0 || d >= DAYS) return null;
                  const cx = LEFT + d * colW + colW / 2;
                  return (
                    <g key={m.key} className={`cmark k-${m.kind}`}>
                      <title>{`${KIND_LABEL[m.kind]} · ${new Date(m.at).toDateString()}\n${m.label}`}</title>
                      <text x={cx} y={y + 16 + (k % 2) * 11} textAnchor="middle" className="cglyph">
                        {KIND_MARK[m.kind]}
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}
          <line x1={LEFT} y1={TOP - 18} x2={LEFT} y2={height - 20} className="cnow" />
        </svg>
      </div>

      <div className="fllegend">
        <span>● meeting</span>
        <span>◆ ticket expiry</span>
        <span>■ dated follow-up from a conflict</span>
        <span>▲ ask due</span>
        <span>Three weeks forward · shaded = weekend · nothing here is predicted</span>
      </div>
    </div>
  );
}
