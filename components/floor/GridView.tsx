'use client';

import { useState } from 'react';
import { Pager, usePage } from './Paging';
import { n } from './scale';
import css from './floor.module.css';

import type { BoardState, CellState } from '@/lib/board-client';
import { CELL_GLYPH, CELL_LABEL, LEVERS } from '@/lib/board-client';
import { STATUS_LABEL } from '@/modules/strategy/client';
import { useFloor } from './FloorContext';
import { claimWords, compactUsd, EVIDENCE_GLYPH, rungShort, standingWords } from './shared';

/**
 * View 9 — the grid.
 *
 * The action economy: one row per LP, one column per lever, and the state of that lever
 * on that LP. It answers the question the other views dodge — **what can we actually do
 * about this one**, and it makes the worst case legible: a row with no open cell at all.
 *
 * The distinction the grid exists to keep is between *blocked* and *not yet*. A lever we are
 * forbidden to pull and a lever that is simply out of reach look identical on a status list
 * and demand opposite responses: one is a decision to revisit, the other is a rung to climb.
 * So each row leads with its status (N62) and says the rung under it: "not yet" is read from
 * the ladder, and a status the ladder does not back is marked, because that is the row where
 * a lever looks locked while the plan says we are past it.
 */

const ORDER: CellState[] = ['open', 'spent', 'done', 'blocked', 'locked'];

export function GridView({ board }: { board: BoardState }) {
  const [onlyStuck, setOnlyStuck] = useState(false);
  const openCount = (r: BoardState['rows'][number]) => LEVERS.filter((l) => r.cells[l.key]?.state === 'open').length;
  const stuck = board.rows.filter((r) => openCount(r) === 0);
  const rows = onlyStuck ? stuck : board.rows;
  const paging = usePage(rows);
  const { select } = useFloor();
  const count = (key: string, state: CellState) =>
    board.rows.filter((r) => r.cells[key]?.state === state).length;

  return (
    <div className="gridview">
      {/* The finding first: how many rows have no open lever, and a way to see only them. */}
      <div className={css.chips} role="group" aria-label="Which LPs">
        <button className={css.chip} aria-pressed={!onlyStuck} onClick={() => { setOnlyStuck(false); paging.setPage(0); }}>
          Every LP on the grid<b>{n(board.rows.length)}</b>
        </button>
        <button className={css.chip} aria-pressed={onlyStuck} disabled={stuck.length === 0} onClick={() => { setOnlyStuck(true); paging.setPage(0); }}>
          No open lever left<b>{n(stuck.length)}</b>
        </button>
      </div>
      <Pager {...paging} label={onlyStuck ? 'LPs with no open lever' : 'LPs, largest stake first'} quiet />
      <div className="scroller">
        <table className="list gridtable">
          <thead>
            <tr>
              <th style={{ width: 196 }}>LP</th>
              <th style={{ width: 118 }}>Status · ladder</th>
              <th style={{ width: 80 }}>At stake</th>
              {LEVERS.map((l) => (
                <th key={l.key} title={l.means}>{l.label}</th>
              ))}
              <th style={{ width: 96 }}>Open moves</th>
            </tr>
          </thead>
          <tbody>
            {paging.rows.map((r) => {
              const open = LEVERS.filter((l) => r.cells[l.key]?.state === 'open').length;
              return (
                <tr key={r.key} className={open === 0 ? 'stuck' : undefined}>
                  <td>
                    <button className="covname" onClick={() => select({ kind: 'item', key: r.key })}>
                      <b>{r.name}</b>
                      <span>{r.vehicleName} · {r.ownerName}</span>
                    </button>
                  </td>
                  <td title={`${standingWords(r)}${claimWords(r) ? `\n${claimWords(r)}` : ''}`}>
                    {STATUS_LABEL[r.status]}
                    {r.needsEvidence && <span className="gev" aria-label="needs evidence"> {EVIDENCE_GLYPH}</span>}
                    <div className="muted gsub">{rungShort(r)}</div>
                  </td>
                  <td className="mono right">{compactUsd(r.stake)}</td>
                  {LEVERS.map((l) => {
                    const cell = r.cells[l.key]!;
                    return (
                      <td key={l.key} className={`gcell s-${cell.state}`}
                          title={`${l.label} — ${CELL_LABEL[cell.state]}\n${cell.note}`}>
                        {/* A button, not a hover: on a tablet the reason has to open with a tap. */}
                        <button className={css.gbtn} aria-label={`${r.name}, ${l.label}: ${CELL_LABEL[cell.state]}`}
                                onClick={() => select({
                                  kind: 'note',
                                  title: `${r.name} · ${l.label}`,
                                  lines: [
                                    { label: 'Lever', value: l.means },
                                    { label: 'State', value: CELL_LABEL[cell.state] },
                                    { label: 'Why', value: cell.note },
                                  ],
                                })}>
                          {CELL_GLYPH[cell.state]}
                        </button>
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
              <td colSpan={3} className="muted">LPs with this lever open</td>
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
        <span className="gkey"><i>{EVIDENCE_GLYPH}</i> Needs evidence — the status claims more than the ladder shows</span>
      </div>
      <p className="cover">
        <b>A row with no open cell is the finding.</b> It is not an LP going badly — it is an
        LP we have run out of legal moves on, which is a different meeting with a different
        person. Blocked and not-yet are drawn apart for the same reason: one is a decision to
        revisit, the other is a rung to climb. Not-yet is read from the ladder, never from the
        status, and {EVIDENCE_GLYPH} marks a row whose status is ahead of it. Wired and passed
        LPs are not on the grid: nothing is left to pull on either.
      </p>
    </div>
  );
}
