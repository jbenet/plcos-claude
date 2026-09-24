import { Glyph } from '@/components/ui/Glyph';
import { LANE_LOOK, type DatedRow, type Lane } from '@/lib/lanes';

/**
 * Before the list (issue 0020, real): how many dated things, by standing and by lane, and how
 * they fall month by month over the whole record — the density, stacked by lane in the lane's
 * colour, so its evolution is visible at a glance. The months' numbers are in the table under it:
 * the chart has a list equivalent, as every canvas here does.
 */
const MAX_MONTHS = 24;
const monthKey = (iso: string) => iso.slice(0, 7);
const monthName = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });

export function CalendarStats({ rows, now }: { rows: DatedRow[]; now: string }) {
  if (!rows.length) return null;
  const by = (s: DatedRow['standing']) => rows.filter((r) => r.standing === s).length;
  const lanes = (Object.keys(LANE_LOOK) as Lane[]).filter((l) => rows.some((r) => r.lane === l));

  // Every month from the first dated thing to the last, the latest MAX_MONTHS of them.
  const keys = rows.map((r) => monthKey(r.from)).sort();
  const first = keys[0]!, last = keys[keys.length - 1]! > monthKey(now) ? keys[keys.length - 1]! : monthKey(now);
  const months: string[] = [];
  for (let d = new Date(`${first}-01T00:00:00Z`); monthKey(d.toISOString()) <= last; d.setUTCMonth(d.getUTCMonth() + 1)) months.push(monthKey(d.toISOString()));
  const shown = months.slice(-MAX_MONTHS);
  const dropped = months.length - shown.length;
  const bins = shown.map((m) => ({ m, n: Object.fromEntries(lanes.map((l) => [l, rows.filter((r) => r.lane === l && monthKey(r.from) === m).length])) as Record<Lane, number> }));
  const peak = Math.max(1, ...bins.map((b) => lanes.reduce((a, l) => a + b.n[l], 0)));
  const nowKey = monthKey(now);

  return (
    <div className="card calstats">
      <div className="chead">
        <h2>By the numbers</h2>
        <span className="lbl">{rows.length} dated things · {shown.length} months</span>
      </div>
      <div className="cbody">
        <div className="calstat-tiles">
          <div><span className="lbl">Ahead</span><b>{by('ahead')}</b></div>
          <div><span className="lbl">Pressing</span><b>{by('pressing')}</b></div>
          <div><span className="lbl">Done</span><b>{by('done')}</b></div>
          {lanes.map((l) => (
            <div key={l} className={`lane-${l}`}>
              <span className="lbl"><Glyph name={LANE_LOOK[l].glyph} title={LANE_LOOK[l].label} /> {LANE_LOOK[l].label}</span>
              <b>{rows.filter((r) => r.lane === l).length}</b>
            </div>
          ))}
        </div>
        <div className="density" role="img" aria-label={`Dated things by month, ${monthName(shown[0]!)} ${shown[0]!.slice(0, 4)} to ${monthName(shown[shown.length - 1]!)} ${shown[shown.length - 1]!.slice(0, 4)}; the numbers are in the table below.`}>
          {bins.map((b) => {
            const total = lanes.reduce((a, l) => a + b.n[l], 0);
            return (
              <div key={b.m} className={`dcol${b.m === nowKey ? ' now' : ''}${b.m > nowKey ? ' ahead' : ''}`} title={`${monthName(b.m)} ${b.m.slice(0, 4)}: ${total} — ${lanes.filter((l) => b.n[l]).map((l) => `${LANE_LOOK[l].label} ${b.n[l]}`).join(', ') || 'nothing dated'}`}>
                <div className="dstack" style={{ height: `${(total / peak) * 100}%` }}>
                  {lanes.filter((l) => b.n[l]).map((l) => <i key={l} className={`lane-${l}`} style={{ flexGrow: b.n[l] }} />)}
                </div>
                <span className="dmon">{monthName(b.m)}{b.m.endsWith('-01') || b.m === shown[0] ? <em>{b.m.slice(2, 4)}</em> : null}</span>
              </div>
            );
          })}
        </div>
        <div className="dkey">
          {lanes.map((l) => <span key={l} className={`lane-${l}`}><i />{LANE_LOOK[l].label}</span>)}
          <span className="dnow">This month is outlined; months ahead are lighter.</span>
        </div>
        <details className="more">
          <summary>The numbers, by month</summary>
          <table className="list">
            <thead><tr><th>Month</th>{lanes.map((l) => <th key={l}>{LANE_LOOK[l].label}</th>)}<th>All</th></tr></thead>
            <tbody>
              {bins.filter((b) => lanes.some((l) => b.n[l])).map((b) => (
                <tr key={b.m}><td className="mono">{monthName(b.m)} {b.m.slice(0, 4)}</td>{lanes.map((l) => <td key={l}>{b.n[l] || '—'}</td>)}<td><b>{lanes.reduce((a, l) => a + b.n[l], 0)}</b></td></tr>
              ))}
            </tbody>
          </table>
        </details>
      </div>
      {dropped > 0 && <p className="cover">The first {dropped} months of the record are left off the chart to keep it readable; their rows are in the list.</p>}
    </div>
  );
}
