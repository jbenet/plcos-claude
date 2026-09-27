'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Link from '@/components/ui/AppLink';
import { SortHeader, TableFilters } from './TableControls';

export interface StrategyTableRow {
  id: string; name: string; href: string; action: string; group: string; status: string; owner: string;
  /** Expected capital moved per team hour; a planning GUESS, never a forecast. */
  priority: number | null; evidencePriority: number;
  capacity: number | null; likelihood: number | null; route: number | null; days: number | null;
  views: string[]; detail: string[]; score?: number | null; teamHours?: number | null;
}
type SortKey = 'name' | 'action' | 'status' | 'owner' | 'evidencePriority' | 'priority' | 'capacity' | 'likelihood' | 'route' | 'days';
const numeric = new Set<SortKey>(['evidencePriority', 'priority', 'capacity', 'likelihood', 'route', 'days']);
const keys: SortKey[] = ['name', 'action', 'status', 'owner', 'evidencePriority', 'priority', 'capacity', 'likelihood', 'route', 'days'];
const EMPTY = { q: '', view: 'all', status: '', action: '', owner: '' };
type Filters = typeof EMPTY;
const filtersFrom = (params: Record<string, string>): Filters => ({
  q: params.q ?? '', view: params.view || 'all', status: params.status ?? '', action: params.action ?? '', owner: params.owner ?? '',
});
const sortFrom = (params: Record<string, string>): { key: SortKey; dir: 1 | -1 } => ({
  key: keys.find(k => k === params.sort) ?? 'priority', dir: params.dir === 'asc' ? 1 : -1,
});
const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(n);
const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replaceAll('-', ' ');
const PAGE = 50;
const cell = { padding: '7px 9px', fontSize: 12, verticalAlign: 'top' } as const;

export function StrategyTable({ rows, asOf, initialFilters = {}, views = [{ id: 'all', label: 'All LPs' }] }: {
  rows: StrategyTableRow[]; asOf: string; initialFilters?: Record<string, string>; views?: Array<{ id: string; label: string }>;
}) {
  const [filters, setFilters] = useState(() => filtersFrom(initialFilters));
  const [sort, setSort] = useState(() => sortFrom(initialFilters));
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const search = useRef<HTMLInputElement>(null);
  const initialKey = JSON.stringify(initialFilters);
  const previousInitial = useRef(initialKey);
  // Coverage links navigate to the same page with new filters.
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
  const updateAddress = (next: Filters, nextSort: typeof sort, push: boolean) => {
    const url = new URL(window.location.href);
    for (const key of Object.keys(EMPTY) as (keyof Filters)[]) {
      if (next[key] !== EMPTY[key]) url.searchParams.set(key, next[key]); else url.searchParams.delete(key);
    }
    url.searchParams.set('sort', nextSort.key); url.searchParams.set('dir', nextSort.dir === 1 ? 'asc' : 'desc');
    url.searchParams.delete('page');
    window.history[push ? 'pushState' : 'replaceState'](null, '', url);
  };
  const set = (key: keyof Filters, value: string) => {
    const next = { ...filters, [key]: value };
    setFilters(next); setPage(1); updateAddress(next, sort, key !== 'q');
  };
  const changeSort = (next: typeof sort) => { setSort(next); setPage(1); updateAddress(filters, next, true); };
  const filtered = useMemo(() => {
    const words = filters.q.toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter(row => (filters.view === 'all' || row.views.includes(filters.view))
      && (!filters.status || row.status === filters.status) && (!filters.action || row.group === filters.action)
      && (!filters.owner || row.owner === filters.owner)
      && words.every(word => `${row.name} ${row.action} ${row.group} ${row.status} ${row.owner}`.toLowerCase().includes(word)))
      .sort((a, b) => {
        const av = a[sort.key] ?? null, bv = b[sort.key] ?? null;
        if (av === null || bv === null) {
          if (av !== bv) return av === null ? 1 : -1;
          return b.evidencePriority - a.evidencePriority || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
        }
        const order = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
        return order * sort.dir || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
      });
  }, [rows, filters, sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const current = Math.min(page, pages);
  const shown = filtered.slice((current - 1) * PAGE, current * PAGE);
  const values = (key: 'status' | 'group' | 'owner') => [...new Set(rows.map(r => r[key]))].sort((a, b) => a.localeCompare(b));
  const toggle = (id: string) => setExpanded(before => { const next = new Set(before); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const Th = ({ column, children }: { column: SortKey; children: string }) => <SortHeader column={column} sort={sort} numeric={numeric.has(column)} onSort={changeSort}>{children}</SortHeader>;
  return <div className="strategy-action-table lp-tables">
    <TableFilters query={filters.q} onQuery={value => set('q', value)} searchRef={search} placeholder="Names, next actions, owners… /">
      <label><span>Show</span><select aria-label="Coverage" value={filters.view} onChange={e => set('view', e.target.value)}>{views.map(v => <option value={v.id} key={v.id}>{v.label}</option>)}</select></label>
      <label><span>Status</span><select aria-label="Status" value={filters.status} onChange={e => set('status', e.target.value)}><option value="">Every status</option>{values('status').map(v => <option value={v} key={v}>{label(v)}</option>)}</select></label>
      <label><span>Next action</span><select aria-label="Next action" value={filters.action} onChange={e => set('action', e.target.value)}><option value="">Every action</option>{values('group').map(v => <option key={v}>{v}</option>)}</select></label>
      <label><span>Owner</span><select aria-label="Owner" value={filters.owner} onChange={e => set('owner', e.target.value)}><option value="">Any owner</option>{values('owner').map(v => <option key={v}>{v}</option>)}</select></label>
      {JSON.stringify(filters) !== JSON.stringify(EMPTY) && <button type="button" className="btn" onClick={() => { setFilters(EMPTY); setPage(1); updateAddress(EMPTY, sort, true); }}>Clear</button>}
    </TableFilters>
    <div className="lp-selection-bar" aria-live="polite"><span>{filtered.length.toLocaleString('en-US')} of {rows.length.toLocaleString('en-US')} LPs · page {current} of {pages}</span><span>Priority: GUESS $ / team hour</span></div>
    <div className="tscroll"><table className="list lp-table" style={{ fontSize: 12 }}>
      <thead><tr><th scope="col" style={{ width: 35 }}><span className="muted">Detail</span></th><Th column="name">LP</Th><Th column="action">Next action</Th><Th column="status">Status</Th><Th column="owner">Owner</Th><Th column="evidencePriority">Evidence pts</Th><Th column="priority">$ / team h</Th><Th column="capacity">Capacity</Th><Th column="likelihood">Likelihood</Th><Th column="route">Route weight</Th><Th column="days">Effect days</Th></tr></thead>
      <tbody>{shown.map(row => <Fragment key={row.id}>
        <tr>
          <td style={cell}><button type="button" className="thsort" aria-label={`${expanded.has(row.id) ? 'Collapse' : 'Expand'} ${row.name}`} aria-expanded={expanded.has(row.id)} aria-controls={`strategy-detail-${row.id}`} onClick={() => toggle(row.id)}>{expanded.has(row.id) ? '−' : '+'}</button></td>
          <td style={cell}><Link href={row.href}><b>{row.name}</b></Link></td>
          <td style={{ ...cell, minWidth: 200, maxWidth: 360 }}><div className="strategy-action-preview">{row.action}</div><small>{row.group}</small></td>
          <td style={cell}>{label(row.status)}</td><td style={cell}>{row.owner}</td>
          <td style={cell} className="mono">{row.evidencePriority}<small>GUESS</small></td>
          <td style={cell} className="mono">{row.priority === null ? <><span>Unscored</span><small>{row.evidencePriority} evidence points</small></> : <>{money(row.priority)}<small>GUESS</small></>}</td>
          <td style={cell}>{row.capacity === null ? 'Unknown' : money(row.capacity)}</td>
          <td style={cell}>{row.likelihood === null ? 'Unknown' : `${Math.round(row.likelihood * 100)}%`}<small>GUESS</small></td>
          <td style={cell}>{row.route ?? 'Unknown'}<small>GUESS</small></td>
          <td style={cell}>{row.days === null ? 'Unknown' : `${row.days}d`}<small>GUESS</small></td>
        </tr>
        {expanded.has(row.id) && <tr id={`strategy-detail-${row.id}`}><td colSpan={11} style={{ padding: '12px 18px', background: 'var(--ground)' }}>
          <div className="lbl">Action and score basis · {row.name}</div><p>{row.action}</p>
          {row.detail.map((line, i) => <p key={i} style={{ margin: '6px 0', fontSize: 12 }}>{line}</p>)}
          {row.teamHours != null && <p style={{ margin: '6px 0', fontSize: 12 }}>Team time: {row.teamHours} hours · GUESS. Calendar days and team hours are different inputs.</p>}
          <p style={{ margin: '6px 0', fontSize: 12 }}>All ranking estimates are GUESSes. Missing or held inputs stay unscored. Evidence points order follow-up work separately and are not capital. <Link href={row.href}>Open LP strategy and source records →</Link></p>
        </td></tr>}
      </Fragment>)}</tbody>
    </table></div>
    {!filtered.length && <div className="empty"><h3>{rows.length ? 'No LPs match these filters' : 'No pursuits recorded'}</h3><p>{rows.length ? 'Clear the filters to see the recorded LPs.' : 'The raise owner can add LPs and record next actions in the pipeline.'}</p></div>}
    {pages > 1 && <div className="cbody" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><button type="button" className="btn" disabled={current === 1} onClick={() => setPage(current - 1)}>Previous</button><span>Page {current} of {pages}</span><button type="button" className="btn" disabled={current === pages} onClick={() => setPage(current + 1)}>Next</button></div>}
    <p className="cover">Search covers all {rows.length.toLocaleString('en-US')} pursuits in this vehicle’s loaded records, as of {asOf.slice(0, 10)}. No match means no match in this corpus. Evidence points describe follow-up work; priority estimates capital moved per team hour and is not a commitment or a forecast.</p>
  </div>;
}
