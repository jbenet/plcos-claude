import { Info } from '@/components/ui/Info';
import { formatDate } from '@/lib/time';
import { usdCompact } from '@/lib/money';
import {
  MIN_FOR_RATE, STEP_LABEL, STEP_MEANS,
  type Cohort, type FunnelStep, type MoneyPoint, type SegmentPanel, type Waiting, type Week,
} from '@/lib/conversion/model';
import s from './conversion.module.css';

/**
 * The charts of outreach conversion (docs/33). Drawn on the server as SVG and plain HTML: no chart library, a
 * native tooltip on every mark, and each chart's numbers also written out beside or under it (the frontend
 * contract: every canvas has a list equivalent).
 */

const day = (d: Date) => formatDate(d, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const pc = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
const days = (x: number | null) => (x === null ? '—' : x < 1 ? 'same day' : `${Math.round(x)} d`);

export function FunnelChart({ steps }: { steps: FunnelStep[] }) {
  const max = Math.max(1, steps[0]?.n ?? 0, ...steps.map((x) => x.n));
  return (
    <div className={s.funnel} role="table" aria-label="Funnel">
      <div className={s.frow} role="row">
        <span role="columnheader" className="lbl">Step</span>
        <span role="columnheader" className="lbl">LPs</span>
        <span role="columnheader" className="lbl">Went on</span>
        <span role="columnheader" className="lbl">Median wait</span>
      </div>
      {steps.map((x) => (
        <div key={x.step} className={s.frow} role="row">
          <span role="cell" className={s.fname}>{STEP_LABEL[x.step]} <Info label={`What ${STEP_LABEL[x.step]} means`}>{STEP_MEANS[x.step]}</Info></span>
          <span role="cell" className={s.fbarCell}>
            <span className={s.fbar} style={{ width: `${(x.n / max) * 100}%` }}
              title={`${x.n} LPs ${STEP_LABEL[x.step].toLowerCase()}${x.inferred ? `, ${x.inferred} dated by a status change or a later step` : ''}`} />
            <b>{x.n.toLocaleString('en-US')}</b>
            {x.inferred > 0 && <span className={`${s.muted} ${s.wide}`}> · {x.inferred} from status</span>}
          </span>
          <span role="cell">{x.fromPrev === null ? '' : pc(x.fromPrev)}{x.passed > 0 && <span className={s.muted}> · {x.passed} passed here</span>}</span>
          <span role="cell">{x.step === 'reached' ? '' : days(x.medianDays)}</span>
        </div>
      ))}
    </div>
  );
}

/** A share as a shaded cell: darker is higher. Text carries the number, so colour is never the only signal. */
function Share({ k, n, young }: { k: number; n: number; young: boolean }) {
  if (!n) return <td className={s.muted}>—</td>;
  const r = k / n;
  return (
    <td className={s.share} style={{ ['--r' as string]: String(r) }} title={`${k} of ${n}${young ? ', still young' : ''}`}>
      {Math.round(r * 100)}% <span className={s.muted}>{k}</span>
    </td>
  );
}

export function CohortTable({ cohorts }: { cohorts: Cohort[] }) {
  return (
    <table className={`list ${s.cohorts}`}>
      <thead>
        <tr><th>Week first reached</th><th className="right">LPs</th><th>Replied</th><th>Met</th><th>Committed</th><th>Passed</th></tr>
      </thead>
      <tbody>
        {[...cohorts].reverse().map((c) => {
          const young = c.ageDays < 14;
          return (
            <tr key={c.week.toISOString()}>
              <td>{day(c.week)}{young && <span className={s.young} title="Under two weeks old: its LPs have had little time to answer"> young</span>}</td>
              <td className="right">{c.n || <span className={s.muted}>0</span>}</td>
              <Share k={c.replied} n={c.n} young={young} />
              <Share k={c.met} n={c.n} young={young} />
              <Share k={c.committed} n={c.n} young={young} />
              <Share k={c.passed} n={c.n} young={young} />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function SegmentCard({ panel }: { panel: SegmentPanel }) {
  const shown = panel.segments.slice(0, 8);
  const rest = panel.segments.slice(8);
  return (
    <div className={s.panel}>
      <div className={s.phead}><b>{panel.title}</b><span className="lbl">reply rate · n</span></div>
      {shown.map((g) => (
        <div key={g.value} className={s.seg}>
          <span className={s.slabel} title={g.label}>{g.label}</span>
          <span className={g.rate === null ? s.notrack : s.track} aria-hidden>
            {g.ci && <span className={s.ci} style={{ left: `${g.ci.lo * 100}%`, width: `${(g.ci.hi - g.ci.lo) * 100}%` }} />}
            {g.rate !== null && <span className={s.dot} style={{ left: `${g.rate * 100}%` }}
              title={`${g.replied} of ${g.n} replied (${pc(g.rate)}), likely between ${pc(g.ci?.lo ?? null)} and ${pc(g.ci?.hi ?? null)}; ${g.met} met (${pc(g.metRate)})`} />}
          </span>
          <span className={s.srate}>
            {g.rate === null ? <span className={s.muted} title={`Fewer than ${MIN_FOR_RATE} LPs: a rate would be noise`}>{g.replied}/{g.n}</span>
              : <>{pc(g.rate)} <span className={s.muted}>{g.n}</span></>}
          </span>
        </div>
      ))}
      {rest.length > 0 && <div className={s.more}>{rest.length} more, {rest.reduce((t, g) => t + g.n, 0)} LPs</div>}
    </div>
  );
}

export function WaitingCard({ title, bins, href, empty }: { title: string; bins: Waiting[]; href: (id: string) => string; empty: string }) {
  const total = bins.reduce((t, b) => t + b.rows.length, 0);
  const max = Math.max(1, ...bins.map((b) => b.rows.length));
  return (
    <div className={s.panel}>
      <div className={s.phead}><b>{title}</b><span className="lbl">{total} LPs</span></div>
      {total === 0 ? <p className={s.muted}>{empty}</p> : bins.map((b) => (
        <details key={b.key} className={s.bin}>
          <summary>
            <span className={s.slabel}>{b.label}</span>
            <span className={s.track}><span className={`${s.fbar} ${b.key === '31' ? s.late : ''}`} style={{ width: `${(b.rows.length / max) * 100}%` }} /></span>
            <span className={s.srate}>{b.rows.length}</span>
          </summary>
          <ul>
            {b.rows.slice(0, 40).map((r) => <li key={r.pursuitId}><a href={href(r.pursuitId)}>{r.name}</a> <span className={s.muted}>{r.days} d</span></li>)}
            {b.rows.length > 40 && <li className={s.muted}>and {b.rows.length - 40} more</li>}
          </ul>
        </details>
      ))}
    </div>
  );
}

const W = 260, H = 92, PAD = 16;

/** One measure per small chart, all on the same weeks: never two scales on one axis. */
export function WeekBars({ weeks, of, title, tone }: { weeks: Week[]; of: (w: Week) => number; title: string; tone: 'green' | 'purple' | 'amber' | 'ink' }) {
  const values = weeks.map(of);
  const max = Math.max(1, ...values);
  const bw = (W - 2) / weeks.length;
  const total = values.reduce((a, b) => a + b, 0);
  if (!total) return <figure className={s.small}><figcaption><b>{title}</b></figcaption><p className={s.muted}>None in {weeks.length} weeks.</p></figure>;
  return (
    <figure className={s.small}>
      <figcaption><b>{title}</b> <span className={s.muted}>{total} in {weeks.length} weeks</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H + PAD}`} role="img" aria-label={`${title} per week`} className={s[tone]}>
        <line x1={0} x2={W} y1={H} y2={H} className={s.axis} />
        {weeks.map((w, i) => {
          const v = values[i]!;
          const h = (v / max) * (H - 14);
          return (
            <g key={i}>
              <rect x={i * bw + 1} y={0} width={bw - 2} height={H} className={s.hit}><title>{`Week of ${day(w.week)}: ${v}`}</title></rect>
              {v > 0 && <rect x={i * bw + 2} y={H - h} width={Math.max(1, bw - 4)} height={h} rx={2} className={s.barMark} pointerEvents="none" />}
            </g>
          );
        })}
        <text x={0} y={H + 12} className={s.tick}>{weeks[0] ? day(weeks[0].week) : ''}</text>
        <text x={W} y={H + 12} textAnchor="end" className={s.tick}>{weeks.at(-1) ? day(weeks.at(-1)!.week) : ''}</text>
        <text x={W} y={10} textAnchor="end" className={s.tick}>{max}</text>
      </svg>
    </figure>
  );
}

/** A running sum as a step line, against the target when there is one. */
export function MoneyLine({ points, of, title, target, tone, now }: {
  points: MoneyPoint[]; of: (p: MoneyPoint) => number; title: string; target: number | null; tone: 'green' | 'amber'; now: Date;
}) {
  const vals = points.map(of);
  const last = vals.at(-1) ?? 0;
  if (!points.length || last === 0) {
    return <figure className={s.small}><figcaption><b>{title}</b></figcaption><p className={s.muted}>Nothing on file yet.</p></figure>;
  }
  const W2 = 540, H2 = 140;
  const t0 = points[0]!.at.getTime(), t1 = Math.max(now.getTime(), t0 + 86_400_000);
  const top = Math.max(last, target ?? 0) * 1.05;
  const x = (t: number) => ((t - t0) / (t1 - t0)) * W2;
  const y = (v: number) => H2 - (v / top) * H2;
  let d = `M0 ${H2}`;
  points.forEach((p, i) => { d += ` H${x(p.at.getTime()).toFixed(1)} V${y(vals[i]!).toFixed(1)}`; });
  d += ` H${W2}`;
  return (
    <figure className={s.small}>
      <figcaption><b>{title}</b> <span className={s.muted}>{usdCompact(last)}{target ? ` of ${usdCompact(target)} target` : ''}</span></figcaption>
      <svg viewBox={`0 0 ${W2} ${H2 + 16}`} role="img" aria-label={`${title}, running total`} className={s[tone]}>
        <line x1={0} x2={W2} y1={H2} y2={H2} className={s.axis} />
        {target && <g><line x1={0} x2={W2} y1={y(target)} y2={y(target)} className={s.target} /><text x={4} y={y(target) - 4} className={s.tick}>target {usdCompact(target)}</text></g>}
        <path d={d} className={s.lineMark} />
        {points.map((p, i) => (
          <circle key={i} cx={x(p.at.getTime())} cy={y(vals[i]!)} r={6} className={s.hit}>
            <title>{`${day(p.at)}: ${usdCompact(vals[i]!)}`}</title>
          </circle>
        ))}
        <text x={0} y={H2 + 13} className={s.tick}>{day(points[0]!.at)}</text>
        <text x={W2} y={H2 + 13} textAnchor="end" className={s.tick}>{day(now)}</text>
      </svg>
    </figure>
  );
}
