'use client';

import type { BoardState, CellState } from '@/lib/board-client';
import { CELL_GLYPH, CELL_LABEL, LEVERS } from '@/lib/board-client';
import { compactUsd } from './shared';

/**
 * View 9 — the grid.
 *
 * The action economy: one row per target, one column per lever, and the state of that lever
 * on that target. It answers the question the other views dodge — **what can we actually do
 * about this one**, and it makes the worst case legible: a row with no open cell at all.
 *
 * The distinction the grid exists to keep is between *blocked* and *not yet*. A lever we are
 * forbidden to pull and a lever that is simply out of reach look identical on a status list
 * and demand opposite responses: one is a decision to revisit, the other is a rung to climb.
 */

const ORDER: CellState[] = ['open', 'spent', 'done', 'blocked', 'locked'];

export function GridView({ board }: { board: BoardState }) {
  const count = (key: string, state: CellState) =>
    board.rows.filter((r) => r.cells[key]?.state === state).length;

  return (
    <div className="gridview">
      <div className="scroller">
        <table className="list gridtable">
          <thead>
            <tr>
              <th style={{ width: 210 }}>Target</th>
              <th style={{ width: 86 }}>At stake</th>
              {LEVERS.map((l) => (
                <th key={l.key} title={l.means}>{l.label}</th>
              ))}
              <th style={{ width: 96 }}>Open moves</th>
            </tr>
          </thead>
          <tbody>
            {board.rows.map((r) => {
              const open = LEVERS.filter((l) => r.cells[l.key]?.state === 'open').length;
              return (
                <tr key={`${r.entityId}:${r.vehicleName}`} className={open === 0 ? 'stuck' : undefined}>
                  <td>
                    <b>{r.name}</b>
                    <div className="muted gsub">{r.vehicleName} · {r.ownerName}</div>
                  </td>
                  <td className="mono right">{compactUsd(r.stake)}</td>
                  {LEVERS.map((l) => {
                    const cell = r.cells[l.key]!;
                    return (
                      <td key={l.key} className={`gcell s-${cell.state}`}
                          title={`${l.label} — ${CELL_LABEL[cell.state]}\n${cell.note}`}>
                        <span aria-label={CELL_LABEL[cell.state]}>{CELL_GLYPH[cell.state]}</span>
                      </td>
                    );
                  })}
                  <td className={`mono right${open === 0 ? ' gnone' : ''}`}>
                    {open === 0 ? 'none' : open}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2} className="muted">Targets with this lever open</td>
              {LEVERS.map((l) => (
                <td key={l.key} className="mono gfoot">{count(l.key, 'open')}</td>
              ))}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="glegend">
        {ORDER.map((s) => (
          <span key={s} className={`gkey s-${s}`}>
            <i>{CELL_GLYPH[s]}</i> {CELL_LABEL[s]}
          </span>
        ))}
      </div>
      <p className="cover">
        <b>A row with no open cell is the finding.</b> It is not a target going badly — it is a
        target we have run out of legal moves on, which is a different meeting with a different
        person. Blocked and not-yet are drawn apart for the same reason: one is a decision to
        revisit, the other is a rung to climb.
      </p>
    </div>
  );
}
