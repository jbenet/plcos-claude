'use client';

import { useState } from 'react';
import type { Radar, RadarDot } from '@/lib/lenses-client';
import { useFloor } from './FloorContext';
import { PagedRows } from './Paging';
import { MARKS_BEFORE_DENSITY, n, tally } from './scale';
import { compactUsd, shortName } from './shared';
import s from './floor.module.css';

/**
 * View 14 — the radar.
 *
 * Distance from the centre is **time since a dated exchange** — a meeting that happened or
 * an ask that was made. Not since we wrote a note to ourselves; since something passed
 * between us and them.
 *
 * The panel beside it is the point of the view: every pursuit with no dated exchange at all.
 * Those cannot be placed on a recency chart, and putting them on the outer ring would turn
 * "nobody has spoken to them" into "they have gone cold", which is a different and much more
 * flattering claim.
 *
 * At volume (issue 0066) the off-radar pile is most of the pipeline, so the panel counts it by
 * owner and names only the largest. Only the largest dots on the rings carry a name, and a
 * crowded radar draws one counted bubble per vehicle and ring instead of a dot per pursuit.
 * The bands under the drawing open the matching pursuits in the list.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** UTC and hand-formatted: a locale string differs between the server and the browser. */
const utcDay = (d: Date | string) => {
  const x = new Date(d);
  return `${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`;
};

const W = 720;
const H = 560;
const CX = W / 2;
const CY = H / 2;
const R0 = 62;
const RINGS = [
  { max: 2, label: '0–2 days' },
  { max: 7, label: '3–7 days' },
  { max: 14, label: '8–14 days' },
  { max: 9999, label: '15+ days' },
];
/** Trig rounded to a millionth: Node and the browser can differ in the last bit, and an SVG
 * coordinate that differs by 1e-14 fails hydration. */
const cos = (a: number) => Math.round(Math.cos(a) * 1e6) / 1e6;
const sin = (a: number) => Math.round(Math.sin(a) * 1e6) / 1e6;
const r2 = (v: number) => Math.round(v * 100) / 100;
const NAMED_DOTS = 12;
const OFF_NAMED = 8;
const OFF_OWNERS = 5;
const BANDS = [...RINGS.map((r) => r.label), 'No dated exchange'];
const bandOf = (days: number | null) => (days === null ? 4 : RINGS.findIndex((r) => days <= r.max));

export function RadarView({ radar }: { radar: Radar }) {
  const { select } = useFloor();
  const [band, setBand] = useState<number | null>(null);
  const all = [...radar.dots, ...radar.offRadar];
  const vehicles = [...new Set(all.map((d) => d.vehicleName))];
  const top = Math.max(1, ...radar.dots.map((d) => d.amount ?? 0));
  const ringR = (i: number) => R0 + ((H / 2 - R0 - 28) * (i + 1)) / RINGS.length;
  const sector = (Math.PI * 2) / Math.max(1, vehicles.length);
  const dense = radar.dots.length > MARKS_BEFORE_DENSITY;
  const named = new Set([...radar.dots].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0)).slice(0, NAMED_DOTS).map((d) => d.key));

  const place = (dots: RadarDot[]) => {
    const out: Array<{ d: RadarDot; x: number; y: number; r: number }> = [];
    const bySector = new Map<string, RadarDot[]>();
    for (const d of dots) { const b = bySector.get(d.vehicleName); if (b) b.push(d); else bySector.set(d.vehicleName, [d]); }
    for (const b of bySector.values()) b.sort((x, y) => (y.amount ?? -1) - (x.amount ?? -1) || x.key.localeCompare(y.key));
    for (const d of dots) {
      const vi = Math.max(0, vehicles.indexOf(d.vehicleName));
      const inSector = bySector.get(d.vehicleName)!;
      const k = inSector.indexOf(d);
      // Spread within the sector by the golden ratio, so neighbours in size order land far
      // apart: the largest, which carry names, never bunch up at one end of the sector.
      const a = vi * sector + sector * (0.08 + 0.84 * ((k * 0.6180339887 + 0.5) % 1)) - Math.PI / 2;
      const b = bandOf(d.days);
      const inner = b === 0 ? R0 : ringR(b - 1);
      const outer = ringR(b);
      const lo = b === 0 ? 0 : RINGS[b - 1]!.max;
      // The outer ring is open-ended, so it reads on a log scale: a fortnight at its inner edge,
      // a year at its outer one. Older sits further out, as on the inner rings.
      const t = b === 3 ? Math.min(1, Math.log((d.days ?? 15) / 15) / Math.log(365 / 15))
        : Math.min(0.85, ((d.days ?? 0) - lo) / Math.max(1, RINGS[b]!.max - lo));
      const rad = inner + (outer - inner) * (0.25 + t * 0.6);
      out.push({ d, x: r2(CX + cos(a) * rad), y: r2(CY + sin(a) * rad), r: r2(5 + Math.sqrt((d.amount ?? 0) / top) * 9) });
    }
    return out;
  };

  // Crowded: one bubble per vehicle and ring, sized by how many pursuits sit there.
  const clusters = dense ? vehicles.flatMap((v, vi) => RINGS.map((_, ri) => {
    const here = radar.dots.filter((d) => d.vehicleName === v && bandOf(d.days) === ri);
    const a = vi * sector + sector / 2 - Math.PI / 2;
    const rad = (ri === 0 ? R0 : ringR(ri - 1)) + (ringR(ri) - (ri === 0 ? R0 : ringR(ri - 1))) / 2;
    return { v, ri, count: here.length, x: r2(CX + cos(a) * rad), y: r2(CY + sin(a) * rad) };
  })).filter((c) => c.count > 0) : [];
  const clusterMax = Math.max(1, ...clusters.map((c) => c.count));
  const placed = place(dense ? radar.dots.filter((d) => named.has(d.key)) : radar.dots);
  // A name is drawn only where it does not land on another name; the rest keep their tooltip.
  const labels = new Set<string>();
  const taken: Array<{ x: number; y: number }> = [];
  for (const p of [...placed].sort((a, b) => (b.d.amount ?? -1) - (a.d.amount ?? -1))) {
    if (!named.has(p.d.key)) continue;
    const ly = p.y + p.r + 9;
    if (taken.some((t) => Math.abs(t.x - p.x) < 58 && Math.abs(t.y - ly) < 11)) continue;
    taken.push({ x: p.x, y: ly });
    labels.add(p.d.key);
  }

  const off = [...radar.offRadar].sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1) || a.name.localeCompare(b.name));
  const offOwners = tally(off, (d) => d.ownerName);
  const offTop = Math.max(1, ...offOwners.map((o) => o.count));
  const counts = BANDS.map((_, b) => all.filter((d) => bandOf(d.days) === b).length);
  const rows = all.filter((d) => band === null || bandOf(d.days) === band)
    .sort((a, b) => (b.days ?? Infinity) - (a.days ?? Infinity) || (b.amount ?? -1) - (a.amount ?? -1) || a.name.localeCompare(b.name));
  const key = (fn: () => void) => (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };

  return (
    <div className={`floordark radview ${s.dark}`}>
      <div className="radgrid">
        <svg viewBox={`0 0 ${W} ${H}`} className="flsvg" role="img"
             aria-label="Time since a dated exchange, by vehicle. The list below has every pursuit and its band.">
          {RINGS.map((r, i) => (
            <g key={r.label}>
              <circle cx={CX} cy={CY} r={ringR(i)} className="radring" />
              <text x={CX} y={CY - ringR(i) + 11} className="radband" textAnchor="middle">{r.label}</text>
            </g>
          ))}
          {vehicles.map((v, i) => {
            const a = i * sector - Math.PI / 2;
            const rEdge = ringR(RINGS.length - 1);
            return (
              <g key={v}>
                {vehicles.length > 1 && (
                  <line x1={CX} y1={CY} x2={CX + cos(a) * rEdge} y2={CY + sin(a) * rEdge} className="radspoke" />
                )}
                <text
                  x={CX + cos(a + sector / 2) * (rEdge + 14)}
                  y={CY + sin(a + sector / 2) * (rEdge + 14)}
                  className="radvlabel"
                  textAnchor={cos(a + sector / 2) < -0.2 ? 'end' : cos(a + sector / 2) > 0.2 ? 'start' : 'middle'}
                >
                  {v}
                </text>
              </g>
            );
          })}
          <circle cx={CX} cy={CY} r={R0} className="radcore" />
          <text x={CX} y={CY - 4} className="radasoflbl" textAnchor="middle">AS OF</text>
          <text x={CX} y={CY + 12} className="radasof" textAnchor="middle">{utcDay(radar.asOf)}</text>

          {clusters.map((c) => (
            <g key={`${c.v}-${c.ri}`} className="raddot" role="button" tabIndex={0}
               aria-label={`${c.v}, ${RINGS[c.ri]!.label}: ${c.count} pursuits. Opens them in the list.`}
               onClick={() => setBand(c.ri)} onKeyDown={key(() => setBand(c.ri))}>
              <title>{`${c.v} · ${RINGS[c.ri]!.label}: ${c.count} pursuits`}</title>
              <circle cx={c.x} cy={c.y} r={10 + Math.sqrt(c.count / clusterMax) * 26} className={s.radcluster} />
              <text x={c.x} y={c.y + 4} className={s.radclustern} textAnchor="middle">{n(c.count)}</text>
            </g>
          ))}

          {placed.map(({ d, x, y, r }) => (
            <g key={d.key} className="raddot" role="button" tabIndex={0} aria-label={`${d.name}: ${d.days} days since a dated exchange`}
               onClick={() => select({ kind: 'item', key: d.key })} onKeyDown={key(() => select({ kind: 'item', key: d.key }))}>
              <title>{`${d.name} · ${d.vehicleName} · ${d.ownerName}\nLast dated exchange ${d.days}d ago\n${compactUsd(d.amount)}`}</title>
              <circle cx={x} cy={y} r={r} className={`raddotc t-${d.temp}${d.blocked ? ' blocked' : ''}`} />
              {d.urgent && <circle cx={x + r - 1} cy={y - r + 1} r={3} className="radurgent" />}
              {labels.has(d.key) && <text x={x} y={y + r + 9} className="radname" textAnchor="middle">{shortName(d.name, 12)}</text>}
            </g>
          ))}
        </svg>

        <div className="radoff">
          <div className="lbl">Off the radar</div>
          <div className="radoffn">{n(off.length)}<span className={s.radof}> of {n(all.length)}</span></div>
          <p>
            Pursuits with <b>no dated exchange at all</b>. They cannot be placed on a recency
            chart, and putting them on the outer ring would claim they had gone cold rather
            than that nobody has spoken to them.
          </p>
          {offOwners.length > 1 && (
            <>
              <div className="lbl">Whose they are</div>
              <div className={s.bars}>
                {offOwners.slice(0, OFF_OWNERS).map((o) => (
                  <button key={o.key} className={s.bar} onClick={() => select({ kind: 'person', name: o.key })}>
                    <span className={s.barname}>{o.key}</span>
                    <span className={s.bartrack} aria-hidden><i style={{ width: `${(o.count / offTop) * 100}%` }} /></span>
                    <span className={s.barn}>{n(o.count)}</span>
                  </button>
                ))}
                {offOwners.length > OFF_OWNERS && (
                  <div className={s.bar}>
                    <span className={s.barname}>{offOwners.length - OFF_OWNERS} others</span><span />
                    <span className={s.barn}>{n(offOwners.slice(OFF_OWNERS).reduce((t, o) => t + o.count, 0))}</span>
                  </div>
                )}
              </div>
              <div className="lbl" style={{ marginTop: 8 }}>Largest first</div>
            </>
          )}
          <div className="radofflist">
            {off.slice(0, OFF_NAMED).map((d) => (
              <button key={d.key} className="radoffrow" onClick={() => select({ kind: 'item', key: d.key })}>
                <span className={`radpip t-${d.temp}`} />
                <span className="ron">{shortName(d.name, 22)}</span>
                <span className="rov">{d.ownerName}</span>
                <span className="rom mono">{compactUsd(d.amount)}</span>
              </button>
            ))}
            {off.length > OFF_NAMED && (
              <button className={s.radmore} onClick={() => setBand(4)}>+{n(off.length - OFF_NAMED)} more in the list below</button>
            )}
            {off.length === 0 && <p className="csmall">Every pursuit has a dated exchange. That is unusual.</p>}
          </div>
        </div>
      </div>

      <div className="radbands" role="group" aria-label="Last dated exchange: choose a band to list">
        <span className="lbl">Last dated exchange</span>
        {BANDS.map((label, b) => (
          <button key={label} className={s.chip} aria-pressed={band === b} onClick={() => setBand(band === b ? null : b)}>
            {label}<b>{n(counts[b]!)}</b>
          </button>
        ))}
      </div>

      <div className="fllegend">
        <span>Rings = days since a dated exchange</span>
        {vehicles.length > 1 && <span>Sectors = vehicle</span>}
        <span>Size = potential cheque · the largest are named where there is room</span>
        {dense && <span>Numbered bubbles = how many pursuits sit in that ring</span>}
        <span>Colour = the recorded assessment, never inferred from silence</span>
      </div>

      <div className={s.lightpanel}>
        <div className={s.listhead}>
          <h3>{band === null ? 'Every pursuit, by time since a dated exchange' : BANDS[band]}</h3>
          <span>No dated exchange first, then the longest silence{band !== null && <> · <button className="covname" onClick={() => setBand(null)}>show every band</button></>}</span>
        </div>
        <PagedRows key={String(band)} rows={rows} size={12} label="pursuits" quiet>{(page) => (
          <div className="scroller">
            <table className="list">
              <thead><tr><th>Pursuit</th><th>Vehicle · owner</th><th>Last dated exchange</th><th>At stake</th><th>Signals</th></tr></thead>
              <tbody>{page.map((d) => (
                <tr key={d.key}>
                  <td><button className="covname" onClick={() => select({ kind: 'item', key: d.key })}><b>{d.name}</b></button></td>
                  <td>{d.vehicleName} · {d.ownerName}</td>
                  <td className="mono">{d.days === null ? 'None on record' : `${d.days} days ago`}</td>
                  <td className="mono">{compactUsd(d.amount)}</td>
                  <td>{[d.blocked ? 'Blocked' : '', d.urgent ? 'Dated soon' : '', d.temp].filter(Boolean).join(' · ')}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}</PagedRows>
        <p className="muted" style={{ fontSize: 11 }}>{radar.note}</p>
      </div>
    </div>
  );
}
