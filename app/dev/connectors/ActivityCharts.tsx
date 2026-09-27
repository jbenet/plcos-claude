'use client';

/**
 * Developer → Connectors (issue 0103): requests, bytes and records over time as stacked bars, one
 * slab per series, an estimate drawn lighter and dashed above the actual it extends. The three
 * charts share a selected bar; the panel beside them reads it out, series by series, so nothing is
 * hover-only (tap on an iPad, arrow keys with a keyboard). The table under them is the list
 * equivalent (frontend contract).
 */
import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import {
  bucketLabel, dayLabel, estimateStyle, fmtBytes, fmtCount, niceMax, partSum, stack,
  type ActivityView, type Metric, type Part,
} from '@/lib/activity/view';
import s from './connectors.module.css';

const W = 1000;
const fmt = (m: Metric) => (m === 'bytesIn' || m === 'bytesOut' ? fmtBytes : fmtCount);
const WORD: Record<Metric, string> = { requests: 'requests', bytesIn: 'in', bytesOut: 'out', records: 'records' };

function share(p: Part): string {
  const all = p.actual + p.estimated;
  if (!all || !p.estimated) return '';
  const pct = Math.round((p.estimated / all) * 100);
  return pct === 100 ? 'all estimated' : `${pct < 1 ? '<1' : pct}% estimated`;
}

/** A value with a mark when any of it is an estimate. */
function Val({ p, m }: { p: Part; m: Metric }) {
  const all = p.actual + p.estimated;
  if (!all) return <span className={s.zero}>–</span>;
  return p.estimated
    ? <span className={s.est} title={`${fmt(m)(p.actual)} counted + ${fmt(m)(p.estimated)} estimated`}>~{fmt(m)(all)}</span>
    : <span>{fmt(m)(all)}</span>;
}

function Bars({
  view, metric, y, k, down = false, sel,
}: { view: ActivityView; metric: Metric; y: number; k: number; down?: boolean; sel: number }) {
  const n = view.buckets.length;
  const bw = W / n;
  const gap = n > 60 ? 1 : n > 20 ? 3 : 6;
  return (
    <>
      {view.buckets.map((b, i) => (
        <g key={b.start} className={i === sel ? s.on : undefined}>
          {stack(b.values[metric]).map((slab) => {
            const st = estimateStyle(slab.estimated);
            const tone = view.series[slab.series]!.tone;
            const h = (slab.y1 - slab.y0) * k;
            const top = down ? y + slab.y0 * k : y - slab.y1 * k;
            return (
              <rect
                key={`${slab.series}${slab.estimated ? 'e' : 'a'}`}
                x={i * bw + gap / 2} y={top} width={Math.max(1, bw - gap)} height={Math.max(h, 0.75)}
                fill={tone} fillOpacity={st.fillOpacity}
                stroke={slab.estimated ? tone : "none"} strokeOpacity={0.85} strokeDasharray={st.strokeDasharray}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </g>
      ))}
    </>
  );
}

function Plot({
  view, title, metrics, sel, onPick, height,
}: {
  view: ActivityView; title: string; metrics: Metric[]; sel: number; onPick: (i: number) => void; height: number;
}) {
  const n = view.buckets.length;
  const twoWay = metrics.length === 2;
  const [up, dn] = [metrics[0]!, metrics[1]];
  const maxUp = Math.max(0, ...view.buckets.map((b) => partSum(b.values[up])));
  const maxDn = dn ? Math.max(0, ...view.buckets.map((b) => partSum(b.values[dn]))) : 0;
  const top = 6, bottom = 2, drawable = height - top - bottom;
  // Two-way (bytes): in above the line, out below, on one scale. The space below is at least an
  // eighth of the chart so a small "out" stays visible as a band, never as nothing.
  const scaleUp = twoWay ? maxUp || 1 : niceMax(maxUp);
  const scaleDn = twoWay ? Math.max(maxDn, scaleUp / 8) : 0;
  const k = drawable / (scaleUp + scaleDn);
  const base = top + scaleUp * k;
  const tot = view.totals[up];
  const totDn = dn ? view.totals[dn] : null;
  const known = tot.actual + tot.estimated + (totDn ? totDn.actual + totDn.estimated : 0);
  const unknown = tot.unknown + (totDn?.unknown ?? 0);
  const b = view.buckets[sel]!;

  const pickAt = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onPick(Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n))));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, PageUp: -7, PageDown: 7 };
    if (e.key in step) onPick(Math.min(n - 1, Math.max(0, sel + step[e.key]!)));
    else if (e.key === 'Home') onPick(0);
    else if (e.key === 'End') onPick(n - 1);
    else return;
    e.preventDefault();
  };
  const readout = metrics.map((m) => `${fmt(m)(partSum(b.values[m]))} ${WORD[m]}`).join(', ');

  return (
    <section className={s.plot}>
      <header className={s.phead}>
        <h3>{title}</h3>
        <span className={s.ptotal}>
          {twoWay ? (
            <>
              <b>{fmtBytes(tot.actual + tot.estimated)}</b> in · <b>{fmtBytes(totDn!.actual + totDn!.estimated)}</b> out
            </>
          ) : (
            tot.actual + tot.estimated === 0 && tot.unknown > 0
              ? <>not counted in {view.days} days</>
              : <><b>{fmt(up)(tot.actual + tot.estimated)}</b> in {view.days} days</>
          )}
          {share(tot) && <span className={s.pshare}> · {share(tot)}</span>}
          {unknown > 0 && known > 0 && <span className={s.pshare}> · {unknown} {unknown === 1 ? 'entry' : 'entries'} not counted</span>}
        </span>
      </header>
      <div
        className={s.canvas}
        style={{ height }}
        tabIndex={0}
        role="slider"
        aria-label={`${title}, one bar per ${view.size}. Arrow keys choose a bar.`}
        aria-valuemin={1} aria-valuemax={n} aria-valuenow={sel + 1}
        aria-valuetext={`${bucketLabel(b)}: ${readout}`}
        onPointerDown={pickAt}
        onPointerMove={(e) => { if (e.pointerType === 'mouse') pickAt(e); }}
        onKeyDown={onKey}
      >
        <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" aria-hidden>
          <rect x={(sel * W) / n} y={0} width={W / n} height={height} className={s.band} />
          {!twoWay && (
            <line x1={0} x2={W} y1={top + drawable / 2} y2={top + drawable / 2} className={s.grid} vectorEffect="non-scaling-stroke" />
          )}
          <line x1={0} x2={W} y1={top} y2={top} className={s.grid} vectorEffect="non-scaling-stroke" />
          <Bars view={view} metric={up} y={base} k={k} sel={sel} />
          {dn && <Bars view={view} metric={dn} y={base} k={k} down sel={sel} />}
          <line x1={0} x2={W} y1={base} y2={base} className={s.baseline} vectorEffect="non-scaling-stroke" />
        </svg>
        {known > 0 && <span className={s.ytop}>{twoWay ? `${fmtBytes(scaleUp)} in ↑` : fmt(up)(scaleUp)}</span>}
        {twoWay && known > 0 && <span className={s.ybot}>out ↓</span>}
        {known === 0 && (
          <span className={s.nodata}>
            {unknown > 0
              ? `Not counted here: ${unknown} ${unknown === 1 ? 'entry has' : 'entries have'} no ${title.toLowerCase()} figure — unknown, not zero.`
              : 'Nothing recorded in these days.'}
          </span>
        )}
      </div>
    </section>
  );
}

function Axis({ view }: { view: ActivityView }) {
  const n = view.buckets.length;
  const every = Math.max(1, Math.ceil(n / 7));
  return (
    <div className={s.axis} aria-hidden>
      {view.buckets.map((b, i) => ((n - 1 - i) % every === 0 ? (
        <span key={b.start} style={{ left: `${((i + 0.5) / n) * 100}%` }}
          className={[(i + 0.5) / n < 0.07 ? s.first : (i + 0.5) / n > 0.93 ? s.last : '', ((n - 1 - i) / every) % 2 === 1 ? s.alt : ''].join(' ')}>{dayLabel(b.start, false)}</span>
      ) : null))}
    </div>
  );
}

export function ActivityCharts({ view }: { view: ActivityView }) {
  const n = view.buckets.length;
  const [sel, setSel] = useState(n - 1);
  const b = view.buckets[Math.min(sel, n - 1)]!;
  const rows = view.series.map((ser, i) => ({ ser, i })).filter(({ i }) =>
    (['requests', 'bytesIn', 'bytesOut', 'records'] as Metric[]).some((m) => partSum([b.values[m][i]!]) > 0));
  const total = (m: Metric) => b.values[m].reduce((a, p) => ({ actual: a.actual + p.actual, estimated: a.estimated + p.estimated }), { actual: 0, estimated: 0 });
  const unknownHere = b.unknown.requests + b.unknown.bytesIn + b.unknown.bytesOut + b.unknown.records;
  const anyEstimate = view.buckets.some((x) => x.values.requests.some((p) => p.estimated) || x.values.records.some((p) => p.estimated) || x.values.bytesIn.some((p) => p.estimated));

  return (
    <div className={s.activity}>
      <div className={s.legend}>
        {view.series.map((ser) => (
          <span key={ser.key}><i style={{ background: ser.tone }} aria-hidden />{ser.label}</span>
        ))}
        {anyEstimate && <span className={s.legEst}><i aria-hidden />Estimate</span>}
      </div>

      <div className={s.split}>
        <div className={s.plots}>
          <Plot view={view} title="Requests" metrics={['requests']} sel={sel} onPick={setSel} height={104} />
          <Plot view={view} title="Data in and out" metrics={['bytesIn', 'bytesOut']} sel={sel} onPick={setSel} height={124} />
          <Plot view={view} title="Records pulled" metrics={['records']} sel={sel} onPick={setSel} height={104} />
          <Axis view={view} />
          {anyEstimate && (
            <p className={s.estline}>Lighter, dashed bars and figures marked ~ are estimates, backfilled where nothing was counted at the time.</p>
          )}
        </div>

        <aside className={s.detail} aria-live="polite" aria-label="The chosen bar">
          <div className={s.dhead}>
            <span className={s.dday}>{bucketLabel(b)}</span>
            <span className={s.dsub}>
              {b.partial ? `part week · ${b.days} days` : view.size === 'week' ? 'week' : 'UTC day'}
            </span>
          </div>
          <table className={s.dtable}>
            <thead>
              <tr><th scope="col"><span className="sr-only">Series</span></th><th scope="col">Req</th><th scope="col">In</th><th scope="col">Out</th><th scope="col">Rec</th></tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={5} className={s.dnone}>Nothing recorded{unknownHere ? ' that was counted' : ''}.</td></tr>
              )}
              {rows.map(({ ser, i }) => (
                <tr key={ser.key}>
                  <th scope="row" title={ser.label}><i style={{ background: ser.tone }} aria-hidden />{ser.label}</th>
                  {(['requests', 'bytesIn', 'bytesOut', 'records'] as Metric[]).map((m) => (
                    <td key={m}><Val p={b.values[m][i]!} m={m} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
            {rows.length > 1 && (
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  {(['requests', 'bytesIn', 'bytesOut', 'records'] as Metric[]).map((m) => (
                    <td key={m}><Val p={total(m)} m={m} /></td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
          <p className={s.dnote}>
            {unknownHere > 0 ? <>{unknownHere} {unknownHere === 1 ? 'figure' : 'figures'} not counted. </> : null}Tap a bar, or use the arrow keys.
          </p>
        </aside>
      </div>

      {anyEstimate && view.bases.length > 0 && (
        <details className={s.more}>
          <summary>How each source was estimated · {view.bases.length}</summary>
          <ul className={s.bases}>
            {view.bases.map((x) => <li key={`${x.label}${x.basis}`}><b>{x.label}</b> {x.basis}</li>)}
          </ul>
        </details>
      )}

      <details className={s.more}>
        <summary>The same figures as a table · {n} {view.size === 'week' ? 'weeks' : 'days'}</summary>
        <div className={s.tscroll}>
          <table className={`list ${s.table}`}>
            <caption className="sr-only">Totals per {view.size}; ~ marks a figure that includes an estimate.</caption>
            <thead>
              <tr><th scope="col">{view.size === 'week' ? 'Week' : 'Day'}</th><th scope="col" className={s.num}>Requests</th><th scope="col" className={s.num}>Bytes in</th><th scope="col" className={s.num}>Bytes out</th><th scope="col" className={s.num}>Records</th></tr>
            </thead>
            <tbody>
              {[...view.buckets].reverse().map((x) => (
                <tr key={x.start}>
                  <th scope="row">{bucketLabel(x)}{x.partial && <span className="muted"> · {x.days} d</span>}</th>
                  {(['requests', 'bytesIn', 'bytesOut', 'records'] as Metric[]).map((m) => (
                    <td key={m} className={s.num}>
                      <Val p={x.values[m].reduce((a, p) => ({ actual: a.actual + p.actual, estimated: a.estimated + p.estimated }), { actual: 0, estimated: 0 })} m={m} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
