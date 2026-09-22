'use client';

import type { Radar } from '@/lib/lenses-client';
import { useFloor } from './FloorContext';
import { compactUsd, shortName } from './shared';

/**
 * View 14 — the radar.
 *
 * Distance from the centre is **time since a dated exchange** — a meeting that happened or
 * an ask that was made. Not since we wrote a note to ourselves; since something passed
 * between us and them.
 *
 * The list beside it is the point of the view: every pursuit with no dated exchange at all.
 * Those cannot be placed on a recency chart, and putting them on the outer ring would turn
 * "nobody has spoken to them" into "they have gone cold", which is a different and much more
 * flattering claim.
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

export function RadarView({ radar }: { radar: Radar }) {
  const { select } = useFloor();
  const vehicles = [...new Set(radar.dots.concat(radar.offRadar).map((d) => d.vehicleName))];
  const top = Math.max(1, ...radar.dots.map((d) => d.amount ?? 0));
  const ringR = (i: number) => R0 + ((H / 2 - R0 - 28) * (i + 1)) / RINGS.length;

  const place = (dots: typeof radar.dots) => {
    const out: Array<{ d: (typeof radar.dots)[number]; x: number; y: number; r: number }> = [];
    for (const d of dots) {
      const vi = Math.max(0, vehicles.indexOf(d.vehicleName));
      const sector = (Math.PI * 2) / Math.max(1, vehicles.length);
      const inSector = dots.filter((x) => x.vehicleName === d.vehicleName);
      const k = inSector.indexOf(d);
      // Spread within the sector so two pursuits the same age do not sit on top of each other.
      const a = vi * sector + sector * (0.18 + (0.64 * (k + 0.5)) / Math.max(1, inSector.length)) - Math.PI / 2;
      const band = RINGS.findIndex((r) => (d.days ?? 0) <= r.max);
      const inner = band === 0 ? R0 : ringR(band - 1);
      const outer = ringR(band);
      const t = band === 3 ? 0.55 : Math.min(0.85, ((d.days ?? 0) - (band === 0 ? 0 : RINGS[band - 1]!.max)) / Math.max(1, RINGS[band]!.max - (band === 0 ? 0 : RINGS[band - 1]!.max)));
      const rad = inner + (outer - inner) * (0.25 + t * 0.6);
      out.push({
        d,
        x: CX + Math.cos(a) * rad,
        y: CY + Math.sin(a) * rad,
        r: 6 + Math.sqrt((d.amount ?? 0) / top) * 9,
      });
    }
    return out;
  };

  const placed = place(radar.dots);

  return (
    <div className="floordark radview">
      <div className="radgrid">
        <svg viewBox={`0 0 ${W} ${H}`} className="flsvg" role="img"
             aria-label="Time since a dated exchange, by vehicle">
          {RINGS.map((r, i) => (
            <g key={r.label}>
              <circle cx={CX} cy={CY} r={ringR(i)} className="radring" />
              <text x={CX} y={CY - ringR(i) + 11} className="radband" textAnchor="middle">{r.label}</text>
            </g>
          ))}
          {vehicles.map((v, i) => {
            const sector = (Math.PI * 2) / Math.max(1, vehicles.length);
            const a = i * sector - Math.PI / 2;
            const rEdge = ringR(RINGS.length - 1);
            return (
              <g key={v}>
                <line x1={CX} y1={CY} x2={CX + Math.cos(a) * rEdge} y2={CY + Math.sin(a) * rEdge}
                      className="radspoke" />
                <text
                  x={CX + Math.cos(a + sector / 2) * (rEdge + 14)}
                  y={CY + Math.sin(a + sector / 2) * (rEdge + 14)}
                  className="radvlabel"
                  textAnchor={Math.cos(a + sector / 2) < -0.2 ? 'end' : Math.cos(a + sector / 2) > 0.2 ? 'start' : 'middle'}
                >
                  {v}
                </text>
              </g>
            );
          })}
          <circle cx={CX} cy={CY} r={R0} className="radcore" />
          <text x={CX} y={CY - 4} className="radasoflbl" textAnchor="middle">AS OF</text>
          <text x={CX} y={CY + 12} className="radasof" textAnchor="middle">
            {utcDay(radar.asOf)}
          </text>

          {placed.map(({ d, x, y, r }) => (
            <g key={d.key} className="raddot" onClick={() => select({ kind: 'item', key: d.key })}>
              <title>{[(`${d.name} · ${d.vehicleName} · ${d.ownerName}\n`), (`Last dated exchange ${d.days}d ago\n${compactUsd(d.amount)}`)].join('')}</title>
              <circle cx={x} cy={y} r={r} className={`raddotc t-${d.temp}${d.blocked ? ' blocked' : ''}`} />
              {d.urgent && <circle cx={x + r - 1} cy={y - r + 1} r={3} className="radurgent" />}
              <text x={x} y={y + r + 9} className="radname" textAnchor="middle">{shortName(d.name, 10)}</text>
            </g>
          ))}
        </svg>

        <div className="radoff">
          <div className="lbl">Off the radar</div>
          <div className="radoffn">{radar.offRadar.length}</div>
          <p>
            Pursuits with <b>no dated exchange at all</b>. They cannot be placed on a recency
            chart, and putting them on the outer ring would claim they had gone cold rather
            than that nobody has spoken to them.
          </p>
          <div className="radofflist">
            {radar.offRadar.map((d) => (
              <button key={d.key} className="radoffrow" onClick={() => select({ kind: 'item', key: d.key })}>
                <span className={`radpip t-${d.temp}`} />
                <span className="ron">{shortName(d.name, 22)}</span>
                <span className="rov">{d.vehicleName}</span>
                <span className="rom mono">{compactUsd(d.amount)}</span>
              </button>
            ))}
            {radar.offRadar.length === 0 && (
              <p className="csmall">Every pursuit has a dated exchange. That is unusual.</p>
            )}
          </div>
        </div>
      </div>

      <div className="radbands">
        <span className="lbl">Last dated exchange</span>
        {radar.bands.map((b) => (
          <span key={b.label} className="radbandstat"><b>{b.count}</b> {b.label}</span>
        ))}
      </div>

      <div className="fllegend">
        <span>Rings = days since a dated exchange</span>
        <span>Sectors = vehicle</span>
        <span>Size = potential cheque</span>
        <span>Colour = the recorded assessment, never inferred from silence</span>
      </div>
    </div>
  );
}
