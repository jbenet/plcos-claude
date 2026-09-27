import type { FoldedRun } from '@/lib/workflows/ledger';
import { OUTCOMES, type Bucket } from '@/lib/workflows/view';
import s from './workflows.module.css';

/** Plain words for a run's outcome (AGENTS.md: status vocabulary is plain language). */
export const OUTCOME_WORD: Record<FoldedRun['outcome'], string> = {
  succeeded: 'Succeeded', partial: 'Partly done', failed: 'Failed', refused: 'Refused',
  cancelled: 'Cancelled', unavailable: 'Source unavailable', unknown: 'No finish recorded',
};
export const OUTCOME_FLAG: Record<FoldedRun['outcome'], string> = {
  succeeded: 'f-ok', partial: 'f-ev', failed: 'f-block', refused: 'f-block',
  cancelled: 'f-mute', unavailable: 'f-mute', unknown: 'f-mute',
};
const TONE: Record<FoldedRun['outcome'], string> = {
  succeeded: 'var(--green)', partial: 'var(--amber)', failed: 'var(--clay)', refused: 'var(--clay)',
  cancelled: '#B9B3A6', unavailable: '#B9B3A6', unknown: '#D6D1C4',
};

export function Outcome({ outcome }: { outcome: FoldedRun['outcome'] }) {
  return <span className={`flag ${OUTCOME_FLAG[outcome]} ${s.outcome}`}>{OUTCOME_WORD[outcome]}</span>;
}

/** A thin stacked bar of outcomes with the numbers beside it, so colour is never the only signal. */
export function OutcomeBar({ outcomes, total }: { outcomes: Record<FoldedRun['outcome'], number>; total: number }) {
  const parts = OUTCOMES.filter((o) => outcomes[o] > 0);
  return (
    <div className={s.obar}>
      <span className={s.track} aria-hidden>
        {parts.map((o) => (
          <span key={o} style={{ width: `${(outcomes[o] / Math.max(1, total)) * 100}%`, background: TONE[o] }} />
        ))}
      </span>
      <span className={s.onums}>
        {parts.map((o) => (
          <span key={o} title={OUTCOME_WORD[o]}>
            <i style={{ background: TONE[o] }} aria-hidden />
            {outcomes[o]} {o === 'succeeded' ? 'done' : o === 'partial' ? 'partly' : o === 'unknown' ? 'open' : o}
          </span>
        ))}
      </span>
    </div>
  );
}

const fmtHour = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const fmtDay = (d: Date) => d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/**
 * Runs over time as stacked bars. A picture of the runs table below it, which carries the same
 * information as a list (frontend contract: every canvas has a list equivalent).
 */
export function Timeline({ buckets, hours }: { buckets: Bucket[]; hours: number }) {
  const max = Math.max(1, ...buckets.map((b) => OUTCOMES.reduce((n, o) => n + b.outcomes[o], 0)));
  const W = 1000, Hh = 132, top = 8, base = 108, gap = buckets.length > 30 ? 2 : 4;
  const bw = W / Math.max(1, buckets.length);
  const busiest = buckets.reduce((a, b) => (OUTCOMES.reduce((n, o) => n + b.outcomes[o], 0) > OUTCOMES.reduce((n, o) => n + a.outcomes[o], 0) ? b : a), buckets[0]!);
  const busiestN = OUTCOMES.reduce((n, o) => n + busiest.outcomes[o], 0);
  // A label at each day's first bucket, when buckets are shorter than a day.
  const labels = buckets.map((b, i) => {
    if (hours >= 24) return i % Math.ceil(buckets.length / 10) === 0 ? fmtDay(b.start) : null;
    const prev = buckets[i - 1];
    return !prev || prev.start.getDate() !== b.start.getDate() ? fmtDay(b.start) : null;
  });
  const summary = `${buckets.length} bars of ${hours < 24 ? `${hours} h` : `${hours / 24} d`}; the busiest held ${busiestN} runs, from ${fmtDay(busiest.start)} ${fmtHour(busiest.start)}.`;
  return (
    <figure className={s.chart}>
      <svg viewBox={`0 0 ${W} ${Hh}`} preserveAspectRatio="none" role="img" aria-label={`Runs over time. ${summary}`}>
        <line x1={0} x2={W} y1={base + 0.5} y2={base + 0.5} stroke="var(--line)" />
        {[0.5, 1].map((f) => (
          <line key={f} x1={0} x2={W} y1={base - (base - top) * f} y2={base - (base - top) * f} stroke="var(--hair)" strokeDasharray="3 4" />
        ))}
        {buckets.map((b, i) => {
          let y = base;
          return (
            <g key={i}>
              {OUTCOMES.map((o) => {
                const n = b.outcomes[o];
                if (!n) return null;
                const h = ((base - top) * n) / max;
                y -= h;
                return <rect key={o} x={i * bw + gap / 2} y={y} width={Math.max(1, bw - gap)} height={h} fill={TONE[o]} />;
              })}
              {labels[i] && <line x1={i * bw + 0.5} x2={i * bw + 0.5} y1={base} y2={base + 6} stroke="var(--muted)" />}
            </g>
          );
        })}
      </svg>
      <div className={s.axis} aria-hidden>
        {labels.map((l, i) => (l ? <span key={i} style={{ left: `${(i / buckets.length) * 100}%` }}>{l}</span> : null))}
      </div>
      <figcaption className={s.caption}>
        <span>Each bar is {hours < 24 ? `${hours} hour${hours === 1 ? '' : 's'}` : `${hours / 24} day${hours === 24 ? '' : 's'}`} of started runs; the top line is {max}.</span>
        <span>Busiest: {busiestN} runs from {fmtDay(busiest.start)}, {fmtHour(busiest.start)}.</span>
      </figcaption>
    </figure>
  );
}

export { fmtDay, fmtHour };
