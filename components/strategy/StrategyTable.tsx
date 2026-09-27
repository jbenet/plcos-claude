'use client';

import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import Link from '@/components/ui/AppLink';
import { StatusMark } from '@/components/ui/StatusMark';
import { unpackRows, type PackedTable } from './pack';
import s from './strategy.module.css';

/** Per-LP inputs behind a row's score. Values only; the explanation is written once, here. */
export interface StrategyRowBasis {
  angle: string | null; capacity: string; likelihood: string | null; route: string | null; decision: string | null;
  /** forward, observed, factor */
  conversion: [number, number, number];
  work: Array<[string, number]>; due: string | null; proposed: string | null; strategy: string | null;
  plan: Array<[string, string]>;
}
export interface StrategyTableRow {
  id: string; name: string; href: string; action: string; group: string; status: string; owner: string;
  /** Position in the page's shared queue of LP actions and moves. */
  rank: number | null;
  /** Expected capital moved per team hour; a planning GUESS, never a forecast. */
  priority: number | null; expected: number | null; evidencePriority: number;
  capacity: number | null; likelihood: number | null; route: number | null; days: number | null;
  views: string[]; risks: string[]; held: boolean; basis: StrategyRowBasis;
}
type SortKey = 'name' | 'action' | 'status' | 'owner' | 'evidencePriority' | 'priority' | 'capacity' | 'likelihood' | 'route' | 'days';
const numeric = new Set<SortKey>(['evidencePriority', 'priority', 'capacity', 'likelihood', 'route', 'days']);
const keys: SortKey[] = ['name', 'action', 'status', 'owner', 'evidencePriority', 'priority', 'capacity', 'likelihood', 'route', 'days'];
const EMPTY = { q: '', view: 'all', status: '', action: '', owner: '' };
type Filters = typeof EMPTY;
type Sort = { key: SortKey; dir: 1 | -1 };
const filtersFrom = (params: Record<string, string>): Filters => ({
  q: params.q ?? '', view: params.view || 'all', status: params.status ?? '', action: params.action ?? '', owner: params.owner ?? '',
});
const sortFrom = (params: Record<string, string>): Sort => ({
  key: keys.find(k => k === params.sort) ?? 'priority', dir: params.dir === 'asc' ? 1 : -1,
});
const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(n);
const label = (v: string) => v.charAt(0).toUpperCase() + v.slice(1).replaceAll('-', ' ');
const PAGE = 50;

export function StrategyTable({ table, asOf, initialFilters = {}, views = [{ id: 'all', label: 'All LPs' }], rules }: {
  table: PackedTable; asOf: string; initialFilters?: Record<string, string>; views?: Array<{ id: string; label: string }>;
  rules: { hours: number; share: number; prior: number };
}) {
  const rows = useMemo(() => unpackRows(table), [table]);
  const [filters, setFilters] = useState(() => filtersFrom(initialFilters));
  const [sort, setSort] = useState(() => sortFrom(initialFilters));
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const search = useRef<HTMLInputElement>(null);
  const initialKey = JSON.stringify(initialFilters);
  const previousInitial = useRef(initialKey);
  // Gap links on the page navigate to the same address with new filters.
  useEffect(() => {
    if (initialKey === previousInitial.current) return;
    previousInitial.current = initialKey;
    const value = JSON.parse(initialKey) as Record<string, string>;
    setFilters(filtersFrom(value)); setSort(sortFrom(value)); setPage(1);
  }, [initialKey]);
  useEffect(() => {
    const pop = () => {
      const params = Object.fromEntries(new URL(window.location.href).searchParams);
      setFilters(filtersFrom(params)); setSort(sortFrom(params)); setPage(1);
    };
    const key = (event: KeyboardEvent) => {
      const el = event.target instanceof HTMLElement ? event.target : null;
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || el?.closest('input,textarea,select,[contenteditable],dialog,[role="dialog"]')) return;
      event.preventDefault(); search.current?.focus();
    };
    window.addEventListener('popstate', pop); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('popstate', pop); window.removeEventListener('keydown', key); };
  }, []);
  const updateAddress = (next: Filters, nextSort: Sort, push: boolean) => {
    const url = new URL(window.location.href);
    for (const k of Object.keys(EMPTY) as (keyof Filters)[]) {
      if (next[k] !== EMPTY[k]) url.searchParams.set(k, next[k]); else url.searchParams.delete(k);
    }
    url.searchParams.set('sort', nextSort.key); url.searchParams.set('dir', nextSort.dir === 1 ? 'asc' : 'desc');
    url.searchParams.delete('page');
    window.history[push ? 'pushState' : 'replaceState'](null, '', url);
  };
  const set = (k: keyof Filters, value: string) => {
    const next = { ...filters, [k]: value };
    setFilters(next); setPage(1); updateAddress(next, sort, k !== 'q');
  };
  const changeSort = (k: SortKey) => {
    const next: Sort = { key: k, dir: sort.key === k ? (sort.dir === 1 ? -1 : 1) : numeric.has(k) ? -1 : 1 };
    setSort(next); setPage(1); updateAddress(filters, next, true);
  };
  // Typing stays instant; the filter over thousands of rows follows a frame behind.
  const q = useDeferredValue(filters.q);
  const haystack = useMemo(() => new Map(rows.map(r => [r.id, `${r.name} ${r.action} ${r.group} ${r.status} ${r.owner}`.toLowerCase()])), [rows]);
  const filtered = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter(row => (filters.view === 'all' || row.views.includes(filters.view))
      && (!filters.status || row.status === filters.status) && (!filters.action || row.group === filters.action)
      && (!filters.owner || row.owner === filters.owner)
      && words.every(word => haystack.get(row.id)!.includes(word)))
      .sort((a, b) => {
        const av = a[sort.key] ?? null, bv = b[sort.key] ?? null;
        if (av === null || bv === null) {
          if (av !== bv) return av === null ? 1 : -1;
          return b.evidencePriority - a.evidencePriority || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
        }
        const order = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
        return order * sort.dir || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
      });
  }, [rows, haystack, q, filters.view, filters.status, filters.action, filters.owner, sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const current = Math.min(page, pages);
  const shown = filtered.slice((current - 1) * PAGE, current * PAGE);
  const values = useMemo(() => {
    const of = (k: 'status' | 'group' | 'owner') => [...new Set(rows.map(r => r[k]))].sort((a, b) => a.localeCompare(b));
    return { status: of('status'), group: of('group'), owner: of('owner') };
  }, [rows]);
  const maxPriority = useMemo(() => Math.max(0, ...rows.map(r => r.priority ?? 0)), [rows]);
  const toggle = (id: string) => setExpanded(before => { const next = new Set(before); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  // The whole row opens its detail (a large target on a touch screen); links and buttons keep their own click.
  const rowClick = (id: string) => (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('a,button,input,select')) toggle(id); };
  const Th = ({ k, children, className }: { k: SortKey; children: ReactNode; className?: string }) =>
    <th className={className} aria-sort={sort.key === k ? sort.dir === 1 ? 'ascending' : 'descending' : 'none'}>
      <button type="button" className={`thsort${sort.key === k ? ' on' : ''}`} onClick={() => changeSort(k)}>{children}{sort.key === k ? sort.dir === -1 ? ' ↓' : ' ↑' : ''}</button>
    </th>;
  const filtering = JSON.stringify(filters) !== JSON.stringify(EMPTY);

  return <div className={s.lpTable}>
    <div className={s.filterLine} role="search">
      <label className={s.searchBox}>
        <span className={s.fieldLabel}>Search</span>
        <span className={s.searchIcon} aria-hidden><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="7" r="4" /><path d="M10 10l3.5 3.5" /></svg></span>
        <input ref={search} type="search" value={filters.q} onChange={e => set('q', e.target.value)} placeholder="Names, next actions, owners… /" aria-label="Search LPs" enterKeyHint="search" />
      </label>
      <Field label="Show" set={filters.view !== 'all'}><select aria-label="Coverage" value={filters.view} onChange={e => set('view', e.target.value)}>{views.map(v => <option value={v.id} key={v.id}>{v.label}</option>)}</select></Field>
      <Field label="Status" set={!!filters.status}><select aria-label="Status" value={filters.status} onChange={e => set('status', e.target.value)}><option value="">Any</option>{values.status.map(v => <option value={v} key={v}>{label(v)}</option>)}</select></Field>
      <Field label="Next action" set={!!filters.action}><select aria-label="Next action" value={filters.action} onChange={e => set('action', e.target.value)}><option value="">Any</option>{values.group.map(v => <option key={v}>{v}</option>)}</select></Field>
      <Field label="Owner" set={!!filters.owner}><select aria-label="Owner" value={filters.owner} onChange={e => set('owner', e.target.value)}><option value="">Any</option>{values.owner.map(v => <option key={v}>{v}</option>)}</select></Field>
      {filtering && <button type="button" className={s.clearBtn} onClick={() => { setFilters(EMPTY); setPage(1); updateAddress(EMPTY, sort, true); }}>Clear</button>}
    </div>
    <div className={s.bar2} aria-live="polite">
      <span><b>{filtered.length.toLocaleString('en-US')}</b> of {rows.length.toLocaleString('en-US')} LPs{pages > 1 ? ` · page ${current} of ${pages}` : ''}</span>
      <span className={s.legend}>Scores are GUESSes · tap a row for its basis</span>
    </div>
    {filtered.length > 0 && <div className="tscroll"><table className={`list ${s.lp}`}>
      <thead><tr>
        <th className={s.tog} aria-label="Detail" />
        <Th k="name">LP</Th><Th k="action" className={s.actionCol}>Next action</Th><Th k="status">Status</Th><Th k="owner" className={s.midOnly}>Owner</Th>
        <Th k="priority" className={s.r}>Utility</Th><Th k="evidencePriority" className={`${s.r} ${s.midOnly}`}>Evidence pts</Th>
        <Th k="capacity" className={`${s.r} ${s.opt} ${s.midOnly}`}>Capacity</Th><Th k="likelihood" className={`${s.r} ${s.opt} ${s.wideOnly}`}>Likelihood</Th><Th k="route" className={`${s.r} ${s.opt} ${s.wideOnly}`}>Route</Th>
      </tr></thead>
      <tbody>{shown.map(row => {
        const open = expanded.has(row.id);
        return <Fragment key={row.id}>
          <tr className={`${s.lpRow}${open ? ` ${s.open}` : ''}`} onClick={rowClick(row.id)}>
            <td className={s.tog}><button type="button" className={s.chev} aria-label={`${open ? 'Hide' : 'Show'} the basis for ${row.name}`} aria-expanded={open} aria-controls={`lp-basis-${row.id}`} onClick={() => toggle(row.id)}><i aria-hidden /></button></td>
            <td className={s.name}><Link href={row.href}>{row.name}</Link></td>
            <td className={s.actionCol}><span className={s.clip} title={row.action}>{row.risks.length > 0 && <span className={s.risk} title={row.risks.join('; ')}>{row.risks.length} risk{row.risks.length === 1 ? '' : 's'}</span>}{row.action}</span></td>
            <td className={s.nowrap}><StatusMark status={row.status} /></td>
            <td className={`${s.owner} ${s.midOnly}`}>{row.owner}</td>
            <td className={`${s.r} ${s.scoreCell}`}>{row.priority === null
              ? <span className="muted">{row.held ? 'Held' : 'Unscored'}<span className={s.narrowOnly}> · {row.evidencePriority} pts</span></span>
              : <><span className={s.bar} aria-hidden><i style={{ width: `${maxPriority ? Math.max(4, row.priority / maxPriority * 100) : 0}%` }} /></span><b>{money(row.expected!)}</b></>}</td>
            <td className={`${s.r} ${s.midOnly} mono`}>{row.evidencePriority || <span className="muted">0</span>}</td>
            <td className={`${s.r} ${s.opt} ${s.midOnly}`}>{row.capacity === null ? <span className="muted">—</span> : money(row.capacity)}</td>
            <td className={`${s.r} ${s.opt} ${s.wideOnly}`}>{row.likelihood === null ? <span className="muted">—</span> : `${Math.round(row.likelihood * 100)}%`}</td>
            <td className={`${s.r} ${s.opt} ${s.wideOnly}`}>{row.route === null ? <span className="muted">—</span> : row.route}</td>
          </tr>
          {open && <tr className={s.basisRow} id={`lp-basis-${row.id}`}><td colSpan={10}><Basis row={row} rules={rules} /></td></tr>}
        </Fragment>;
      })}</tbody>
    </table></div>}
    {!filtered.length && <div className="cbody"><div className="empty"><h3>{rows.length ? 'No LPs match these filters' : 'No pursuits recorded'}</h3><p>{rows.length ? 'Clear the filters to see every recorded LP. No match means no match in this vehicle’s records.' : 'The raise owner can add LPs and record next actions in the pipeline.'}</p></div></div>}
    {pages > 1 && <div className={s.pager}><button type="button" className="btn" disabled={current === 1} onClick={() => setPage(current - 1)}>Previous</button><span>Page {current} of {pages}</span><button type="button" className="btn" disabled={current === pages} onClick={() => setPage(current + 1)}>Next</button></div>}
    <p className="cover">Search covers all {rows.length.toLocaleString('en-US')} pursuits in this vehicle’s records as of {asOf.slice(0, 10)}. <b>Utility</b> is GUESS capital this action moves, on the same scale as the moves above; <b>evidence points</b> order the follow-up work that has no capital score. Neither is a commitment or a forecast.</p>
  </div>;
}

function Field({ label: name, set, children }: { label: string; set: boolean; children: ReactNode }) {
  return <label className={`${s.field}${set ? ` ${s.fieldSet}` : ''}`}><span className={s.fieldLabel}>{name}</span>{children}</label>;
}

function Basis({ row, rules }: { row: StrategyTableRow; rules: { hours: number; share: number; prior: number } }) {
  const b = row.basis;
  const [forward, observed, factor] = b.conversion;
  const unknown = <span className="muted">Unknown</span>;
  return <div className={s.basis}>
    <div>
      <div className="lbl">Next action · {row.group}</div>
      <p className={s.lead}>{row.action}</p>
      {b.angle && <p><b>Angle.</b> {b.angle}</p>}
      {b.plan.length > 0 && <ol className={s.plan}>{b.plan.map(([move, because], i) => <li key={i}>{move}<small>{because}</small></li>)}</ol>}
      {row.risks.length > 0 && <ul className={s.risks}>{row.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>}
      <p className="muted">{b.due ? `Recorded due ${b.due}.` : 'No recorded due date.'} {b.proposed ? `Proposed: ${b.proposed}.` : ''} {b.strategy ? `Strategy ${b.strategy}.` : 'No vehicle strategy recorded.'}</p>
      <Link className={s.open} href={row.href}>Open the LP, its strategy and sources →</Link>
    </div>
    <div>
      <div className="lbl">Score · GUESS</div>
      <dl className={s.factors}>
        <dt>Capacity</dt><dd>{row.capacity === null ? unknown : <b>{money(row.capacity)}</b>}<small>{b.capacity}</small></dd>
        <dt>Likelihood</dt><dd>{row.likelihood === null ? unknown : <b>{Math.round(row.likelihood * 100)}%</b>}<small>{b.likelihood ?? 'No propensity assessment.'}</small></dd>
        <dt>Route weight</dt><dd>{row.route === null ? unknown : <b>{row.route}</b>}<small>{b.route ?? 'No stored route search.'}</small></dd>
        <dt>Conversion</dt><dd><b>×{factor}</b><small>{observed ? `${forward} of ${observed} LPs recorded leaving this status moved forward, damped by a neutral prior of ${rules.prior} (GUESS).` : 'No recorded exits from this status, so the factor stays neutral.'}</small></dd>
        <dt>Action share</dt><dd><b>×{rules.share}</b><small>Share of the LP’s modelled value one action unlocks (GUESS).</small></dd>
        <dt>Team time</dt><dd><b>{rules.hours} h</b><small>Preparation and review for one action (GUESS). Decision time {row.days === null ? 'unknown' : `about ${row.days} days`}{b.decision ? `: ${b.decision}` : ''}; elapsed days are not team hours.</small></dd>
      </dl>
      <p className={s.formula}>{row.expected === null || row.priority === null
        ? `${row.held ? 'Held (closed, restricted, stale, parked or already hard)' : 'Missing an input'}: no capital score.`
        : <>= <b>{money(row.expected)}</b> GUESS utility (capital; one LP’s action adds no presence) · ÷ {rules.hours} h = <b>{money(row.priority)}</b> per team hour{row.rank ? ` · #${row.rank} in the queue` : ''}</>}</p>
    </div>
    <div>
      <div className="lbl">Evidence work · {row.evidencePriority} pts</div>
      {b.work.length ? <ul className={s.work}>{b.work.map(([what, pts]) => <li key={what}><span>{what}</span><b>{pts}</b></li>)}</ul> : <p className="muted">No open evidence work.</p>}
      <p className="muted">Points (GUESS) order follow-up work; they are not capital.</p>
    </div>
  </div>;
}
