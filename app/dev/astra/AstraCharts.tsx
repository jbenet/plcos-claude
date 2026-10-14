import type { AstraJob } from '@/lib/astra/jobs';
import s from './astra.module.css';

const NIGHTS = 14;
const W = 160;
const H = 40;

/** The last NIGHTS calendar days (UTC), oldest first, as YYYY-MM-DD. */
function lastDays(now: number): string[] {
  return Array.from({ length: NIGHTS }, (_, i) => new Date(now - (NIGHTS - 1 - i) * 864e5).toISOString().slice(0, 10));
}
const dayOf = (j: AstraJob) => (j.night ?? (j.startedAt ?? j.createdAt).slice(0, 10)).slice(0, 10);
const minutes = (j: AstraJob) => (j.startedAt && j.finishedAt ? Math.max(0, (Date.parse(j.finishedAt) - Date.parse(j.startedAt)) / 60_000) : null);

function Bars({ series, label }: { series: Array<Array<{ v: number; cls: string }>>; label: string }) {
  const max = Math.max(1, ...series.map((st) => st.reduce((n, p) => n + p.v, 0)));
  const bw = W / NIGHTS;
  return (
    <svg className={s.spark} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="none">
      <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} className={s.base} />
      {series.map((st, i) => {
        let y = H;
        return st.map((p, k) => {
          const h = (p.v / max) * (H - 3);
          y -= h;
          return h > 0 ? <rect key={`${i}-${k}`} x={i * bw + 1} y={y} width={bw - 2} height={h} className={p.cls} /> : null;
        });
      })}
    </svg>
  );
}

function Line({ points, label }: { points: Array<number | null>; label: string }) {
  const vals = points.filter((p): p is number => p !== null);
  const max = Math.max(1, ...vals);
  const x = (i: number) => (i + 0.5) * (W / NIGHTS);
  const y = (v: number) => H - 3 - (v / max) * (H - 8);
  let d = '';
  let pen = false;
  points.forEach((p, i) => { if (p === null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p).toFixed(1)} `; pen = true; });
  return (
    <svg className={s.spark} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="none">
      <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} className={s.base} />
      {d && <path d={d} className={s.line} />}
      {points.map((p, i) => (p === null ? null : <circle key={i} cx={x(i)} cy={y(p)} r="2" className={s.dot} />))}
    </svg>
  );
}

const fmtMin = (m: number) => (m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`);

/** Small charts over the runs ledger (issues 0146, 0147): runs, outcomes, LPs and run time per night. */
export function AstraCharts({ jobs, now }: { jobs: AstraJob[]; now: number }) {
  const days = lastDays(now);
  const by = days.map((d) => jobs.filter((j) => dayOf(j) === d));
  const finished = jobs.filter((j) => j.status === 'done' || j.status === 'failed');
  const doneJobs = jobs.filter((j) => j.status === 'done');
  const total = by.reduce((n, a) => n + a.length, 0);
  const failed = by.flat().filter((j) => j.status === 'failed').length;
  const done = by.flat().filter((j) => j.status === 'done').length;
  const lps = by.map((a) => a.filter((j) => j.status === 'done').reduce((n, j) => n + (j.counts.selected ?? 0), 0));
  const avgs = by.map((a) => {
    const m = a.map(minutes).filter((x): x is number => x !== null);
    return m.length ? m.reduce((n, x) => n + x, 0) / m.length : null;
  });
  const times = doneJobs.map(minutes).filter((x): x is number => x !== null);
  const avg = times.length ? times.reduce((n, x) => n + x, 0) / times.length : null;
  const range = `${days[0].slice(5)} to ${days[NIGHTS - 1].slice(5)}`;
  const none = <span className={s.nodata}>No runs yet</span>;
  const empty = finished.length === 0 && total === 0;

  return (
    <div className={`card ${s.charts}`} aria-label={`Run statistics, last ${NIGHTS} nights`}>
      <div className={s.chart}>
        <span className={s.k}>Runs per night</span>
        <span className={s.v}>{total}</span>
        {empty ? none : <Bars label={`Runs per night, ${range}`} series={by.map((a) => [{ v: a.length, cls: s.barInk }])} />}
      </div>
      <div className={s.chart}>
        <span className={s.k}>Done vs failed</span>
        <span className={s.v}><span className={s.up}>{done}</span> / <span className={failed ? s.down : ''}>{failed}</span></span>
        {empty ? none : (
          <Bars label={`Runs done (green) and failed (clay) per night, ${range}`}
            series={by.map((a) => [{ v: a.filter((j) => j.status === 'done').length, cls: s.barOk }, { v: a.filter((j) => j.status === 'failed').length, cls: s.barBad }])} />
        )}
      </div>
      <div className={s.chart}>
        <span className={s.k}>LPs researched per night</span>
        <span className={s.v}>{lps.reduce((n, x) => n + x, 0)}</span>
        {empty ? none : <Bars label={`LPs researched per night, ${range}`} series={lps.map((v) => [{ v, cls: s.barInk }])} />}
      </div>
      <div className={s.chart}>
        <span className={s.k}>Average run time</span>
        <span className={s.v}>{avg === null ? '—' : fmtMin(avg)}</span>
        {avg === null ? none : <Line label={`Average run time per night in minutes, ${range}`} points={avgs} />}
      </div>
      <span className={s.range}>Last {NIGHTS} nights, {range}; bars are scaled to each chart&apos;s busiest night.</span>
    </div>
  );
}
