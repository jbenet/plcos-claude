'use client';

import { useState } from 'react';
import type { DatedRow } from '@/lib/lanes';
import { LANE_LOOK } from '@/lib/lanes';
import { PagedRows } from '@/components/floor/Paging';
import Link from '@/components/ui/AppLink';

const WEEK = 7 * 86_400_000;
/** Fixed weekly bins replace interval packing whose height grew with concurrent records. */
export function CalendarWindow({ rows, first, weeks }: { rows: DatedRow[]; first: string; weeks: number }) {
  const [chosen, setChosen] = useState<{ lane: DatedRow['lane']; week: number } | null>(null);
  const start = new Date(first).getTime();
  const bins = Array.from({ length: weeks }, (_, i) => ({ start: start + i * WEEK, end: start + (i + 1) * WEEK }));
  const lanes = [...new Set(rows.map(r => r.lane))];
  const overlaps = (r: DatedRow, week: number) => new Date(r.from).getTime() < bins[week]!.end && new Date(r.to ?? r.from).getTime() >= bins[week]!.start;
  const selected = chosen ? rows.filter(r => r.lane === chosen.lane && overlaps(r, chosen.week)) : [];
  const date = (stamp: number) => new Date(stamp).toISOString().slice(0, 10);
  return <div className="vizsummary">
    <p>Counts of dated records touching each week. A span can appear in several weeks, so columns must not be added as distinct records. Select a count to inspect every record in that bin.</p>
    <div className="scroller"><table className="list vizmatrix"><caption>Activity by week beginning (UTC)</caption><thead><tr><th>Activity</th>{bins.map(b => <th key={b.start}>{date(b.start)}</th>)}</tr></thead><tbody>{lanes.map(lane => <tr key={lane}><th>{LANE_LOOK[lane].label}</th>{bins.map((_, week) => {
      const count = rows.filter(r => r.lane === lane && overlaps(r, week)).length;
      return <td key={week}><button className="vizcell" aria-pressed={chosen?.lane === lane && chosen.week === week} disabled={!count} onClick={() => setChosen({ lane, week })}>{count}</button></td>;
    })}</tr>)}</tbody></table></div>
    {chosen && <section><h3>{LANE_LOOK[chosen.lane].label} · week of {date(bins[chosen.week]!.start)}</h3><button className="btn" onClick={() => setChosen(null)}>Close weekly detail</button>
      <PagedRows key={`${chosen.lane}:${chosen.week}`} rows={selected} size={10} label="dated records in this week">{page => <table className="list"><thead><tr><th>Record</th><th>Date / span</th><th>Vehicle</th><th>Standing / detail</th></tr></thead><tbody>{page.map(r => <tr key={r.id}><td>{r.href ? <Link href={r.href}>{r.label}</Link> : r.label}</td><td>{r.from.slice(0, 10)}{r.to ? ` → ${r.to.slice(0, 10)}` : ''}</td><td>{r.vehicle ?? 'Across vehicles'}</td><td>{r.standing} · {r.detail}</td></tr>)}</tbody></table>}</PagedRows>
    </section>}
    <p className="cover">These counts are also a keyboard-accessible table. Every dated record, including those outside this window, is in the filtered list below.</p>
  </div>;
}
