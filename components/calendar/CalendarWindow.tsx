'use client';

import { useState } from 'react';
import type { DatedRow } from '@/lib/lanes';
import { LANE_LOOK } from '@/lib/lanes';
import { Glyph } from '@/components/ui/Glyph';
import { PagedRows } from '@/components/floor/Paging';
import Link from '@/components/ui/AppLink';

const WEEK = 7 * 86_400_000;
const short = (stamp: number) => new Date(stamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });

/**
 * The window, as weekly counts per lane (issue 0066 kept: fixed bins, so a busy week is one number
 * rather than a pile of overlapping bars). A heat grid that fits the page: a darker cell is a
 * busier week, an empty week is a dot, this week is outlined. Select a count for its records.
 * Its styles come from the page (app/[vehicle]/calendar/window.module.css), so the component also
 * renders in plain Node, where the property checks draw it.
 */
export function CalendarWindow({ rows, first, weeks, now, look = {} }: {
  rows: DatedRow[]; first: string; weeks: number; now?: string; look?: Record<string, string>;
}) {
  const s = new Proxy(look, { get: (o, k: string) => o[k] ?? '' });
  const [chosen, setChosen] = useState<{ lane: DatedRow['lane']; week: number } | null>(null);
  const start = new Date(first).getTime();
  const today = now ? new Date(now).getTime() : Date.now();
  const bins = Array.from({ length: weeks }, (_, i) => ({ start: start + i * WEEK, end: start + (i + 1) * WEEK }));
  const lanes = [...new Set(rows.map((r) => r.lane))];
  const overlaps = (r: DatedRow, week: number) => new Date(r.from).getTime() < bins[week]!.end && new Date(r.to ?? r.from).getTime() >= bins[week]!.start;
  const counts = lanes.map((lane) => bins.map((_, week) => rows.filter((r) => r.lane === lane && overlaps(r, week)).length));
  const peak = Math.max(1, ...counts.flat());
  const selected = chosen ? rows.filter((r) => r.lane === chosen.lane && overlaps(r, chosen.week)) : [];
  const current = bins.findIndex((b) => today >= b.start && today < b.end);

  return (
    <div className={s.wrap}>
      <div className={s.scroll}>
        <table className={s.grid}>
          <caption className="sr-only">Dated records touching each week, by lane (weeks begin Monday, UTC)</caption>
          <thead>
            <tr>
              <th scope="col" className={s.laneHead}>Week of</th>
              {bins.map((b, i) => {
                const d = new Date(b.start);
                const newMonth = i === 0 || new Date(bins[i - 1]!.start).getUTCMonth() !== d.getUTCMonth();
                return (
                  <th scope="col" key={b.start} className={i === current ? s.now : undefined} title={`Week of ${short(b.start)}`}>
                    <span className={s.mon}>{newMonth ? d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' }) : ''}</span>
                    <span className={s.day}>{d.getUTCDate()}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {lanes.map((lane, li) => (
              <tr key={lane} className={`lane-${lane}`}>
                <th scope="row" className={s.laneName}><Glyph name={LANE_LOOK[lane].glyph} title={LANE_LOOK[lane].label} /> {LANE_LOOK[lane].label}</th>
                {bins.map((_, week) => {
                  const n = counts[li]![week]!;
                  const on = chosen?.lane === lane && chosen.week === week;
                  return (
                    <td key={week} className={week === current ? s.now : undefined}>
                      <button
                        type="button"
                        className={`${s.cell}${n ? (n / peak > 0.6 ? ` ${s.dark}` : '') : ` ${s.zero}`}`}
                        style={n ? { ['--a' as string]: String(0.18 + 0.72 * (n / peak)) } : undefined}
                        aria-pressed={on}
                        disabled={!n}
                        aria-label={`${LANE_LOOK[lane].label}, week of ${short(bins[week]!.start)}: ${n}`}
                        onClick={() => setChosen(on ? null : { lane, week })}
                      >
                        {n || '·'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={s.legend}>A darker cell is a busier week; this week is outlined. A span counts in every week it touches, so a column is not a count of distinct records. Select a number for its records.</p>
      {chosen && (
        <section className={s.detail}>
          <div className={s.detailHead}>
            <b>{LANE_LOOK[chosen.lane].label} · week of {short(bins[chosen.week]!.start)}</b>
            <button type="button" className="btn" onClick={() => setChosen(null)}>Close</button>
          </div>
          <PagedRows key={`${chosen.lane}:${chosen.week}`} rows={selected} size={10} label="dated records in this week">
            {(page) => (
              <ul className={s.detailList}>
                {page.map((r) => (
                  <li key={r.id}>
                    <span className="mono muted">{r.from.slice(0, 10)}{r.to ? ` → ${r.to.slice(0, 10)}` : ''}</span>
                    {r.href ? <Link href={r.href}>{r.label}</Link> : <span>{r.label}</span>}
                    {r.detail && <small>{r.detail}</small>}
                  </li>
                ))}
              </ul>
            )}
          </PagedRows>
        </section>
      )}
    </div>
  );
}
