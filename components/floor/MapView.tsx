'use client';

import { useState } from 'react';
import type { BoardState, Holding, Territory } from '@/lib/board-client';
import { EXPLORED_LABEL, HOLDING_LABEL } from '@/lib/board-client';
import { useFloor } from './FloorContext';
import { PagedRows } from './Paging';
import { MARKS_BEFORE_DENSITY, n, tally } from './scale';
import { compactUsd, shortName } from './shared';
import s from './floor.module.css';

/**
 * View 6 — the map.
 *
 * The ground, rather than the work. Every name we could approach is placed by the two
 * rubric dimensions that decide whether approaching is worth it at all: **can they write
 * this cheque** and **does the mandate actually match**. Size is the cheque, colour is who
 * holds the ground.
 *
 * The bank underneath is the fog, and it is the point of the view. A name nobody has
 * scored cannot be placed, and placing it anyway — at the middle, at zero, wherever — would
 * turn "we have not looked" into "we looked and it was mediocre". Those are opposite facts.
 *
 * At volume (issue 0066) the fog held a thousand tiles. It is now counted — by what we know,
 * by who holds it, by segment — and names only the best-connected unscored names, because
 * those are the cheapest to score and the likeliest to have a route. A crowded plane draws
 * density instead of dots, labelling only the largest cheques. The list under the legend has
 * every name.
 */

const W = 1000;
const H = 470;
const PAD = { l: 92, r: 30, t: 34, b: 58 };
const LABELS = 16;
const FOG_NAMED = 12;
const BINS = 20;

const HOLD_FILL: Record<Holding, string> = {
  wired: 'var(--fl-green)', ours: 'var(--fl-ink)', contested: 'var(--fl-purple)',
  restricted: 'var(--fl-clay)', open: 'var(--fl-amber)',
};
const HOLD_ORDER: Holding[] = ['ours', 'open', 'contested', 'restricted', 'wired'];
/** The bar labels have a third of a column; the full words are in each bar's title. */
const HOLD_SHORT: Record<Holding, string> = {
  ours: 'We work it', open: 'Nobody does', contested: 'Contested', restricted: 'Do not approach', wired: 'Wired',
};
const EXPLORED_SHORT: Record<string, string> = { scored: 'Scored', researched: 'Researched', named: 'Name only' };

export function MapView({ board }: { board: BoardState }) {
  const { select } = useFloor();
  const [shown, setShown] = useState<'fog' | 'placed'>(
    () => (board.territories.some((t) => t.capacity === null || t.affinity === null) ? 'fog' : 'placed'),
  );
  const placed = board.territories.filter((t) => t.capacity !== null && t.affinity !== null)
    .sort((a, b) => (b.cheque ?? 0) - (a.cheque ?? 0));
  const fogged = board.territories.filter((t) => t.capacity === null || t.affinity === null)
    .sort((a, b) => b.edges - a.edges || (b.cheque ?? 0) - (a.cheque ?? 0) || a.name.localeCompare(b.name));
  const dense = placed.length > MARKS_BEFORE_DENSITY;
  const labelled = new Set(placed.slice(0, LABELS).map((t) => t.entityId));

  const top = Math.max(1, ...board.territories.map((t) => t.cheque ?? 0));
  const r = (t: Territory) => 5 + Math.sqrt((t.cheque ?? 0) / top) * 21;
  const x = (v: number) => PAD.l + v * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - v * (H - PAD.t - PAD.b);

  // Density: how many placed names fall in each twentieth of each axis.
  const bins = new Map<string, number>();
  if (dense) {
    for (const t of placed) {
      const k = `${Math.min(BINS - 1, Math.floor(t.affinity! * BINS))}:${Math.min(BINS - 1, Math.floor(t.capacity! * BINS))}`;
      bins.set(k, (bins.get(k) ?? 0) + 1);
    }
  }
  const binMax = Math.max(1, ...bins.values());
  const cellW = (x(1) - x(0)) / BINS;
  const cellH = (y(0) - y(1)) / BINS;

  const explored = tally(fogged, (t) => t.explored);
  const holding = HOLD_ORDER.map((h) => ({ key: h, count: fogged.filter((t) => t.holding === h).length })).filter((h) => h.count > 0);
  const segments = tally(fogged, (t) => t.segment || 'No segment');
  const fogMax = Math.max(1, ...explored.map((e) => e.count), ...holding.map((h) => h.count), ...segments.map((g) => g.count));
  const bar = (key: string, label: string, count: number, full = label) => (
    <div className={s.bar} key={key} title={`${full}: ${count}`}>
      <span className={s.barname}>{label}</span>
      <span className={s.bartrack} aria-hidden><i style={{ width: `${(count / fogMax) * 100}%` }} /></span>
      <span className={s.barn}>{n(count)}</span>
    </div>
  );
  const listRows = shown === 'fog' ? fogged : placed;

  return (
    <div className={`floordark mapview ${s.dark}`}>
      {placed.length === 0 && (
        // An empty plane is 470 pixels of nothing; say it in a line and let the fog lead.
        <p className={s.mapempty}>
          {board.territories.length
            ? <>Nobody has scored any of these {n(board.territories.length)} names on capacity and fit, so none can be placed on the plane. <b>The fog below is the whole map.</b></>
            : 'No names in this scope.'}
        </p>
      )}
      {placed.length > 0 && <div className={s.wide}><svg viewBox={`0 0 ${W} ${H}`} className="flsvg" role="img"
           aria-label={`${placed.length} names placed by capacity and mandate fit; ${fogged.length} unscored names held back in the fog`}>
        <rect x={x(0.5)} y={PAD.t} width={x(1) - x(0.5)} height={y(0.5) - PAD.t} className="mquad good" />
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line x1={x(v)} y1={PAD.t} x2={x(v)} y2={y(0)} className="mgrid" />
            <line x1={x(0)} y1={y(v)} x2={x(1)} y2={y(v)} className="mgrid" />
            <text x={x(v)} y={y(0) + 14} className="mtick" textAnchor="middle">{v}</text>
            <text x={PAD.l - 8} y={y(v) + 3} className="mtick" textAnchor="end">{v}</text>
          </g>
        ))}
        <text x={x(0.5)} y={H - 24} className="maxis" textAnchor="middle">
          AFFINITY — does the mandate actually match
        </text>
        <text x={16} y={y(0.5)} className="maxis" textAnchor="middle" transform={`rotate(-90 16 ${y(0.5)})`}>
          CAPACITY — can they write it
        </text>
        <text x={x(0.98)} y={PAD.t + 14} className="mquadl" textAnchor="end">WHERE THE MONEY IS</text>
        <text x={x(0.02)} y={PAD.t + 14} className="mquadl">BIG, WRONG SHAPE</text>
        <text x={x(0.02)} y={y(0.02)} className="mquadl">NEITHER</text>
        <text x={x(0.98)} y={y(0.02)} className="mquadl" textAnchor="end">RIGHT SHAPE, SMALL</text>

        {dense && [...bins.entries()].map(([k, count]) => {
          const [a, c] = k.split(':').map(Number) as [number, number];
          return (
            <rect key={k} x={x(a / BINS) + 1} y={y((c + 1) / BINS) + 1} width={cellW - 2} height={cellH - 2} rx={2}
                  fill="var(--fl-ink)" fillOpacity={0.12 + (count / binMax) * 0.7}>
              <title>{`${count} names with capacity ${(c / BINS).toFixed(2)}–${((c + 1) / BINS).toFixed(2)} and affinity ${(a / BINS).toFixed(2)}–${((a + 1) / BINS).toFixed(2)}`}</title>
            </rect>
          );
        })}

        {placed.filter((t) => !dense || labelled.has(t.entityId)).map((t) => (
          <g key={t.entityId} className="mdot" role="button" tabIndex={0}
             onClick={() => select({ kind: 'entity', entityId: t.entityId, name: t.name })}
             onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select({ kind: 'entity', entityId: t.entityId, name: t.name }); } }}>
            <title>{[(`${t.name} · ${t.segment}\n`), (`Capacity ${t.capacity} · affinity ${t.affinity} · propensity ${t.propensity ?? '—'} · time ${t.timeToDecision ?? '—'}\n`), (`${t.band}. ${t.scoreBasis}\n`), (`${compactUsd(t.cheque)} — ${t.chequeBasis}\n`), (`${HOLDING_LABEL[t.holding]}${t.ownerName ? `, ${t.ownerName}` : ''} · ${t.edges} edges on file`)].join('')}</title>
            <circle
              cx={x(t.affinity!)} cy={y(t.capacity!)} r={r(t)}
              fill={HOLD_FILL[t.holding]} fillOpacity={t.holding === 'open' ? 0.18 : 0.42}
              stroke={HOLD_FILL[t.holding]}
              strokeDasharray={t.holding === 'open' ? '3 2' : undefined}
            />
            {labelled.has(t.entityId) && (
              <text x={x(t.affinity!)} y={y(t.capacity!) - r(t) - 4} className="mname" textAnchor="middle">
                {shortName(t.name, 20)}
              </text>
            )}
          </g>
        ))}
      </svg></div>}

      <div className="fogbank">
        <div className="foghead">
          <span className="lbl">The fog</span>
          <b>{n(fogged.length)} of {n(board.territories.length)} names cannot be placed</b>
          <span className="fognote">{board.fog.note}</span>
        </div>
        {fogged.length > 0 && (
          <div className={s.foggrid}>
            <div>
              <div className="lbl">What we know</div>
              <div className={s.bars}>{explored.map((e) => bar(e.key, EXPLORED_SHORT[e.key] ?? e.key, e.count, EXPLORED_LABEL[e.key as Territory['explored']]))}</div>
              <div className="lbl" style={{ marginTop: 10 }}>Who holds it</div>
              <div className={s.bars}>{holding.map((h) => bar(h.key, HOLD_SHORT[h.key], h.count, HOLDING_LABEL[h.key]))}</div>
            </div>
            <div>
              <div className="lbl">By segment</div>
              <div className={s.bars}>
                {segments.slice(0, 6).map((g) => bar(g.key, g.key, g.count))}
                {segments.length > 6 && bar('rest', `${segments.length - 6} more segments`, segments.slice(6).reduce((t, g) => t + g.count, 0))}
              </div>
            </div>
            <div>
              <div className="lbl">Score these first — the best-connected unscored</div>
              <div className="fogtiles">
                {fogged.slice(0, FOG_NAMED).map((t) => (
                  <button key={t.entityId} className={`fogtile e-${t.explored} h-${t.holding} ${s.fogbtn}`}
                          onClick={() => select({ kind: 'entity', entityId: t.entityId, name: t.name })}
                          title={`${t.name} · ${t.segment}\n${EXPLORED_LABEL[t.explored]}\n${t.scoreBasis}\n${t.edges} edges on file`}>
                    {shortName(t.name, 22)}
                    <i>{n(t.edges)} edges · {t.explored === 'researched' ? 'researched' : 'name only'}</i>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="fllegend">
        <span>Size = cheque they could write</span>
        <span><i className="sw" style={{ background: 'var(--fl-ink)' }} /> we are working it</span>
        <span><i className="sw" style={{ background: 'var(--fl-amber)' }} /> nobody is</span>
        <span><i className="sw" style={{ background: 'var(--fl-purple)' }} /> contested between vehicles</span>
        <span><i className="sw" style={{ background: 'var(--fl-clay)' }} /> do not approach</span>
        <span><i className="sw" style={{ background: 'var(--fl-green)' }} /> wired</span>
        {dense && <span>Shaded squares = how many names fall there · the {LABELS} largest cheques are drawn and named</span>}
      </div>

      {/* The list equivalent: every name on the map or in the fog, in words. */}
      <div className={s.lightpanel}>
        <div className={s.listhead}>
          <h3>Every name, as a list</h3>
          <div className={s.chips} role="group" aria-label="Which names">
            <button className={s.chip} aria-pressed={shown === 'fog'} onClick={() => setShown('fog')}>In the fog, best-connected first<b>{n(fogged.length)}</b></button>
            <button className={s.chip} aria-pressed={shown === 'placed'} onClick={() => setShown('placed')}>Placed, largest cheque first<b>{n(placed.length)}</b></button>
          </div>
        </div>
        <PagedRows key={shown} rows={listRows} size={12} label="names" quiet>{(page) => (
          <div className="scroller">
            <table className="list">
              <thead><tr><th>Name · segment</th><th>Capacity · affinity</th><th>Band</th><th>Cheque</th><th>Who holds it</th><th>Edges</th></tr></thead>
              <tbody>{page.map((t) => (
                <tr key={t.entityId}>
                  <td><button className="covname" onClick={() => select({ kind: 'entity', entityId: t.entityId, name: t.name })}><b>{t.name}</b></button><div className="muted">{t.segment}</div></td>
                  <td className="mono">{t.capacity === null || t.affinity === null ? 'Not scored' : `${t.capacity} · ${t.affinity}`}</td>
                  <td>{t.band}<div className="muted">{EXPLORED_LABEL[t.explored]}</div></td>
                  <td className="mono">{compactUsd(t.cheque)}</td>
                  <td>{HOLDING_LABEL[t.holding]}{t.ownerName ? ` · ${t.ownerName}` : ''}</td>
                  <td className="mono">{n(t.edges)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}</PagedRows>
        {listRows.length === 0 && <p className="muted">{shown === 'fog' ? 'Every name here is scored.' : 'Nothing is scored yet.'}</p>}
      </div>
    </div>
  );
}
