'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Glyph } from '@/components/ui/Glyph';
import { formatDate } from '@/lib/time';
import {
  CHOICES, EMPTY, FILTER_LABEL, filtersFrom, haystack, matches, numeric, sortFrom, unitShown, unitsFrom, unitsOn,
  type Filters, type PipelineRow, type SortKey, type Status,
} from './pipeline-model';
import { UnitIcon } from './UnitIcon';
import s from './lp-tables.module.css';
import u from './lp-units.module.css';

/**
 * What the pipeline and selection pages share (issues 0067, 0071, 0083, 0089): the view's state
 * and its address, the filter line, the score mark and the evidence ladder. Every row arrives
 * once; search, filters and order run here, so narrowing is instant.
 */

export const fmt = (iso: string | null) => (iso ? formatDate(new Date(iso), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
export const fmtShort = (iso: string | null, now: number) => {
  if (!iso) return '';
  const d = new Date(iso);
  const sameYear = d.getUTCFullYear() === new Date(now).getUTCFullYear();
  return formatDate(d, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' as const }), timeZone: 'UTC' });
};
export const usdM = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`);
export const n = (x: number) => x.toLocaleString('en-US');
export const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');

export type StatusInfo = { id: Status; label: string; means: string };

export interface ViewOptions {
  rows: PipelineRow[];
  statuses: StatusInfo[];
  asOf: string;
  initialFilters?: Record<string, string>;
  /** Pipeline: one status at a time, or all. Selection: any set, New and Sourcing to start. */
  mode: 'pipeline' | 'selection';
  initialStatus?: Status | 'all' | null;
}

const SELECTION_DEFAULT: Status[] = ['new', 'sourcing'];

export function useLpView({ rows, statuses, asOf, initialFilters = {}, mode, initialStatus }: ViewOptions) {
  const ids = useMemo(() => statuses.map((x) => x.id), [statuses]);
  const now = useMemo(() => Date.parse(asOf), [asOf]);
  const parseStatuses = (raw: string | undefined): Status[] => {
    if (raw === 'all') return ids;
    const asked = raw?.split(',').filter((x): x is Status => ids.includes(x as Status));
    if (asked?.length) return mode === 'pipeline' ? [asked[0]!] : asked;
    if (mode === 'selection') return SELECTION_DEFAULT;
    if (initialStatus === 'all') return ids;
    if (initialStatus) return [initialStatus];
    // Open on the most advanced status with somebody in it: the work nearest money.
    const first = (['discussing', 'committed', 'connecting', 'selected', 'sourcing', 'new', 'passed'] as Status[]).find((id) => rows.some((r) => r.status === id));
    return first ? [first] : ids;
  };
  const [enabled, setEnabled] = useState<Status[]>(() => parseStatuses(initialFilters.status));
  const [f, setF] = useState<Filters>(() => filtersFrom(initialFilters));
  const [sort, setSort] = useState(() => sortFrom(initialFilters));
  const [picked, setPicked] = useState<Set<string>>(() => new Set());

  // Typing stays instant; the list catches up a frame later.
  const q = useDeferredValue(f.q);
  const hay = useMemo(() => new Map(rows.map((r) => [r.id, haystack(r)])), [rows]);
  const words = useMemo(() => q.toLowerCase().split(/\s+/).filter(Boolean), [q]);
  const deferred = useMemo(() => ({ ...f, q }), [f, q]);
  // Every filter but the Firms/Individuals toggles, so each toggle can say how many it holds (0113).
  const anyUnit = useMemo(() => rows.filter((r) => matches(r, { ...deferred, units: 'both' }, words, now, hay.get(r.id))), [rows, deferred, words, now, hay]);
  const filtered = useMemo(() => anyUnit.filter((r) => unitShown(r, deferred.units)), [anyUnit, deferred.units]);
  const shown = useMemo(() => filtered.filter((r) => enabled.includes(r.status)), [filtered, enabled]);
  const unitCounts = useMemo(() => {
    let firms = 0, individuals = 0;
    for (const r of anyUnit) if (enabled.includes(r.status)) { if (r.isOrg) firms++; else individuals++; }
    return { firms, individuals };
  }, [anyUnit, enabled]);
  const active = JSON.stringify(f) !== JSON.stringify(EMPTY);
  const counts = useMemo(() => {
    const all = new Map<Status, number>(), matching = new Map<Status, number>();
    for (const r of rows) all.set(r.status, (all.get(r.status) ?? 0) + 1);
    for (const r of filtered) matching.set(r.status, (matching.get(r.status) ?? 0) + 1);
    return { all, matching };
  }, [rows, filtered]);

  // The status, the filters and the order live in the address (N62), so a link opens this exact
  // view and back returns to the last one. A new status set or order is a new history entry;
  // typing in the search or setting a filter replaces the entry instead of piling them up.
  const lastView = useRef('');
  useEffect(() => {
    const u = new URL(window.location.href);
    u.searchParams.set('status', enabled.length === ids.length ? 'all' : enabled.join(','));
    for (const key of Object.keys(EMPTY) as (keyof Filters)[]) {
      if (f[key] !== EMPTY[key]) u.searchParams.set(key, f[key]); else u.searchParams.delete(key);
    }
    u.searchParams.set('sort', sort.key);
    u.searchParams.set('dir', sort.dir === -1 ? 'desc' : 'asc');
    const view = `${enabled.join(',')}:${sort.key}:${sort.dir}`;
    const first = lastView.current === '';
    if (u.toString() !== window.location.href) window.history[first || view === lastView.current ? 'replaceState' : 'pushState'](window.history.state, '', u);
    lastView.current = view;
  }, [enabled, ids.length, sort, f]);
  useEffect(() => {
    const pop = () => {
      const params = Object.fromEntries(new URL(window.location.href).searchParams);
      const next = parseStatuses(params.status), order = sortFrom(params);
      lastView.current = `${next.join(',')}:${order.key}:${order.dir}`;
      setF(filtersFrom(params)); setSort(order); setEnabled(next);
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
    // parseStatuses reads only stable inputs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setF((old) => ({ ...old, [key]: value }));
  const sortBy = (key: SortKey) => setSort((old) => (old.key === key ? { key, dir: old.dir === 1 ? -1 : 1 } : { key, dir: numeric.has(key) ? -1 : 1 }));
  const pick = (ids: string[], on: boolean) => setPicked((old) => {
    const next = new Set(old);
    for (const id of ids) if (on) next.add(id); else next.delete(id);
    return next;
  });
  const pickedRows = useMemo(() => rows.filter((r) => picked.has(r.id)), [rows, picked]);

  return {
    ids, now, enabled, setEnabled, f, setF, set, active, sort, setSort, sortBy, filtered, shown, counts, unitCounts,
    picked, pick, pickedRows, clearPicked: () => setPicked(new Set()),
  };
}
export type LpView = ReturnType<typeof useLpView>;

/** "/" searches, unless it is being typed into a field or a dialog (issue 0014, real). */
export function useSlashSearch() {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.closest('dialog, [role="dialog"]'))) return;
      e.preventDefault();
      ref.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return ref;
}

/** The search box and thin, labelled dropdowns, on one line while the page is wide enough. */
export function FilterLine({ view, rows, showVehicle, keys, placeholder }: {
  view: LpView; rows: PipelineRow[]; showVehicle: boolean; keys: Array<keyof typeof CHOICES>; placeholder: string;
}) {
  const search = useSlashSearch();
  const owners = useMemo(() => [...new Set(rows.map((r) => r.owner))].sort(), [rows]);
  const vehicles = useMemo(() => [...new Set(rows.map((r) => r.vehicle))].sort(), [rows]);
  const { f, set } = view;
  return (
    <div className={s.filters} role="search">
      <label className={s.search}>
        <span>Search</span>
        <span className={s.searchIcon} aria-hidden><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="7" cy="7" r="4" /><path d="M10 10l3.5 3.5" /></svg></span>
        <input ref={search} type="search" value={f.q} onChange={(e) => set('q', e.target.value)} placeholder={placeholder} aria-label="Search LPs" enterKeyHint="search" />
      </label>
      <label className={cx(s.field, f.owner && s.set)}>
        <span className={s.fieldLabel}>Owner</span>
        <select value={f.owner} onChange={(e) => set('owner', e.target.value)} aria-label="Owner">
          <option value="">Any</option>
          {owners.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
      {showVehicle && vehicles.length > 1 && (
        <label className={cx(s.field, f.vehicle && s.set)}>
          <span className={s.fieldLabel}>Vehicle</span>
          <select value={f.vehicle} onChange={(e) => set('vehicle', e.target.value)} aria-label="Vehicle">
            <option value="">Any</option>
            {vehicles.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
      )}
      {/* Firms and Individuals (issue 0113): both on to start; each says how many it holds. */}
      <div className={u.units} role="group" aria-label="Show firms and individuals">
        <span className={u.unitLabel} aria-hidden>Show</span>
        <div className={u.unitButtons}>
          {([['firms', 'Firms', true], ['individuals', 'Individuals', false]] as const).map(([key, label, org]) => {
            const on = unitsOn(f.units)[key];
            const next = { ...unitsOn(f.units), [key]: !on };
            return (
              <button key={key} type="button" className={u.unitBtn} aria-pressed={on}
                title={on ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
                onClick={() => set('units', unitsFrom(next.firms, next.individuals))}>
                <UnitIcon org={org} size={12} />{label} <b>{n(view.unitCounts[key])}</b>
              </button>
            );
          })}
        </div>
      </div>
      {keys.map((key) => (
        <label key={key} className={cx(s.field, f[key] !== EMPTY[key] && s.set)}>
          <span className={s.fieldLabel}>{FILTER_LABEL[key]}</span>
          <select value={f[key]} onChange={(e) => set(key, e.target.value as Filters[typeof key])} aria-label={FILTER_LABEL[key]}>
            {CHOICES[key].map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      ))}
      {view.active && <button type="button" className={s.clear} onClick={() => view.setF(EMPTY)}>Clear</button>}
    </div>
  );
}

const tone = (score: number) => (score >= 70 ? s.hi : score >= 45 ? s.mid : undefined);
/** A score and where it came from. Unscored is said, never drawn as a zero. */
export function ScoreMark({ r, href }: { r: PipelineRow; href: string }) {
  if (r.score === null) return <div className={s.score}><span className={cx(s.scoreNum, s.none)}>—</span><span className={s.scoreKind}>Unscored</span></div>;
  const stale = /stale/i.test(r.scoreKind);
  const title = `${r.scoreKind}${r.scoreAt ? `, ${fmt(r.scoreAt)}` : ''}. Describes the evidence on file, not a probability of commitment.`;
  return (
    <div className={s.score}>
      <a className={s.scoreNum} href={href} title={title} onClick={(e) => e.stopPropagation()}>{r.score}</a>
      <span className={s.bar} aria-hidden><i className={tone(r.score)} style={{ width: `${r.score}%` }} /></span>
      <span className={cx(s.scoreKind, stale && s.stale)}>{r.scoreKind.startsWith('Fit') ? 'Fit' : stale ? 'Provisional, stale' : 'Provisional'}</span>
    </div>
  );
}
export const scoreTone = tone;

export function Ladder({ r, names }: { r: PipelineRow; names: string[] }) {
  return (
    <>
      <div className={s.ladder} role="img" aria-label={`Evidence: ${r.rungLabel}`}>
        {r.rungs.map((x, i) => <span key={i} title={names[i]} className={cx(x !== 'off' && s[x], i === r.needs && s.needs)} />)}
      </div>
      <div className={s.ladderLabel}>{r.rungLabel}</div>
    </>
  );
}

/** A count that opens to a list; closed, the list isn't in the page, so a long table stays light. */
export function Disclose({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={s.flags}>
      <button type="button" className={s.flagsBtn} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '▾' : '▸'} {label}</button>
      {open && children}
    </div>
  );
}
export function Flags({ r, href }: { r: PipelineRow; href: string }) {
  if (!r.riskCount) return null;
  return (
    <Disclose label={`${n(r.riskCount)} ${r.riskCount === 1 ? 'flag' : 'flags'}`}>
      <ul>
        {r.risks.map((x, i) => <li key={i}>{x}</li>)}
        {r.riskCount > r.risks.length && <li>and {n(r.riskCount - r.risks.length)} more on the <a href={href}>LP&rsquo;s page</a></li>}
      </ul>
    </Disclose>
  );
}

export function Icon({ name, title }: { name: Parameters<typeof Glyph>[0]['name']; title: string }) {
  return <span className={s.ico}><Glyph name={name} title={title} /></span>;
}

/**
 * The selected LPs' actions live in the right-hand pane when the page has one open (Juan, 0067:
 * "all of these actions maybe could come via the right sidebar"); otherwise in the page itself.
 */
export function InPane({ slot, children }: { slot: string; children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const find = () => setTarget(document.getElementById(slot));
    find();
    // The pane can be closed and reopened; follow it.
    const body = document.querySelector('.body');
    if (!body) return;
    const watch = new MutationObserver(find);
    watch.observe(body, { childList: true });
    return () => watch.disconnect();
  }, [slot]);
  return target ? createPortal(children, target) : <>{children}</>;
}
