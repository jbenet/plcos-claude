'use client';

import { Fragment } from 'react';
import type { FloorState } from '@/lib/floor-client';
import type { Strip, Track } from '@/lib/lenses-client';
import { TRACK_LABEL } from '@/lib/lenses-client';
import { useFloor } from './FloorContext';
import { PagedRows } from './Paging';
import { byAttention, n, tally } from './scale';
import { compactUsd, shortName, standingWords } from './shared';
import s from './floor.module.css';

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
 *
 * Since issue 0066 the strip also carries the clock's pile. The clock drew three weeks forward
 * per owner, which the strip's "planned next" half already draws per vehicle, and at the
 * volume the raise has now its timeline was nearly empty while its pile held almost every
 * pursuit. So the clock was retired, and its one unique answer — how much work has no date on
 * it, whose it is, and which of it is largest — sits under the strip, counted rather than
 * listed.
 */

const TRACKS: Track[] = ['exchange', 'due', 'run'];
const GLYPH: Record<Track, string> = { exchange: '○', due: '▢', run: '◇' };
/** Owners named in the pile before the rest are summed into one line. */
const PILE_OWNERS = 6;

export function StripView({ strip, floor }: { strip: Strip; floor: FloorState }) {
  const { select } = useFloor();
  // A passed LP is not unscheduled work: someone decided (docs/17). Nor is money already wired.
  const undated = floor.items.filter((i) => !i.urgentAt && !i.cashReceived && i.status !== 'passed').sort(byAttention);
  const owners = tally(undated, (i) => i.ownerName);
  const namedOwners = owners.slice(0, owners.length > PILE_OWNERS ? PILE_OWNERS - 1 : PILE_OWNERS);
  const otherOwners = owners.slice(namedOwners.length);
  const topOwner = Math.max(1, ...owners.map((o) => o.count));
  const open = floor.items.filter((i) => !i.cashReceived && i.status !== 'passed').length;
  const cols = Array.from({ length: strip.days }, (_, i) => i - strip.back);
  const dayOf = (offset: number) => new Date(new Date(strip.asOf).getTime() + offset * 86_400_000);
  // UTC on both sides, or the server's Monday is the browser's Sunday and hydration fails.
  const letter = (d: Date) => ['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getUTCDay()]!;
  const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dateLabel = (d: Date) => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;

  return (
    <div className={`floordark stripview ${s.strip}`}>
      <div className="scroller">
        <table className="striptable">
          <thead>
            <tr className="stripzones">
              <th />
              <th colSpan={strip.back} className="zone past">RECORDED PAST</th>
              <th className="zone today">TODAY</th>
              <th colSpan={strip.days - strip.back - 1} className="zone next">PLANNED NEXT</th>
              <th colSpan={3} className="zone off" title="Outside the window">OUTSIDE</th>
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
                    <span>{n(lane.pursuits)} pursuits · {n(lane.open)} open</span>
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
                                  { label: 'Preview', value: `Showing ${cell.labels.length} example labels of ${cell.count} records. Open the vehicle calendar for dated activity and Agents for run history.` },
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

      {/* The clock's pile (retired in issue 0066): the work with no date at all. */}
      <section className={`${s.pile} ${s.dark}`} aria-label="Open work with no date on it">
        <div className={s.pilehead}>
          <div className="lbl">No date on it</div>
          <div className={s.pilen}>{n(undated.length)}<span> of {n(open)} open</span></div>
          <p>
            Work with nothing scheduled against it. Not late — <b>unscheduled</b>, which is the
            state nobody notices. A meeting, a follow-up or an ask due date takes a pursuit out of
            this pile.
          </p>
        </div>
        <div>
          <div className="lbl">Whose it is</div>
          <div className={s.bars}>
            {namedOwners.map((o) => (
              <button key={o.key} className={s.bar} onClick={() => select({ kind: 'person', name: o.key })}
                      title={`${o.key}: ${n(o.count)} open pursuits with no date. Opens their load.`}>
                <span className={s.barname}>{o.key}</span>
                <span className={s.bartrack} aria-hidden><i style={{ width: `${(o.count / topOwner) * 100}%` }} /></span>
                <span className={s.barn}>{n(o.count)}</span>
              </button>
            ))}
            {otherOwners.length > 0 && (
              <div className={s.bar}>
                <span className={s.barname}>{otherOwners.length} others</span>
                <span className={s.bartrack} aria-hidden><i style={{ width: `${(otherOwners.reduce((t, o) => t + o.count, 0) / topOwner) * 100}%` }} /></span>
                <span className={s.barn}>{n(otherOwners.reduce((t, o) => t + o.count, 0))}</span>
              </div>
            )}
            {undated.length === 0 && <p className="csmall">Every open pursuit has a date on it.</p>}
          </div>
        </div>
        <div>
          <div className="lbl">Largest first, blocked and dated-soon ahead of them</div>
          <PagedRows rows={undated} size={6} label="undated" quiet>{(page) => (
            <div className={s.pilelist}>
              {page.map((i) => (
                <button key={i.key} className={s.pilerow} onClick={() => select({ kind: 'item', key: i.key })}
                        title={`${standingWords(i)}\n${i.tempBasis}${i.blocked ? `\nBlocked: ${i.blocked}` : ''}`}>
                  <span className={`cpdot t-${i.temp}`} />
                  <span className={s.pilename}>{shortName(i.entityName, 26)}</span>
                  <span className={s.pilev}>{compactUsd(i.amount)}</span>
                  <span className={s.pilev}>{i.daysSinceMove === null ? 'never' : `${i.daysSinceMove}d`}</span>
                </button>
              ))}
            </div>
          )}</PagedRows>
        </div>
      </section>

      <p className="cover dark">{strip.note} Each cell previews at most six labels. <a href="/all/calendar">Open calendar records</a> · <a href="/agents">Open agent runs</a>.</p>
    </div>
  );
}
