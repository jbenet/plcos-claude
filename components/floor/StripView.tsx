'use client';

import { Fragment } from 'react';
import type { Strip, Track } from '@/lib/lenses-client';
import { TRACK_LABEL } from '@/lib/lenses-client';
import { useFloor } from './FloorContext';

/**
 * View 15 — the strip.
 *
 * A month of operations: the fortnight behind, today, the fortnight ahead, one lane per
 * vehicle and three tracks in each — what passed between us and them, what is due, and what
 * the agents last did.
 *
 * The three columns on the right are the reason this is not just a calendar. **Earlier** and
 * **later** hold what falls outside the window; *no date* holds the work that has no date at
 * all, which is the pile that never appears on a calendar and never gets chased, because
 * being undated is not the same as being late.
 */

const TRACKS: Track[] = ['exchange', 'due', 'run'];
const GLYPH: Record<Track, string> = { exchange: '○', due: '▢', run: '◇' };

export function StripView({ strip }: { strip: Strip }) {
  const { select } = useFloor();
  const cols = Array.from({ length: strip.days }, (_, i) => i - strip.back);
  const dayOf = (offset: number) => new Date(new Date(strip.asOf).getTime() + offset * 86_400_000);
  // UTC on both sides, or the server's Monday is the browser's Sunday and hydration fails.
  const letter = (d: Date) => ['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getUTCDay()]!;
  const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dateLabel = (d: Date) => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;

  return (
    <div className="floordark stripview">
      <div className="scroller">
        <table className="striptable">
          <thead>
            <tr className="stripzones">
              <th />
              <th colSpan={strip.back} className="zone past">RECORDED PAST</th>
              <th className="zone today">TODAY</th>
              <th colSpan={strip.days - strip.back - 1} className="zone next">PLANNED NEXT</th>
              <th colSpan={3} className="zone off">OUTSIDE THE WINDOW</th>
            </tr>
            <tr>
              <th className="striplane">Vehicle / activity</th>
              {cols.map((o) => {
                const d = dayOf(o);
                const weekend = isWeekend(d);
                return (
                  <th key={o} className={`stripday${o === 0 ? ' now' : ''}${weekend ? ' weekend' : ''}`}>
                    <span className="sdl">{letter(d)}</span>
                    <span className="sdn">{String(d.getUTCDate()).padStart(2, '0')}</span>
                  </th>
                );
              })}
              <th className="stripoff">Earlier</th>
              <th className="stripoff">No date</th>
              <th className="stripoff">Later</th>
            </tr>
          </thead>
          <tbody>
            {strip.lanes.map((lane) => (
              <Fragment key={lane.vehicleName}>
                <tr className="striphead">
                  <td colSpan={strip.days + 4}>
                    <b>{lane.vehicleName}</b>
                    <span>{lane.pursuits} pursuits · {lane.open} open</span>
                  </td>
                </tr>
                {TRACKS.map((track) => (
                  <tr key={`${lane.vehicleName}-${track}`}>
                    <td className="striplane">
                      <span className="sg" aria-hidden>{GLYPH[track]}</span> {TRACK_LABEL[track]}
                    </td>
                    {lane.tracks[track].map((cell) => {
                      const d = dayOf(cell.offset);
                      const weekend = isWeekend(d);
                      return (
                        <td
                          key={cell.offset}
                          className={`stripcell${cell.offset === 0 ? ' now' : ''}${weekend ? ' weekend' : ''}`}
                        >
                          {cell.count > 0 && (
                            <button
                              className={`stripmark t-${cell.tone}`}
                              title={`${dateLabel(d)}\n${cell.labels.join('\n')}`}
                              onClick={() => select({
                                kind: 'note',
                                title: `${lane.vehicleName} · ${TRACK_LABEL[track]}`,
                                lines: [
                                  { label: 'Day', value: dateLabel(d) },
                                  { label: 'Records', value: String(cell.count) },
                                  ...cell.labels.map((l, k) => ({ label: `#${k + 1}`, value: l })),
                                ],
                              })}
                            >
                              {cell.count}
                            </button>
                          )}
                        </td>
                      );
                    })}
                    <td className="stripoff">{lane.overflow[track].earlier || ''}</td>
                    <td className={`stripoff${lane.overflow[track].undated ? ' undated' : ''}`}>
                      {lane.overflow[track].undated || ''}
                    </td>
                    <td className="stripoff">{lane.overflow[track].later || ''}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="fllegend">
        <span>○ a dated exchange</span>
        <span>▢ work with a due date</span>
        <span>◇ the latest agent run update</span>
        <span>Amber = urgent · clay = blocked · the number is how many records that day carries</span>
      </div>
      <p className="cover dark">{strip.note}</p>
    </div>
  );
}
