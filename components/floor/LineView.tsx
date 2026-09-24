'use client';

import { RUNG_LABEL, STATUS_BACKED_BY, STATUS_LABEL, STATUSES } from '@/modules/strategy/client';
import type { FloorItem, FloorState } from '@/lib/floor-client';
import { useFloor } from './FloorContext';
import {
  claimWords, compactUsd, EVIDENCE_GLYPH, ladderWords, shortName, stateOf, STATE_GLYPH, TEMP_ALPHA, widthScale,
} from './shared';

/**
 * View 1 — the line.
 *
 * One station per pipeline status (N50, docs/17), left to right, and every pursuit sitting at
 * its status. A status is our plan and can move in any direction, so the line
 * is where the effort is, not a claim about the LP. The claim is the ladder: it is in each
 * block's tooltip and in the console, and a block whose status claims more than the ladder
 * shows carries ◇ — the gap between what we say and what is on record, drawn rather than
 * smoothed over (rule 2, N62).
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
  const { select } = useFloor();
  const byVehicle = state.scopeSlug === null;
  const laneKey = (i: FloorItem) => (byVehicle ? i.vehicleName : i.ownerName);
  const lanes = [...new Set(state.items.map(laneKey))];
  const width = 1000;
  /**
   * Seven columns, one per status, New first. New and Sourcing are real work sitting in front
   * of any outreach, and leaving them out of the drawing is how they stay invisible until the
   * quarter ends. Passed is last: off, for now, and able to reopen.
   */
  const COLS = STATUSES;
  const stageW = (width - LANE_W) / COLS.length;
  const w = widthScale(state.items, 64, stageW - 14);

  const cell = (lane: string, status: FloorItem['status']) =>
    state.items.filter((i) => laneKey(i) === lane && i.status === status);

  const laneRows = lanes.map((lane) => Math.max(1, ...COLS.map((s) => cell(lane, s.id).length)));
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
    const glyphs = `${item.needsEvidence ? EVIDENCE_GLYPH : ''}${st !== 'plain' ? STATE_GLYPH[st] : ''}`;
    const claim = claimWords(item);
    return (
      <g key={item.key} className="flblk" onClick={() => select({ kind: 'item', key: item.key })}>
        <title>{[
          `${item.entityName} · ${item.vehicleName} · ${item.ownerName}`,
          `${STATUS_LABEL[item.status]}. ${item.statusBasis}`,
          ladderWords(item),
          ...(claim ? [`Needs evidence: ${claim}`] : []),
          `${compactUsd(item.amount)}${item.track ? ` ${item.track}` : ''} — ${item.sizeBasis}`,
          `${item.tempBasis}${item.blocked ? `\nBlocked: ${item.blocked}` : ''}${item.urgent ? `\n${item.urgent}` : ''}`,
        ].join('\n')}</title>
        <rect
          x={x} y={top} width={bw} height={ROW_H - 5} rx={3}
          fill={fill} fillOpacity={TEMP_ALPHA[item.temp]}
          stroke={fill} strokeOpacity={st === 'plain' ? 0.5 : 0.95}
          strokeDasharray={item.track === 'soft' ? '3 2' : undefined}
        />
        <text x={x + 5} y={top + 11.5} className="flbt" fill="var(--fl-text)">
          {shortName(item.entityName, Math.floor((bw - 10 - glyphs.length * 7) / 5.4))}
          {item.amount === null ? ' ?' : ''}
        </text>
        {glyphs && (
          <text x={x + bw - 3} y={top + 11.5} className="flbg" fill="var(--fl-text)" textAnchor="end">
            {glyphs}
          </text>
        )}
      </g>
    );
  };

  return (
    <div className="floordark">
      <svg viewBox={`0 0 ${width} ${height}`} className="flsvg" role="img"
           aria-label="Every pursuit at its pipeline status, with the ladder's evidence marked where it falls short">
        {COLS.map((s, i) => {
          const x = LANE_W + i * stageW;
          const here = state.items.filter((it) => it.status === s.id);
          const short = here.filter((it) => it.needsEvidence).length;
          const backedBy = STATUS_BACKED_BY[s.id];
          return (
            <g key={s.id}>
              <title>{`${s.label}: ${s.means}${backedBy
                ? `\nOn the ladder it rests on ${RUNG_LABEL[backedBy]}: ${here.length - short} of ${here.length} have it.`
                : '\nIt claims nothing about the LP, so there is nothing on the ladder for it to wait for.'}`}</title>
              <rect x={x} y={0} width={stageW - STAGE_GAP} height={height}
                    fill={s.id === 'passed' ? 'var(--fl-bg)' : 'var(--fl-cell)'} />
              <text x={x + 4} y={16} className="flsh" fill="var(--fl-muted)">
                {String(i + 1).padStart(2, '0')} {s.label.toUpperCase()}
              </text>
              <text x={x + 4} y={32} className="flsn" fill={s.id === 'passed' ? 'var(--fl-muted)' : 'var(--fl-text)'}>
                {here.length}
              </text>
              {short > 0 && (
                <text x={x + 10 + String(here.length).length * 8} y={31} className="flse" fill="var(--fl-muted)">
                  {EVIDENCE_GLYPH} {short} need{short === 1 ? 's' : ''} evidence
                </text>
              )}
              <line x1={x - STAGE_GAP / 2} y1={HEAD_H - 8} x2={x - STAGE_GAP / 2} y2={height}
                    stroke="var(--fl-line)" />
            </g>
          );
        })}

        {lanes.map((lane, li) => {
          const top = laneY[li]!;
          const rows = laneRows[li]!;
          const mine = state.items.filter((i) => laneKey(i) === lane);
          const passed = mine.filter((i) => i.status === 'passed').length;
          return (
            <g key={lane}>
              <line x1={0} y1={top - LANE_PAD} x2={width} y2={top - LANE_PAD} stroke="var(--fl-line)" />
              <text x={2} y={top + 11} className="flln" fill="var(--fl-text)">{lane}</text>
              <text x={2} y={top + 26} className="flls" fill="var(--fl-muted)">
                {mine.length - passed} in flight{passed ? ` · ${passed} passed` : ''}
              </text>
              {/* The belt each lane's work sits on. */}
              <rect x={LANE_W} y={top - 4} width={width - LANE_W} height={rows * ROW_H}
                    fill="var(--fl-belt)" />
              {COLS.map((s, si) => cell(lane, s.id).map((item, k) => (
                block(item, LANE_W + si * stageW + 5, top + k * ROW_H)
              )))}
            </g>
          );
        })}
      </svg>

      <div className="fllegend">
        <span>Column = the status · the ladder is in the tooltip, and a click opens both</span>
        <span>{EVIDENCE_GLYPH} Needs evidence — the status claims more than the ladder shows</span>
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
