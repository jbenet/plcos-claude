'use client';

import type { CellMark, Coverage } from '@/lib/lenses-client';
import { COVERAGE_FIELDS } from '@/lib/lenses-client';
import { useFloor } from './FloorContext';
import { compactUsd } from './shared';

/**
 * View 13 — the coverage.
 *
 * Six kinds of recorded context, one row per pursuit, **least recorded first**. It is the
 * only view that draws what is *not* there, and it exists because every other view on this
 * page looks equally confident about a pursuit with six records and one with two.
 *
 * It is not a score. A recorded field can be wrong, and a missing one can be perfectly
 * legitimate — a target nobody has met yet should have no exchange. What a missing field
 * must never be is invisible, because that is how a brief ends up stating something nobody
 * ever checked.
 */

const MARK_GLYPH: Record<CellMark, string> = {
  recorded: '●', unconfirmed: '◐', restricted: '!', missing: '–',
};
const MARK_LABEL: Record<CellMark, string> = {
  recorded: 'Recorded',
  unconfirmed: 'Recorded but unconfirmed',
  restricted: 'A restriction is on file',
  missing: 'Not recorded',
};

export function CoverageView({ coverage }: { coverage: Coverage }) {
  const { select } = useFloor();
  const vehicles = [...new Set(coverage.rows.map((r) => r.vehicleName))];

  return (
    <div className="covview">
      <div className="covtotals">
        {COVERAGE_FIELDS.map((f) => {
          const t = coverage.totals.find((x) => x.key === f.key)!;
          const pct = t.of === 0 ? 0 : Math.round((t.recorded / t.of) * 100);
          return (
            <div className="covtot" key={f.key} title={f.means}>
              <div className="lbl">{f.label}</div>
              <div className="covn">
                <b>{t.recorded}</b><span>/{t.of}</span>
              </div>
              <div className="covbar"><i style={{ width: `${pct}%` }} /></div>
              <div className="covmiss">{t.of - t.recorded} not recorded</div>
            </div>
          );
        })}
      </div>

      <div className="covgrid">
        {vehicles.map((v) => {
          const rows = coverage.rows.filter((r) => r.vehicleName === v);
          return (
            <div className="covcard" key={v}>
              <div className="covch">
                <b>{v}</b>
                <span className="lbl">{rows.length} pursuits</span>
              </div>
              <table className="covtable">
                <thead>
                  <tr>
                    <th>Target / owner</th>
                    {COVERAGE_FIELDS.map((f) => (
                      <th key={f.key} title={f.means}>{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td>
                        <button className="covname" onClick={() => select({ kind: 'item', key: r.key })}>
                          <b>{r.name}</b>
                          <span>{r.ownerName} · {compactUsd(r.amount)}</span>
                        </button>
                      </td>
                      {COVERAGE_FIELDS.map((f) => {
                        const cell = r.cells[f.key]!;
                        return (
                          <td key={f.key} className="covcelltd">
                            <button
                              className={`covcell m-${cell.mark}`}
                              title={`${f.label} — ${MARK_LABEL[cell.mark]}\n${cell.note}`}
                              aria-label={`${f.label}: ${MARK_LABEL[cell.mark]}`}
                              onClick={() => select({
                                kind: 'note',
                                title: `${r.name} · ${f.label}`,
                                lines: [
                                  { label: 'State', value: MARK_LABEL[cell.mark] },
                                  { label: 'Basis', value: cell.note },
                                  { label: 'What it means', value: f.means },
                                ],
                              })}
                            >
                              {MARK_GLYPH[cell.mark]}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      <div className="fllegend light">
        <span><i className="cg m-recorded">●</i> recorded</span>
        <span><i className="cg m-unconfirmed">◐</i> unconfirmed</span>
        <span><i className="cg m-restricted">!</i> restriction on file</span>
        <span><i className="cg m-missing">–</i> not recorded</span>
        <span>Least recorded first · presence, never quality</span>
      </div>
      <p className="cover">{coverage.note}</p>
    </div>
  );
}
