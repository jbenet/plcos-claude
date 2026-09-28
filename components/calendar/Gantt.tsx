import { shortDate, formatDate } from '@/lib/time';
import { LANE_LABEL, LANE_MEANS, type Lane, type Mark } from '@/lib/timeline';
import s from './Gantt.module.css';

/**
 * The calendar's drawing: sixteen weeks, one lane per kind of dated thing, bars for spans,
 * diamonds for deadlines, dots for things that happened on a day.
 *
 * Restored in issue 0066 from the version before the weekly count table, with one change for
 * volume: a lane packs its marks into at most MAX_ROWS rows, and whatever would need a row
 * beyond that is counted at the lane's name rather than drawn — so a busy month makes a lane
 * say "+40 more" instead of making the page a metre tall. The list under the chart carries
 * every record, and it is the equal presentation: a bar three pixels wide is unreadable and
 * unreachable by keyboard.
 */

/** Rows a lane may use before it counts instead of draws. A presentation limit. */
const MAX_ROWS = 6;
const MIN_SPAN_DAYS = 11;
const MIN_POINT_DAYS = 5;

export function Gantt({ marks, lanes, weeks, now }: {
  marks: Mark[];
  lanes: Lane[];
  weeks: Array<{ start: Date; end: Date; current: boolean }>;
  now: Date;
}) {
  const first = weeks[0]!.start.getTime();
  const last = weeks.at(-1)!.end.getTime();
  const span = last - first;
  const pct = (t: number) => Math.max(0, Math.min(100, ((t - first) / span) * 100));
  const visible = marks.filter((m) => m.to.getTime() >= first && m.from.getTime() <= last);
  const outside = marks.length - visible.length;

  /**
   * Greedy interval packing per lane. Two bars on one row overlap and their labels eat each
   * other, so each mark takes the first sub-row free at its start, where "free" allows for the
   * label a short bar still has to carry. Pressing marks go first, so a cap never hides them.
   */
  const packLane = (rows: Mark[]) => {
    const ends: number[] = [];
    const placed: Array<{ m: Mark; row: number }> = [];
    let hidden = 0;
    const ordered = [...rows].sort((a, b) => Number(b.alert) - Number(a.alert) || a.from.getTime() - b.from.getTime());
    for (const m of ordered) {
      const startT = m.from.getTime();
      const pad = (m.kind === 'span' ? MIN_SPAN_DAYS : MIN_POINT_DAYS) * 86_400_000;
      const endT = Math.max(m.to.getTime(), startT) + pad;
      let row = ends.findIndex((e) => e <= startT);
      if (row === -1 && ends.length < MAX_ROWS) { row = ends.length; ends.push(endT); }
      if (row === -1) { hidden += 1; continue; }
      ends[row] = endT;
      placed.push({ m, row });
    }
    return { placed, rows: Math.max(ends.length, 1), hidden };
  };

  const byLane = lanes
    .map((lane) => ({ lane, ...packLane(visible.filter((m) => m.lane === lane)) }))
    .filter((g) => g.placed.length + g.hidden > 0);

  /** Month boundaries, so sixteen weeks of columns still read as a season. */
  const months: Array<{ label: string; left: number }> = [];
  for (const w of weeks) {
    const label = formatDate(w.start, { month: 'short', timeZone: 'UTC' });
    if (months.length === 0 || months.at(-1)!.label !== label) months.push({ label, left: pct(w.start.getTime()) });
  }

  return (
    <>
      <div className="gscroll">
        <div className="gmonths">
          {months.map((m) => <span key={m.label + m.left} style={{ left: `${m.left}%` }}>{m.label}</span>)}
        </div>
        <div className="gweeks">
          {weeks.map((w) => (
            <span key={w.start.toISOString()} className={w.current ? 'now' : ''}
                  style={{ left: `${pct(w.start.getTime())}%`, width: `${(7 * 86_400_000 / span) * 100}%` }}>
              {w.start.getUTCDate()}
            </span>
          ))}
        </div>

        {byLane.map((g) => (
          <div className="glane" key={g.lane}>
            <div className="gname" title={LANE_MEANS[g.lane]}>
              {LANE_LABEL[g.lane]}
              {g.hidden > 0 && <span className={s.more}>+{g.hidden.toLocaleString('en-US')} more in the list</span>}
            </div>
            <div className="gtrack" style={{ minHeight: 14 + g.rows * 14 }}>
              <span className="gnow" style={{ left: `${pct(now.getTime())}%` }} />
              {g.placed.map(({ m, row }) => {
                const width = m.kind === 'span' ? Math.max(((m.to.getTime() - m.from.getTime()) / span) * 100, 0) : 0;
                return (
                  <span
                    key={m.id}
                    className={`gmark g-${m.kind}${m.alert ? ' alert' : ''}${m.past ? ' past' : ''}`}
                    style={{ left: `${pct(m.from.getTime())}%`, width: m.kind === 'span' ? `${width}%` : undefined, top: `${row * 14}px` }}
                    title={`${m.label}${m.vehicleName ? ` · ${m.vehicleName}` : ''} · ${shortDate(m.from)}${m.kind === 'span' ? ` → ${shortDate(m.to)}` : ''}\n${m.detail}`}
                  >
                    {m.kind === 'span' && <i>{m.label}</i>}
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="cover">
        <b>The list below carries the same information.</b> It is not a fallback: a bar three
        pixels wide is unreadable and unreachable by keyboard, and half of what is on this chart
        is a single day. <b>Today</b> is the vertical line. A lane draws at most {MAX_ROWS} rows,
        pressing things first, and counts the rest.
        {outside > 0 && <> {outside.toLocaleString('en-US')} dated thing{outside === 1 ? '' : 's'} sit outside this window and are in the list.</>}
      </p>
    </>
  );
}
