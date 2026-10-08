import { coalescePage } from '@/lib/page-render';
import { notFound } from 'next/navigation';
import { Page } from '@/components/shell/Page';
import { SECTION } from '@/lib/nav';
import { vehicleSelection } from '@/lib/session';
import { shortDate } from '@/lib/time';
import { timeline, LANE_LABEL, type Lane } from '@/lib/timeline';
import type { DatedRow } from '@/lib/lanes';
import { DatedList } from '@/components/calendar/DatedList';
import { CalendarWindow } from '@/components/calendar/CalendarWindow';
import { CalendarStats } from '@/components/calendar/CalendarStats';
import windowLook from './window.module.css';

export const dynamic = 'force-dynamic';

const LANES: Lane[] = ['close', 'spv', 'outreach', 'meetings', 'deadlines', 'grants', 'travel', 'events', 'sprint'];
/** GUESS: the Travel and Events lanes read a quarter back and half a year ahead; the chart shows 16 weeks of it. */
const FEED_DAYS = { back: 90, forward: 183 };

const WEEKS_BACK = 3;
const WEEKS_FORWARD = 13;

const MONDAY = (d: Date) => {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
  return x;
};

async function Calendar({ params }: { params: Promise<{ vehicle: string }> }) {
  const { vehicle: slug } = await params;
  const { all } = await vehicleSelection();
  const vehicle = slug === 'all' ? null : all.find((v) => v.slug === slug);
  if (slug !== 'all' && !vehicle) notFound();

  const now = new Date();
  // Travel and Events (issue 0021): the team's calendars, on the all-vehicles calendar only — a trip is nobody's raise.
  const feeds = vehicle ? null : await (await import('@/lib/calendar-feeds')).feedMarks(now, {
    from: new Date(now.getTime() - FEED_DAYS.back * 86_400_000), to: new Date(now.getTime() + FEED_DAYS.forward * 86_400_000),
  });
  const marks = [...await timeline(vehicle?.name ?? null, now), ...(feeds?.marks ?? [])].sort((a, b) => a.from.getTime() - b.from.getTime());
  // The list and the numbers read the same rows (issue 0020). A detail that only repeats the
  // standing ("Held.", "Scheduled…") isn't printed: the standing column says it.
  const REPEATS_STANDING = /^(Held\.$|Held; counted for this raise|Scheduled\. An intention, not a fact\.$)/;
  const rows: DatedRow[] = marks.map((m) => ({
    id: m.id, lane: m.lane, label: m.label, team: m.team, lp: m.lp,
    detail: m.detail && !REPEATS_STANDING.test(m.detail) ? m.detail : null,
    from: m.from.toISOString(),
    to: m.kind === 'span' && m.to.getTime() !== m.from.getTime() ? m.to.toISOString() : null,
    vehicle: m.vehicleName, standing: m.alert ? 'pressing' : m.past ? 'done' : 'ahead', href: m.href,
  }));
  const vehicleNames = [...new Set(marks.map((m) => m.vehicleName).filter((v): v is string => Boolean(v)))].sort();

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
  const visible = marks.filter(m => m.to.getTime() >= first && m.from.getTime() <= last);
  const byLane = LANES.map(lane => ({ lane, rows: visible.filter(m => m.lane === lane) })).filter(g => g.rows.length);

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
              Nothing on this calendar is stored here. Every count comes from dated rows that already
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
      {feeds && feeds.feeds === 0 && (
        <p className="note" style={{ marginTop: 6 }}>
          <b>Travel and Events</b> come from the team’s own calendars: paste calendar addresses in{' '}
          <a href="/settings?section=email#calendars">Preferences</a>. Read only; nothing is written back.
        </p>
      )}
      {feeds && feeds.problems.length > 0 && (
        <p className="note" style={{ marginTop: 6, color: 'var(--amber)' }}>
          {feeds.problems.map((p) => `${p.person}’s ${p.lane} calendar: ${p.why}`).join(' ')}
        </p>
      )}
      <p className="sublede">
        {WEEKS_BACK} weeks back and {WEEKS_FORWARD} forward as weekly counts, then every dated thing, newest first,
        with who on our team and which LP. Everything is read from the record that owns it — this page keeps
        nothing of its own.
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

          <CalendarWindow rows={rows} first={weeks[0]!.start.toISOString()} weeks={weeks.length} now={now.toISOString()} look={windowLook} />

        </div>
      )}

      <CalendarStats rows={rows} now={now.toISOString()} />

      <div className="card">
        <div className="chead">
          <h2>Every dated thing, in order</h2>
          <span className="lbl">search, lanes and standing filter as you type</span>
        </div>
        <DatedList rows={rows} vehicles={vehicleNames} />
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

export default coalescePage('/[vehicle]/calendar', Calendar);
