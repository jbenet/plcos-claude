'use client';

import { useState } from 'react';
import { Pager, usePage } from './Paging';
import { n, tally } from './scale';
import css from './floor.module.css';

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
  recorded: '●', unconfirmed: '◐', restricted: '!', missing: '–', unknown: '?',
};
const MARK_LABEL: Record<CellMark, string> = {
  recorded: 'Recorded',
  unconfirmed: 'Recorded but unconfirmed',
  restricted: 'A restriction is on file',
  missing: 'Not recorded',
  unknown: 'Not inspected',
};

/** Patterns named before the rarer ones are summed into one row. A presentation limit. */
const PATTERNS = 8;

export function CoverageView({ coverage }: { coverage: Coverage }) {
  const [pattern, setPattern] = useState<string | null>(null);
  const patternOf = (r: Coverage['rows'][number]) => COVERAGE_FIELDS.map((f) => r.cells[f.key]?.mark ?? 'unknown').join('|');
  // At volume (issue 0066) two thousand rows of six marks is a wall; most rows share one of a
  // handful of shapes. Counting the shapes answers "where are we blind" in eight lines, and
  // choosing one lists exactly those pursuits below.
  const patterns = tally(coverage.rows, patternOf);
  const namedPatterns = patterns.slice(0, patterns.length > PATTERNS ? PATTERNS - 1 : PATTERNS);
  const rarer = patterns.slice(namedPatterns.length);
  const rarerKeys = new Set(rarer.map((p) => p.key));
  const patternMax = Math.max(1, ...patterns.map((p) => p.count));
  const shown = pattern === null ? coverage.rows
    : pattern === 'rarer' ? coverage.rows.filter((r) => rarerKeys.has(patternOf(r)))
    : coverage.rows.filter((r) => patternOf(r) === pattern);
  const paging = usePage(shown);
  const { select } = useFloor();
  const vehicles = [...new Set(paging.rows.map((r) => r.vehicleName))];
  const choose = (next: string | null) => { setPattern(pattern === next ? null : next); paging.setPage(0); };

  return (
    <div className={`covview ${css.cov}`}>
      <div className="covtotals">
        {COVERAGE_FIELDS.map((f) => {
          // A field nobody has totalled is not inspected: it reads as none of any, never as a crash.
          const t = coverage.totals.find((x) => x.key === f.key) ?? { key: f.key, recorded: 0, of: coverage.rows.length };
          const pct = t.of === 0 ? 0 : Math.round((t.recorded / t.of) * 100);
          return (
            <div className="covtot" key={f.key} title={f.means}>
              <div className="lbl">{f.label}</div>
              <div className="covn">
                <b>{n(t.recorded)}</b><span>/{n(t.of)}</span>
              </div>
              <div className="covbar"><i style={{ width: `${pct}%` }} /></div>
              <div className="covmiss">{n(t.of - t.recorded)} not established</div>
            </div>
          );
        })}
      </div>

      {patterns.length > 1 && (
        <section className={css.patterns} aria-label="What is on file, by pattern">
          <div className={css.listhead}>
            <h3>What is on file, by pattern</h3>
            <span>Pursuits that share the same six marks, commonest first. Choose one to list them.</span>
          </div>
          <div className={css.pathead} aria-hidden>
            {COVERAGE_FIELDS.map((f) => <span key={f.key} title={f.means}>{f.label}</span>)}
            <span />
          </div>
          {namedPatterns.map((p) => {
            const marks = p.key.split('|') as CellMark[];
            return (
              <button key={p.key} className={css.patrow} aria-pressed={pattern === p.key} onClick={() => choose(p.key)}
                      aria-label={`${p.count} pursuits: ${COVERAGE_FIELDS.map((f, i) => `${f.label} ${MARK_LABEL[marks[i]!].toLowerCase()}`).join(', ')}`}>
                {marks.map((m, i) => <span key={i} className={`covcell m-${m} ${css.patcell}`}>{MARK_GLYPH[m]}</span>)}
                <span className={css.bartrack} aria-hidden><i style={{ width: `${(p.count / patternMax) * 100}%` }} /></span>
                <span className={css.barn}>{n(p.count)}</span>
              </button>
            );
          })}
          {rarer.length > 0 && (
            <button className={css.patrow} aria-pressed={pattern === 'rarer'} onClick={() => choose('rarer')}>
              <span className={css.patrare}>{rarer.length} rarer patterns</span>
              <span className={css.bartrack} aria-hidden><i style={{ width: `${(rarer.reduce((t, p) => t + p.count, 0) / patternMax) * 100}%` }} /></span>
              <span className={css.barn}>{n(rarer.reduce((t, p) => t + p.count, 0))}</span>
            </button>
          )}
        </section>
      )}

      <Pager {...paging} label={pattern === null ? 'pursuits, least recorded first' : 'pursuits with this pattern'} quiet /><div className="covgrid">
        {vehicles.map((v) => {
          const rows = paging.rows.filter((r) => r.vehicleName === v);
          return (
            <div className="covcard" key={v}>
              <div className="covch">
                <b>{v}</b>
                <span className="lbl">{n(rows.length)} on this page</span>
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
                        const cell = r.cells[f.key] ?? { mark: 'unknown' as const, note: 'Not inspected.' };
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
        <span><i className="cg m-unknown">?</i> not inspected</span>
        <span>Least recorded first · presence, never quality</span>
      </div>
      <p className="cover">{coverage.note}</p>
    </div>
  );
}
