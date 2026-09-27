'use client';

import { Fragment, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import type { MoveRow } from '@/modules/strategy/moves';
import { MOVE_FAMILIES, moveFamily, type PresenceEstimate } from '@/modules/strategy/move-utility';
import { MoveControls } from './MoveControls';
import s from './strategy.module.css';

export interface MoveTableRow extends MoveRow {
  rank: number | null; expected: number; priority: number;
  /** 0097: capital + presence × its capital-equivalent. GUESS, and the menu's order. */
  utility: number; presence: PresenceEstimate & { source: 'move' | 'default' }; presenceValue: number;
}

const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(n);
const pct = (n: number) => `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;
/** The kinds of work named in 0082. A family with nothing estimated still shows, at zero, so a gap
 * in the option space is visible. */
const FAMILIES = MOVE_FAMILIES;
const familyOf = moveFamily;
const STATE: Record<MoveRow['state'], { label: string; cls: string }> = {
  proposed: { label: 'Proposed', cls: 'waiting' }, chosen: { label: 'Chosen', cls: 'ready' }, dismissed: { label: 'Dismissed', cls: 'unavailable' },
};
type SortKey = 'rank' | 'title' | 'utility' | 'reach' | 'presence' | 'expected' | 'hours' | 'priority' | 'cost' | 'days';
const value = (m: MoveTableRow, k: SortKey): number | string => k === 'rank' ? m.rank ?? Infinity : k === 'title' ? m.title
  : k === 'utility' ? m.utility : k === 'reach' ? m.estimates.reach.value : k === 'presence' ? m.presence.value
  : k === 'expected' ? m.expected : k === 'priority' ? m.priority : k === 'hours' ? m.estimates.teamHours.value
  : k === 'cost' ? m.estimates.cashCost.value : m.estimates.effectDays.value;

/** Presence, 0–5, as five marks: filled for the estimate; dashed when it is the kind's default. */
function Pips({ p }: { p: MoveTableRow['presence'] }) {
  return <span className={`${s.pips}${p.source === 'default' ? ` ${s.pipsDefault}` : ''}`} role="img"
    aria-label={`Presence ${p.value} of 5${p.source === 'default' ? ', default for its kind' : ''}`}>
    {[1, 2, 3, 4, 5].map(i => <i key={i} className={i <= Math.round(p.value) ? s.on : undefined} />)}
  </span>;
}

/** The inputs in the order the formula uses them. A basis repeated from the line above is shown once. */
function factorRows(m: MoveTableRow) {
  const e = m.estimates;
  const rows = [
    { label: 'LPs reached', value: String(e.reach.value), basis: e.reach.basis },
    { label: 'Check size', value: money(e.check.value), basis: e.check.basis },
    { label: 'Baseline conversion', value: pct(e.baseline.value), basis: e.baseline.basis },
    { label: 'Conversion lift', value: `+${pct(e.conversionLift.value)}`, basis: e.conversionLift.basis },
    { label: 'Check-size lift', value: money(e.checkLift.value), basis: e.checkLift.basis },
    { label: 'Effect discount', value: `×${e.confidence.value}`, basis: e.confidence.basis },
    { label: 'Team time', value: `${e.teamHours.value} h`, basis: e.teamHours.basis },
    { label: 'Cash cost', value: e.cashCost.value ? money(e.cashCost.value) : '$0', basis: e.cashCost.basis },
    { label: 'Days to effect', value: `${e.effectDays.value} d`, basis: e.effectDays.basis },
    { label: 'Presence', value: `${m.presence.value} of 5`, basis: m.presence.basis },
  ];
  return rows.map((r, i) => ({ ...r, basis: i > 0 && rows[i - 1]!.basis === r.basis ? '' : r.basis }));
}

export function MoveTable({ moves, vehicleId, pointValue }: { moves: MoveTableRow[]; vehicleId: string; pointValue: number }) {
  const [family, setFamily] = useState('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'rank', dir: 1 });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showDismissed, setShowDismissed] = useState(false);
  // "So next" links to #move-<id>: open that row and bring it into view.
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.replace(/^#move-/, ''));
      if (!window.location.hash.startsWith('#move-') || !moves.some(m => m.id === id)) return;
      const m = moves.find(x => x.id === id)!;
      setFamily('all'); if (m.state === 'dismissed') setShowDismissed(true);
      setExpanded(before => new Set(before).add(id));
      requestAnimationFrame(() => document.getElementById(`move-${id}`)?.scrollIntoView({ block: 'start' }));
    };
    open(); window.addEventListener('hashchange', open);
    return () => window.removeEventListener('hashchange', open);
  }, [moves]);
  const families = useMemo(() => {
    const live = moves.filter(m => m.state !== 'dismissed');
    const known = FAMILIES.map(f => ({ id: f.id, label: f.label, n: live.filter(m => familyOf(m.category) === f.id).length }));
    const other = live.filter(m => familyOf(m.category) === 'other').length;
    return other ? [...known, { id: 'other', label: 'Other', n: other }] : known;
  }, [moves]);
  const dismissed = moves.filter(m => m.state === 'dismissed').length;
  const shown = useMemo(() => moves
    .filter(m => (showDismissed || m.state !== 'dismissed') && (family === 'all' || familyOf(m.category) === family))
    .sort((a, b) => {
      const av = value(a, sort.key), bv = value(b, sort.key);
      const order = typeof av === 'number' && typeof bv === 'number' ? (av === bv ? 0 : av < bv ? -1 : 1) : String(av).localeCompare(String(bv));
      return order * sort.dir || a.title.localeCompare(b.title);
    }), [moves, family, sort, showDismissed]);
  const max = Math.max(0, ...moves.map(m => m.utility));
  const toggle = (id: string) => setExpanded(before => { const next = new Set(before); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const rowClick = (id: string) => (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('a,button,input,select,form')) toggle(id); };
  const Th = ({ k, children, className }: { k: SortKey; children: ReactNode; className?: string }) =>
    <th className={className} aria-sort={sort.key === k ? sort.dir === 1 ? 'ascending' : 'descending' : 'none'}>
      <button type="button" className={`thsort${sort.key === k ? ' on' : ''}`} onClick={() => setSort({ key: k, dir: sort.key === k ? (sort.dir === 1 ? -1 : 1) : k === 'rank' || k === 'title' ? 1 : -1 })}>
        {children}{sort.key === k ? sort.dir === -1 ? ' ↓' : ' ↑' : ''}</button>
    </th>;

  if (!moves.length) return <div className="cbody"><div className="empty">
    <span className="stat unavailable"><i />No moves imported</span>
    <h3>No whole-raise moves are on the menu for this raise</h3>
    <p>Moves are the options beyond advancing one LP: better materials, public presence, events, sourcing and enrichment, co-investor introductions. They are imported from a menu file with dated evidence and GUESS inputs; the import button above reads it.</p>
  </div></div>;

  return <div className={s.moveWrap}>
    <div className={s.chips} role="group" aria-label="Kind of move">
      <button type="button" aria-pressed={family === 'all'} onClick={() => setFamily('all')}>All<b>{moves.length - dismissed}</b></button>
      {families.map(f => <button type="button" key={f.id} aria-pressed={family === f.id} onClick={() => setFamily(f.id)} className={f.n ? undefined : s.none}
        title={f.n ? undefined : 'Nothing of this kind is estimated yet'}>{f.label}<b>{f.n}</b></button>)}
      {dismissed > 0 && <label className={s.check}><input type="checkbox" checked={showDismissed} onChange={e => setShowDismissed(e.target.checked)} /> Show {dismissed} dismissed</label>}
    </div>
    <div className="tscroll"><table className={`list ${s.moves}`}>
      <thead><tr>
        <th className={s.tog} aria-label="Detail" />
        <Th k="rank" className={s.num}>#</Th><Th k="title" className={s.what}>Move</Th><th className={s.midOnly}>Decision</th>
        <Th k="utility" className={s.r}>Utility</Th><Th k="reach" className={s.r}>Reach</Th><Th k="expected" className={`${s.r} ${s.midOnly}`}>Capital</Th>
        <Th k="presence">Presence</Th><Th k="priority" className={`${s.r} ${s.midOnly}`}>$ / team h</Th><Th k="hours" className={`${s.r} ${s.opt} ${s.wideOnly}`}>Team h</Th>
        <Th k="cost" className={`${s.r} ${s.opt} ${s.wideOnly}`}>Cash cost</Th><Th k="days" className={`${s.r} ${s.opt} ${s.wideOnly}`}>Days</Th>
      </tr></thead>
      <tbody>{shown.map(m => {
        const open = expanded.has(m.id);
        const e = m.estimates;
        return <Fragment key={m.id}>
          <tr id={`move-${m.id}`} className={`${s.lpRow}${open ? ` ${s.open}` : ''}${m.state === 'dismissed' ? ` ${s.dim}` : ''}`} onClick={rowClick(m.id)}>
            <td className={s.tog}><button type="button" className={s.chev} aria-label={`${open ? 'Hide' : 'Show'} the basis for ${m.title}`} aria-expanded={open} aria-controls={`move-basis-${m.id}`} onClick={() => toggle(m.id)}><i aria-hidden /></button></td>
            <td className={`${s.num} mono`}>{m.rank ?? '—'}</td>
            <td className={s.what}><span className={s.clip}><b>{m.title}</b><span className={s.cat}>{m.category}</span></span>{m.state !== 'proposed' && <small className={`${s.narrowOnly} ${s.manual}`}>{STATE[m.state].label}{m.position !== null ? ` · placed #${m.position}` : ''}</small>}</td>
            <td className={`${s.nowrap} ${s.midOnly}`}><span className={`stat ${STATE[m.state].cls}`}><i />{STATE[m.state].label}</span>{m.position !== null && <small className={s.manual}>placed #{m.position}</small>}</td>
            <td className={`${s.r} ${s.scoreCell}`}><span className={s.bar} aria-hidden><i style={{ width: `${max ? Math.max(4, m.utility / max * 100) : 0}%` }} /></span><b>{money(m.utility)}</b></td>
            <td className={`${s.r} mono`}>{e.reach.value}</td>
            <td className={`${s.r} ${s.midOnly}`}>{money(m.expected)}</td>
            <td><Pips p={m.presence} /></td>
            <td className={`${s.r} ${s.midOnly}`}>{money(m.priority)}</td>
            <td className={`${s.r} ${s.opt} ${s.wideOnly}`}>{e.teamHours.value}</td>
            <td className={`${s.r} ${s.opt} ${s.wideOnly}`}>{e.cashCost.value ? money(e.cashCost.value) : '—'}</td>
            <td className={`${s.r} ${s.opt} ${s.wideOnly}`}>{e.effectDays.value}</td>
          </tr>
          {open && <tr className={s.basisRow} id={`move-basis-${m.id}`}><td colSpan={12}>
            <div className={s.basis}>
              <div>
                <div className="lbl">What it is · {m.category}</div>
                <p className={s.lead}>{m.detail}</p>
                <p><b>Audience.</b> {e.audience}</p>
                <p><b>Depends on.</b> {e.dependencies}</p>
                <p className="muted">Scoped to {m.vehicles.join(' and ')}; these figures are this raise’s alone.</p>
              </div>
              <div>
                <div className="lbl">Score · GUESS</div>
                <dl className={s.factors}>{factorRows(m).map(f => <Fragment key={f.label}><dt>{f.label}</dt><dd><b>{f.value}</b>{f.basis && <small>{f.basis}</small>}</dd></Fragment>)}</dl>
                <p className={s.formula}>Capital {e.reach.value} × ({money(e.check.value)} × {pct(e.conversionLift.value)} + {money(e.checkLift.value)} × {pct(e.baseline.value + e.conversionLift.value)}) × {e.confidence.value} = <b>{money(m.expected)}</b><br />
                  Utility {money(m.expected)} + presence {m.presence.value} × {money(pointValue)} = <b>{money(m.utility)}</b><br />
                  Efficiency {money(m.expected)} ÷ {e.teamHours.value} h = <b>{money(m.priority)}</b> per team hour. Cash and days are constraints, outside the score.</p>
              </div>
              <div>
                <div className="lbl">Evidence</div>
                <ul className={s.evidence}>{m.evidence.map((ev, i) => <li key={i}><b>{ev.source}</b><small>As of {ev.as_of} · {ev.confidence} · verified by {ev.last_verified_by}</small>{ev.supports}</li>)}</ul>
                <div className="lbl" style={{ marginTop: 12 }}>Decide</div>
                <MoveControls key={m.id} move={m} vehicleId={vehicleId} />
              </div>
            </div>
          </td></tr>}
        </Fragment>;
      })}</tbody>
    </table></div>
    {!shown.length && <div className="cbody"><p className="muted">Nothing of this kind is on the menu yet. Adding one means a menu entry with dated evidence and GUESS inputs.</p></div>}
  </div>;
}
