import { Info } from '@/components/ui/Info';
import { formatDate } from '@/lib/time';
import type { Band, PageDrop, ReadFunnel, Unanswered } from '@/lib/conversion/dataroom';
import { MIN_FOR_RATE } from '@/lib/conversion/model';
import s from './conversion.module.css';

/**
 * Dataroom views (docs/33 §1, charts 7–10), from DocSend visits (docs/32). Drawn as the rest of the page is: plain
 * HTML and SVG, a native tooltip on every mark, and the numbers written out. Every line says it is partial: a view
 * is curiosity, not commitment, and a link forwarded inside a firm reads as whoever opened it.
 */

const day = (d: Date) => formatDate(d, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const pc = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);

export function ReadFunnelChart({ f, unmatched }: { f: ReadFunnel; unmatched: number }) {
  const steps = [
    { label: 'Reached', n: f.reached, means: 'LPs we reached, or who opened the dataroom.' },
    { label: 'Opened the dataroom', n: f.opened, means: 'At least one DocSend visit matched to them by email.' },
    { label: 'Read past half', n: f.half, means: 'A visit that got past 50% of a document.' },
    { label: 'Came back', n: f.back, means: 'Visits on two or more days.' },
  ];
  const max = Math.max(1, ...steps.map((x) => x.n));
  return (
    <div className={s.funnel} role="table" aria-label="Dataroom funnel">
      {steps.map((x, i) => (
        <div key={x.label} className={s.frow} role="row">
          <span role="cell" className={s.fname}>{x.label} <Info label={`What ${x.label} means`}>{x.means}</Info></span>
          <span role="cell" className={s.fbarCell}>
            <span className={`${s.fbar} ${s.purpleBar}`} style={{ width: `${(x.n / max) * 100}%` }} title={`${x.n} LPs`} />
            <b>{x.n.toLocaleString('en-US')}</b>
          </span>
          <span role="cell">{i ? pc(steps[i - 1]!.n ? x.n / steps[i - 1]!.n : null) : ''}</span>
          <span role="cell" className={s.muted}>
            {i === 1 && unmatched > 0 ? `+${unmatched} visits by people not on record` : i === 2 && f.unknownDepth ? `${f.unknownDepth} depth unknown` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

export function EngagementCard({ bands }: { bands: Band[] }) {
  return (
    <div className={s.panel}>
      <div className={s.phead}><b>Time in the dataroom</b><span className="lbl">met us · n</span></div>
      {bands.map((b) => (
        <div key={b.key} className={s.seg}>
          <span className={s.slabel}>{b.label}</span>
          <span className={b.rate === null ? s.notrack : s.track} aria-hidden>
            {b.ci && <span className={s.ci} style={{ left: `${b.ci.lo * 100}%`, width: `${(b.ci.hi - b.ci.lo) * 100}%` }} />}
            {b.rate !== null && <span className={s.dot} style={{ left: `${b.rate * 100}%` }}
              title={`${b.met} of ${b.n} met us (${pc(b.rate)}); ${b.committed} committed`} />}
          </span>
          <span className={s.srate}>
            {b.rate === null ? <span className={s.muted} title={`Fewer than ${MIN_FOR_RATE} LPs: a rate would be noise`}>{b.met}/{b.n}</span>
              : <>{pc(b.rate)} <span className={s.muted}>{b.n}</span></>}
          </span>
        </div>
      ))}
    </div>
  );
}

const W = 540, H = 110;

/** The share of a document's visits still reading at each page: where the drop is steep, that page loses people. */
export function PageDropChart({ doc }: { doc: PageDrop }) {
  const n = doc.pages.length;
  if (!n) return null;
  const bw = W / n;
  return (
    <figure className={s.small}>
      <figcaption><b>{doc.documentTitle}</b> <span className={s.muted}>{doc.viewers} visits with page times</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H + 16}`} role="img" aria-label={`${doc.documentTitle}: share of visits reaching each page`} className={s.purple}>
        <line x1={0} x2={W} y1={H} y2={H} className={s.axis} />
        {doc.pages.map((p, i) => {
          const h = p.share * (H - 10);
          return (
            <g key={p.page}>
              <rect x={i * bw} y={0} width={bw} height={H} className={s.hit}>
                <title>{`Page ${p.page}: ${pc(p.share)} of visits${p.seconds !== null ? `, median ${Math.round(p.seconds)} s` : ''}`}</title>
              </rect>
              {h > 0 && <rect x={i * bw + 1} y={H - h} width={Math.max(1, bw - 2)} height={h} rx={2} className={s.barMark} pointerEvents="none" />}
            </g>
          );
        })}
        <text x={0} y={H + 13} className={s.tick}>page 1</text>
        <text x={W} y={H + 13} textAnchor="end" className={s.tick}>page {n}</text>
        <text x={W} y={10} textAnchor="end" className={s.tick}>100%</text>
      </svg>
    </figure>
  );
}

export function NoFollowUpCard({ rows, href }: { rows: Unanswered[]; href: (id: string) => string }) {
  return (
    <div className={s.panel}>
      <div className={s.phead}><b>Read it, nothing from us since</b><span className="lbl">last 14 days · {rows.length}</span></div>
      {rows.length === 0 ? <p className={s.muted}>Everyone who read in the last fortnight has heard from us since.</p> : (
        <ul className={s.plain}>
          {rows.slice(0, 40).map((r) => (
            <li key={r.pursuitId}>
              <a href={href(r.pursuitId)}>{r.name}</a> <span className={s.muted}>{day(r.last)}{r.document ? ` · ${r.document}` : ''}</span>
            </li>
          ))}
          {rows.length > 40 && <li className={s.muted}>and {rows.length - 40} more</li>}
        </ul>
      )}
    </div>
  );
}
