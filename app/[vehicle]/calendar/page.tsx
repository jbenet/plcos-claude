import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { vehicleSelection } from '@/lib/session';
import { shortDate } from '@/lib/time';
import { timeline, LANE_LABEL, LANE_MEANS, type Lane, type Mark } from '@/lib/timeline';

export const dynamic = 'force-dynamic';

const LANES: Lane[] = ['close', 'spv', 'outreach', 'meetings', 'deadlines', 'grants', 'sprint'];

const WEEKS_BACK = 3;
const WEEKS_FORWARD = 13;

const MONDAY = (d: Date) => {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
};

export default async function Calendar({ params }: { params: Promise<{ vehicle: string }> }) {
  const { vehicle: slug } = await params;
  const { all } = await vehicleSelection();
  const vehicle = slug === 'all' ? null : all.find((v) => v.slug === slug);
  if (slug !== 'all' && !vehicle) notFound();

  const now = new Date('2026-09-20T00:00:00Z');
  const marks = await timeline(vehicle?.name ?? null, now);

  const start = MONDAY(now);
  start.setUTCDate(start.getUTCDate() - WEEKS_BACK * 7);
  const weeks = Array.from({ length: WEEKS_BACK + WEEKS_FORWARD }, (_, i) => {
    const s = new Date(start);
    s.setUTCDate(s.getUTCDate() + i * 7);
    const e = new Date(s);
    e.setUTCDate(e.getUTCDate() + 6);
    return { start: s, end: e, current: i === WEEKS_BACK };
  });
  const first = weeks[0]!.start.getTime();
  const last = weeks.at(-1)!.end.getTime();
  const span = last - first;

  const pct = (t: number) => Math.max(0, Math.min(100, ((t - first) / span) * 100));
  const inWindow = (m: Mark) => m.to.getTime() >= first && m.from.getTime() <= last;

  const visible = marks.filter(inWindow);
  const outside = marks.length - visible.length;
  /**
   * Greedy interval packing per lane.
   *
   * Two bars on one row overlap and their labels eat each other, which is how a gantt
   * chart stops being readable. Each mark takes the first sub-row that is free at its
   * start, where "free" allows for the label a short bar still has to carry.
   */
  const MIN_SPAN_DAYS = 11;
  const MIN_POINT_DAYS = 5;
  const packLane = (rows: Mark[]) => {
    const ends: number[] = [];
    const placed = rows.map((m) => {
      const startT = m.from.getTime();
      const pad = (m.kind === 'span' ? MIN_SPAN_DAYS : MIN_POINT_DAYS) * 86_400_000;
      const endT = Math.max(m.to.getTime(), startT) + pad;
      let row = ends.findIndex((e) => e <= startT);
      if (row === -1) {
        row = ends.length;
        ends.push(endT);
      } else {
        ends[row] = endT;
      }
      return { m, row };
    });
    return { placed, rows: Math.max(ends.length, 1) };
  };

  const byLane = LANES
    .map((lane) => {
      const rows = visible.filter((m) => m.lane === lane);
      const packed = packLane(rows);
      return { lane, rows, placed: packed.placed, rows_: packed.rows };
    })
    .filter((g) => g.rows.length > 0);

  /** Month boundaries, so twelve weeks of columns still read as a year. */
  const months: Array<{ label: string; left: number }> = [];
  for (const w of weeks) {
    const label = w.start.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
    if (months.length === 0 || months.at(-1)!.label !== label) {
      months.push({ label, left: pct(w.start.getTime()) });
    }
  }

  return (
    <Page
      crumbs={[
        { label: vehicle ? vehicle.name : SECTION.overview, href: vehicle ? '/overview' : undefined },
        { label: 'Calendar' },
      ]}
      inspector={
        <>
          <div className="lbl">What is on it</div>
          <div className="ihead">{visible.length} dated things</div>
          <div className="imeta">
            {vehicle ? vehicle.name : 'every vehicle'} · {WEEKS_BACK + WEEKS_FORWARD} weeks
          </div>
          {byLane.map((g) => (
            <div className="kv" key={g.lane}>
              <span>{LANE_LABEL[g.lane]}</span>
              <span>{g.rows.length}</span>
            </div>
          ))}

          <div className="scope">
            <div className="lbl">Projected, not kept</div>
            <p>
              Nothing on this calendar is stored here. Every bar is a dated row that already
              exists in the close room, the ask log, the approval queue or the compliance
              registry. A second copy of the plan is the copy that goes stale, so this one reads
              the originals and cannot disagree with them.
            </p>
          </div>

          <div className="note">
            The cost is that <b>anything nobody has dated does not appear</b>. An empty lane is a
            gap in the record, not an empty week.
          </div>
        </>
      }
    >
      <div className="lbl">
        Calendar · {vehicle ? vehicle.name : 'all vehicles'}
      </div>
      <h1>What is happening, and when</h1>
      <p className="sublede">
        {WEEKS_BACK} weeks back and {WEEKS_FORWARD} forward, compressed to one screen. Bars are
        spans, diamonds are deadlines, dots are things that happened on a day. Everything is read
        from the record that owns it — this page keeps nothing of its own.
      </p>

      {visible.length === 0 ? (
        <div className="card">
          <div className="cbody">
            <div className="empty">
              <span className="stat unavailable"><i />Nothing dated</span>
              <h3>Nothing in this window carries a date.</h3>
              <p>
                Which is a statement about the record rather than about the quarter. Close
                targets, conditions, asks, meetings and expiries all appear here the moment
                somebody puts a date on them.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="card gantt">
          <div className="chead">
            <h2>{vehicle ? vehicle.name : 'Across every vehicle'}</h2>
            <span className="lbl">
              week of {shortDate(weeks[0]!.start)} → {shortDate(weeks.at(-1)!.end)}
            </span>
          </div>

          <div className="gscroll">
            <div className="gmonths">
              {months.map((m) => (
                <span key={m.label + m.left} style={{ left: `${m.left}%` }}>{m.label}</span>
              ))}
            </div>
            <div className="gweeks">
              {weeks.map((w) => (
                <span
                  key={w.start.toISOString()}
                  className={w.current ? 'now' : ''}
                  style={{ left: `${pct(w.start.getTime())}%`, width: `${(7 * 86_400_000 / span) * 100}%` }}
                >
                  {w.start.getUTCDate()}
                </span>
              ))}
            </div>

            {byLane.map((g) => (
              <div className="glane" key={g.lane}>
                <div className="gname" title={LANE_MEANS[g.lane]}>{LANE_LABEL[g.lane]}</div>
                <div className="gtrack" style={{ minHeight: 14 + g.rows_ * 14 }}>
                  <span className="gnow" style={{ left: `${pct(now.getTime())}%` }} />
                  {g.placed.map(({ m, row }) => {
                    const left = pct(m.from.getTime());
                    const width = Math.max(
                      m.kind === 'span' ? ((m.to.getTime() - m.from.getTime()) / span) * 100 : 0,
                      0,
                    );
                    const cls = `gmark g-${m.kind}${m.alert ? ' alert' : ''}${m.past ? ' past' : ''}`;
                    const title = `${m.label}${m.vehicleName ? ` · ${m.vehicleName}` : ''} · ${shortDate(m.from)}${m.kind === 'span' ? ` → ${shortDate(m.to)}` : ''}\n${m.detail}`;
                    return (
                      <span
                        key={m.id}
                        className={cls}
                        style={{
                          left: `${left}%`,
                          width: m.kind === 'span' ? `${width}%` : undefined,
                          top: `${row * 14}px`,
                        }}
                        title={title}
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
            <b>The list below carries the same information.</b> It is not a fallback: a bar
            three pixels wide is unreadable and unreachable by keyboard, and half of what is on
            this chart is a single day. <b>Today</b> is the vertical line.
            {outside > 0 && <> {outside} dated thing{outside === 1 ? '' : 's'} sit outside this window and are in the list.</>}
          </p>
        </div>
      )}

      <div className="card">
        <div className="chead">
          <h2>Every dated thing, in order</h2>
          <span className="lbl">{marks.length} row{marks.length === 1 ? '' : 's'}</span>
        </div>
        <table className="list">
          <thead>
            <tr>
              <th style={{ width: 150 }}>When</th>
              <th style={{ width: 150 }}>Lane</th>
              <th>What</th>
              <th style={{ width: 150 }}>Vehicle</th>
              <th style={{ width: 110 }}>Standing</th>
            </tr>
          </thead>
          <tbody>
            {marks.map((m) => (
              <tr key={m.id}>
                <td className="mono" style={{ fontSize: 11 }}>
                  {shortDate(m.from)}
                  {m.kind === 'span' && m.to.getTime() !== m.from.getTime() && (
                    <div className="muted">→ {shortDate(m.to)}</div>
                  )}
                </td>
                <td className="muted">{LANE_LABEL[m.lane]}</td>
                <td>
                  {m.href ? <Link href={m.href}><b>{m.label}</b></Link> : <b>{m.label}</b>}
                  <div className="muted" style={{ fontSize: 11.5 }}>{m.detail}</div>
                </td>
                <td className="muted">{m.vehicleName ?? '—'}</td>
                <td>
                  {m.alert
                    ? <span className="flag f-block">Pressing</span>
                    : m.past
                      ? <span className="flag f-mute">Done</span>
                      : <span className="flag f-ev">Ahead</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="cover">
          <b>What this covers:</b> every record in this system that carries a date
          {vehicle ? ` and belongs to ${vehicle.name}` : ' across every vehicle'}. Work nobody has
          dated is absent — that is a gap in the record, and an empty lane should be read as
          &ldquo;nothing scheduled here&rdquo; rather than &ldquo;nothing happening here&rdquo;.
        </p>
      </div>
    </Page>
  );
}
