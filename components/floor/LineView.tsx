'use client';

import { RUNG_LABEL, RUNGS, type LadderRung } from '@/modules/strategy/client';
import type { FloorItem, FloorState } from '@/lib/floor-client';
import { compactUsd, shortName, stateOf, STATE_GLYPH, TEMP_ALPHA, widthScale } from './shared';

/**
 * View 1 — the line.
 *
 * The literal reading of the brief: six stations, one per rung of the consent ladder, and
 * every pursuit sitting at the station it has evidence for. Work moves left to right and
 * only ever one station at a time, which is the rule the rest of the system enforces and
 * the thing this drawing is for.
 *
 * A lane is a vehicle across all of PL Capital, or an owner inside one vehicle — because
 * at that point the question stops being "which raise" and starts being "which person".
 */

const LANE_W = 128;
const STAGE_GAP = 6;
const ROW_H = 21;
const LANE_PAD = 10;
const HEAD_H = 46;

export function LineView({ state }: { state: FloorState }) {
  const byVehicle = state.scopeSlug === null;
  const laneKey = (i: FloorItem) => (byVehicle ? i.vehicleName : i.ownerName);
  const lanes = [...new Set(state.items.map(laneKey))];
  const width = 1000;
  /**
   * Seven columns, not six. Something sourced and not yet on any rung is real work sitting
   * in front of the first station, and leaving it out of the drawing is how it stays
   * invisible until the quarter ends.
   */
  const COLS: Array<LadderRung | null> = [null, ...RUNGS];
  const stageW = (width - LANE_W) / COLS.length;
  const w = widthScale(state.items, 64, stageW - 14);

  // Sourced but not on a rung yet — they queue in front of the first station.
  const cell = (lane: string, rung: LadderRung | null) =>
    state.items.filter((i) => laneKey(i) === lane && i.rung === rung);

  const COLS_FOR_ROWS: Array<LadderRung | null> = [null, ...RUNGS];
  const laneRows = lanes.map((lane) => Math.max(
    1,
    ...COLS_FOR_ROWS.map((r) => cell(lane, r).length),
  ));
  const laneY: number[] = [];
  let y = HEAD_H;
  laneRows.forEach((rows) => { laneY.push(y); y += rows * ROW_H + LANE_PAD * 2; });
  const height = y + 4;

  const block = (item: FloorItem, x: number, top: number) => {
    const st = stateOf(item);
    const bw = w(item.amount);
    const fill = st === 'cash' ? 'var(--fl-green)'
      : st === 'blocked' ? 'var(--fl-clay)'
      : st === 'urgent' ? 'var(--fl-amber)'
      : 'var(--fl-ink)';
    return (
      <g key={item.key} className="flblk">
        <title>{[(`${item.entityName} · ${item.vehicleName} · ${item.ownerName}\n`), (`${item.rung ? RUNG_LABEL[item.rung] : 'No rung with evidence yet'}\n`), (`${compactUsd(item.amount)}${item.track ? ` ${item.track}` : ''} — ${item.sizeBasis}\n`), (`${item.tempBasis}${item.blocked ? `\nBlocked: ${item.blocked}` : ''}`), (item.urgent ? `\n${item.urgent}` : '')].join('')}</title>
        <rect
          x={x} y={top} width={bw} height={ROW_H - 5} rx={3}
          fill={fill} fillOpacity={TEMP_ALPHA[item.temp]}
          stroke={fill} strokeOpacity={st === 'plain' ? 0.5 : 0.95}
          strokeDasharray={item.track === 'soft' ? '3 2' : undefined}
        />
        <text x={x + 5} y={top + 11.5} className="flbt" fill="var(--fl-text)">
          {shortName(item.entityName, Math.floor((bw - 18) / 5.4))}
          {item.amount === null ? ' ?' : ''}
        </text>
        {st !== 'plain' && (
          <text x={x + bw - 8} y={top + 11.5} className="flbg" fill="var(--fl-text)">
            {STATE_GLYPH[st]}
          </text>
        )}
      </g>
    );
  };

  return (
    <div className="floordark">
      <svg viewBox={`0 0 ${width} ${height}`} className="flsvg" role="img"
           aria-label="Every pursuit at the ladder rung it has evidence for">
        {COLS.map((r, i) => {
          const x = LANE_W + i * stageW;
          const n = state.items.filter((it) => it.rung === r).length;
          return (
            <g key={r ?? 'sourced'}>
              <rect x={x} y={0} width={stageW - STAGE_GAP} height={height} fill="var(--fl-cell)" />
              <text x={x + 4} y={16} className="flsh" fill="var(--fl-muted)">
                {String(i).padStart(2, '0')} {(r === null ? 'Sourced, no rung' : RUNG_LABEL[r]).toUpperCase()}
              </text>
              <text x={x + 4} y={32} className="flsn" fill="var(--fl-text)">{n}</text>
              <line x1={x - STAGE_GAP / 2} y1={HEAD_H - 8} x2={x - STAGE_GAP / 2} y2={height}
                    stroke="var(--fl-line)" />
            </g>
          );
        })}

        {lanes.map((lane, li) => {
          const top = laneY[li]!;
          const rows = laneRows[li]!;
          return (
            <g key={lane}>
              <line x1={0} y1={top - LANE_PAD} x2={width} y2={top - LANE_PAD} stroke="var(--fl-line)" />
              <text x={2} y={top + 11} className="flln" fill="var(--fl-text)">{lane}</text>
              <text x={2} y={top + 26} className="flls" fill="var(--fl-muted)">
                {state.items.filter((i) => laneKey(i) === lane).length} in flight
              </text>
              {/* The belt each lane's work sits on. */}
              <rect x={LANE_W} y={top - 4} width={width - LANE_W} height={rows * ROW_H}
                    fill="var(--fl-belt)" />
              {COLS.map((r, si) => cell(lane, r).map((item, k) => (
                block(item, LANE_W + si * stageW + 5, top + k * ROW_H)
              )))}
            </g>
          );
        })}
      </svg>

      <div className="fllegend">
        <span><i className="sw" style={{ background: 'var(--fl-ink)' }} /> Running</span>
        <span><i className="sw" style={{ background: 'var(--fl-clay)' }} /> ✕ Blocked or restricted</span>
        <span><i className="sw" style={{ background: 'var(--fl-amber)' }} /> ! Dated in the next fortnight</span>
        <span><i className="sw" style={{ background: 'var(--fl-green)' }} /> ✓ Cash received</span>
        <span><i className="sw dash" /> Dashed edge = soft, their words</span>
        <span>Width = money at stake · ? and the shortest width = no number from them</span>
        <span>Faint = nothing recorded lately</span>
      </div>
    </div>
  );
}
