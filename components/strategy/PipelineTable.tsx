'use client';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Glyph } from '@/components/ui/Glyph';
import { BulkLpActions } from './BulkLpActions';
import { groupRows, SORT_KEYS, numeric, type SortKey } from './pipeline-model';
import { SortHeader, TableFilters } from './TableControls';
export type Status = 'new' | 'sourcing' | 'selected' | 'connecting' | 'discussing' | 'committed' | 'passed';

export interface PipelineRow {
  id: string;
  entityId: string;
  isOrg: boolean;
  people: Array<{ id: string; name: string; role: string }>;
  capacitySort: number | null;
  vehicleId: string;
  vehicleSlug: string;
  orgId: string | null;
  score: number | null;
  scoreKind: string;
  scoreAt: string | null;
  priority: number | null;
  capacity: string | null;
  route: number | null;
  risks: string[];
  name: string;
  /** Their organisation on record, and whether it leads the row as the LP we're targeting (issue 0013, lib/lp-heading.ts). */
  org: string | null;
  orgFirst: boolean;
  headline: string | null;
  vehicle: string;
  owner: string;
  status: Status;
  /** Passed: who and why. */
  ended: string | null;
  next: string | null;
  nextKind: string | null;
  nextOn: string | null;
  /** Affinity's word, and what it implies. */
  said: string | null;
  implied: string[];
  setHere: string | null;
  /** A meeting on record for an LP still at Selected or earlier. */
  ahead: boolean;
  doNotContact: boolean;
  money: { state: string; amount: number; wired: number; hard: boolean; signedPer: string | null } | null;
  meetings: number;
  lastMeeting: string | null;
  lastTouch: string | null;
  waitingSince: string | null;
  read: string | null;
  readOn: string | null;
  readSuggested: boolean;
  /** A later record points the other way (N57): shown struck, and not counted as their read. */
  readSuperseded: string | null;
  readOld: boolean;
  rung: number;
  /** The first rung with nothing on file: past what is accepted and what records support. */
  needs: number;
  /** 'file': a record on file supports it, and nobody has accepted it yet (N57). */
  rungs: Array<'on' | 'na' | 'off' | 'file'>;
  rungLabel: string;
}

const PAGE = 50;

const DAY = 86_400_000;
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
const usdM = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`);
const t = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);

interface Filters {
  q: string;
  owner: string;
  vehicle: string;
  meetings: 'any' | 'some' | 'none';
  touch: 'any' | 'waiting' | 'recent' | 'stale' | 'none';
  read: 'any' | 'very' | 'interested' | 'not' | 'none';
  money: 'any' | 'soft' | 'signed' | 'hard' | 'none';
  flag: 'any' | 'ahead' | 'dnc';
}
const EMPTY: Filters = { q: '', owner: '', vehicle: '', meetings: 'any', touch: 'any', read: 'any', money: 'any', flag: 'any' };

function matches(r: PipelineRow, f: Filters, words: string[], now: number): boolean {
  if (words.length) {
    const hay = `${r.name} ${r.org ?? ''} ${r.headline ?? ''} ${r.owner} ${r.vehicle} ${r.said ?? ''} ${r.next ?? ''} ${r.ended ?? ''} ${r.people.map(p => p.name).join(' ')}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) return false;
  }
  if (f.owner && r.owner !== f.owner) return false;
  if (f.vehicle && r.vehicle !== f.vehicle) return false;
  if (f.meetings === 'some' && r.meetings === 0) return false;
  if (f.meetings === 'none' && r.meetings > 0) return false;
  if (f.touch === 'waiting' && !r.waitingSince) return false;
  if (f.touch === 'recent' && !(r.lastTouch && now - t(r.lastTouch) <= 30 * DAY)) return false;
  if (f.touch === 'stale' && !(r.lastTouch && now - t(r.lastTouch) > 90 * DAY)) return false;
  if (f.touch === 'none' && r.lastTouch) return false;
  const read = r.readSuperseded ? null : r.read;
  if (f.read === 'very' && read !== 'Very interested') return false;
  if (f.read === 'interested' && read !== 'Interested') return false;
  if (f.read === 'not' && read !== 'Not very interested') return false;
  if (f.read === 'none' && read) return false;
  if (f.money === 'none' && r.money) return false;
  if (f.money === 'soft' && r.money?.state !== 'Soft') return false;
  if (f.money === 'signed' && r.money?.state !== 'Signed') return false;
  if (f.money === 'hard' && !r.money?.hard) return false;
  if (f.flag === 'ahead' && !r.ahead) return false;
  if (f.flag === 'dnc' && !r.doNotContact) return false;
  return true;
}

function Ladder({ r, names }: { r: PipelineRow; names: string[] }) {
  return (
    <>
      <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
        {r.rungs.map((s, i) => (
          <span
            key={i}
            title={names[i]}
            style={{
              width: 12, height: 6, borderRadius: 3, boxSizing: 'border-box',
              background: s === 'on' ? 'var(--green)' : s === 'na' ? 'var(--line)' : s === 'file' ? 'transparent' : '#EDEAE2',
              border: s === 'file' ? '1.5px dashed var(--green)' : undefined,
              outline: i === r.needs ? '1.5px solid var(--clay)' : undefined, outlineOffset: 1,
            }}
          />
        ))}
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 5 }}>{r.rungLabel}</div>
    </>
  );
}


interface Props {
  rows: PipelineRow[];
  statuses: Array<{ id: Status; label: string; means: string }>;
  rungNames: string[];
  initialStatus: Status | 'all' | null;
  initialFilters?: Record<string, string>;
  showVehicle: boolean;
  mode?: 'pipeline' | 'selection';
  asOf: string;
}
const choices = {
  meetings: [['any','Any'],['some','Has met'],['none','Never met']],
  touch: [['any','Any'],['recent','Last 30 days'],['stale','Over 90 days'],['waiting','Waiting'],['none','No touch']],
  read: [['any','Any'],['very','Very interested'],['interested','Interested'],['not','Not interested'],['none','No read']],
  money: [['any','Any'],['soft','Soft'],['signed','Signed'],['hard','Hard / closed'],['none','No amount']],
  flag: [['any','Any'],['ahead','Met, status behind'],['dnc','Do not contact']],
};
function fromAddress(given: Record<string, string> = {}): Filters {
  const f = { ...EMPTY };
  for (const key of Object.keys(EMPTY) as (keyof Filters)[]) {
    const value = given[key];
    if (value === undefined) continue;
    if (key in choices && !choices[key as keyof typeof choices].some(c => c[0] === value)) continue;
    (f as unknown as Record<string, string>)[key] = value;
  }
  return f;
}
function sortFrom(given: Record<string, string> = {}) {
  const key = SORT_KEYS.find(k => k === given.sort) ?? 'score';
  return { key, dir: (given.dir === 'asc' ? 1 : given.dir === 'desc' ? -1 : numeric.has(key) ? -1 : 1) as 1 | -1 };
}
export function PipelineTable({ rows, statuses, rungNames, initialStatus, initialFilters, showVehicle, mode = 'pipeline', asOf }: Props) {
  const search = useRef<HTMLInputElement>(null);
  const [f, setF] = useState(() => fromAddress(initialFilters));
  const [sort, setSort] = useState(() => sortFrom(initialFilters));
  const defaults = mode === 'selection' ? ['new','sourcing'] : [initialStatus ?? 'all'];
  const parseStatuses = (raw: string | undefined) => raw === 'all' ? statuses.map(s => s.id)
    : raw === '' ? [] : raw?.split(',').filter(s => statuses.some(x => x.id === s)) ?? (defaults.includes('all') ? statuses.map(s => s.id) : defaults);
  const [enabled, setEnabled] = useState<string[]>(() => parseStatuses(initialFilters?.status));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const words = useMemo(() => f.q.toLowerCase().split(/\s+/).filter(Boolean), [f.q]);
  const filtered = useMemo(() => rows.filter(r => matches(r, f, words, Date.parse(asOf))), [rows, f, words, asOf]);
  const inColumn = useMemo(() => filtered.filter(r => enabled.includes(r.status)), [filtered, enabled]);
  const groups = useMemo(() => groupRows(inColumn, sort.key, sort.dir), [inColumn, sort]);
  const visible = groups.slice(0, shown).flatMap(g => g.people);
  const selectedRows = rows.filter(r => selected.has(r.id));
  const count = (s: string, list = filtered) => list.filter(r => r.status === s).length;
  const active = JSON.stringify(f) !== JSON.stringify(EMPTY);
  const owners = useMemo(() => [...new Set(rows.map(r => r.owner))].sort(), [rows]);
  const vehicles = useMemo(() => [...new Set(rows.map(r => r.vehicle))].sort(), [rows]);
  const byVehicle = showVehicle && vehicles.length > 1;
  const lpHref = (r: PipelineRow) => `/${r.vehicleSlug}/pipeline/${r.id}`;
  const toggle = (ids: string[], on: boolean) => setSelected(old => {
    const next = new Set(old); for (const id of ids) if (on) next.add(id); else next.delete(id); return next;
  });
  const set = (key: keyof Filters, value: string) => setF(old => ({ ...old, [key]: value }));
  useEffect(() => setShown(PAGE), [f, enabled, sort]);
  const lastView = useRef(`${enabled.join(',')}:${sort.key}:${sort.dir}`);
  useEffect(() => {
    const u = new URL(window.location.href);
    u.searchParams.set('status', enabled.length === statuses.length ? 'all' : enabled.join(','));
    for (const key of Object.keys(EMPTY) as (keyof Filters)[]) {
      if (f[key] !== EMPTY[key]) u.searchParams.set(key, f[key]); else u.searchParams.delete(key);
    }
    u.searchParams.set('sort', sort.key); u.searchParams.set('dir', sort.dir === -1 ? 'desc' : 'asc');
    const view = `${enabled.join(',')}:${sort.key}:${sort.dir}`;
    if (u.toString() !== window.location.href) window.history[view === lastView.current ? 'replaceState' : 'pushState'](null, '', u);
    lastView.current = view;
  }, [enabled, statuses.length, sort, f]);
  useEffect(() => {
    const pop = () => {
      const params = Object.fromEntries(new URL(window.location.href).searchParams);
      setF(fromAddress(params)); setSort(sortFrom(params)); setEnabled(parseStatuses(params.status));
    };
    const key = (event: KeyboardEvent) => {
      const el = event.target instanceof HTMLElement ? event.target : null;
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || el?.closest('input,textarea,select,[contenteditable],dialog,[role="dialog"]')) return;
      event.preventDefault(); search.current?.focus();
    };
    window.addEventListener('popstate', pop); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('popstate', pop); window.removeEventListener('keydown', key); };
  }, []);
  const Th = ({ k, children }: { k: SortKey; children: string }) => <SortHeader column={k} sort={sort} numeric={numeric.has(k)} onSort={setSort}>{children}</SortHeader>;
  const all = enabled.length === statuses.length;
  return <section className="lp-tables" aria-label={mode === 'selection' ? 'LP selection' : 'LP pipeline'}>
    <div className="statusboard" aria-label="Statuses">
      {statuses.map(s => <button key={s.id} className={`sb${enabled.includes(s.id) ? ' on' : ''}`} aria-pressed={enabled.includes(s.id)} title={s.means}
        onClick={() => setEnabled(mode === 'selection' ? enabled.includes(s.id) ? enabled.filter(x => x !== s.id) : [...enabled, s.id] : [s.id])}>
        <span>{s.label}</span><b>{count(s.id).toLocaleString('en-US')}{active && <small> / {count(s.id, rows).toLocaleString('en-US')}</small>}</b>
      </button>)}
      <button className={`sb${all ? ' on' : ''}`} aria-pressed={all} onClick={() => setEnabled(statuses.map(s => s.id))}><span>All</span><b>{filtered.length.toLocaleString('en-US')}</b></button>
    </div>
    <TableFilters query={f.q} onQuery={value => set('q', value)} searchRef={search}>
      <label><span>Owner</span><select aria-label="Owner" value={f.owner} onChange={e => set('owner',e.target.value)}><option value="">Any</option>{owners.map(o => <option key={o}>{o}</option>)}</select></label>
      {byVehicle && <label><span>Vehicle</span><select aria-label="Vehicle" value={f.vehicle} onChange={e => set('vehicle',e.target.value)}><option value="">Any</option>{vehicles.map(v => <option key={v}>{v}</option>)}</select></label>}
      {(Object.entries(choices) as [keyof typeof choices, string[][]][]).map(([key, options]) => <label key={key}><span>{{ meetings: 'Meetings', touch: 'Last touch', read: 'Their read', money: 'Money', flag: 'Flags' }[key]}</span><select aria-label={key} value={f[key]} onChange={e => set(key,e.target.value)}>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>)}
      {active && <button className="btn" onClick={() => setF(EMPTY)}>Clear</button>}
    </TableFilters>
    <div className="lp-selection-bar"><span>{inColumn.length.toLocaleString('en-US')} pursuits · {groups.length.toLocaleString('en-US')} LP groups</span>
      <button className="btn" disabled={!inColumn.length} onClick={() => toggle(inColumn.map(r => r.id),true)}>Select all matching</button>
      {selected.size > 0 && <><b>{selectedRows.length} selected{selectedRows.some(r => !inColumn.includes(r)) ? ' (includes hidden rows)' : ''}</b><button className="btn" onClick={() => setSelected(new Set())}>Clear selection</button></>}
    </div>
    {selectedRows.length > 0 && <BulkLpActions key={selectedRows.map(r => r.id).sort().join(',')} rows={selectedRows} statuses={statuses} />}
    <div className="card"><div className="tscroll"><table className="list pipeline lp-table">
      <thead><tr><th><input type="checkbox" aria-label="Select visible LPs" checked={visible.length > 0 && visible.every(r => selected.has(r.id))} onChange={e => toggle(visible.map(r => r.id),e.target.checked)} /></th>
        <Th k="name">LP</Th><Th k="score">Score</Th><Th k="priority">Priority</Th>{byVehicle && <Th k="vehicle">Vehicle</Th>}<Th k="status">Status</Th><Th k="owner">Owner</Th>
        <Th k="capacity">Capacity</Th><Th k="route">Routes</Th><Th k="where">Next / money</Th><Th k="meetings">Meetings</Th><Th k="touch">Last touch</Th><Th k="read">Their read</Th><Th k="ladder">Evidence</Th>
      </tr></thead><tbody>
      {groups.slice(0,shown).map(group => {
        const first = group.people[0]!; const org = first.orgFirst && first.orgId;
        return <Fragment key={group.id}>
          {org && <tr className="lp-org"><td><input type="checkbox" aria-label={`Select ${first.org} group`} checked={group.people.every(r => selected.has(r.id))} onChange={e => toggle(group.people.map(r => r.id),e.target.checked)} /></td><th colSpan={byVehicle ? 13 : 12}><Glyph name="folder" title="Organisation" /> {first.org} <span className="muted">· {group.people.length} {group.people.length === 1 ? 'pursuit' : 'pursuits'}{byVehicle ? ` · ${first.vehicle}` : ''}</span></th></tr>}
          {group.people.map(r => <tr key={r.id} className={selected.has(r.id) ? 'lp-picked' : undefined}>
            <td><input type="checkbox" aria-label={`Select ${r.name}`} checked={selected.has(r.id)} onChange={e => toggle([r.id],e.target.checked)} /></td>
            <td className={org ? 'lp-person' : ''}><a href={lpHref(r)}><Glyph name={r.isOrg ? "folder" : "person"} title={r.isOrg ? "Organisation" : "Person"} /><b>{r.name}</b></a>{r.people.length > 0 && <details><summary>{r.people.length} affiliated people</summary>{r.people.map(p => <small key={`${p.id}:${p.role}`}><a href={`/orgs/${p.id}`}>{p.name}</a> · {p.role}</small>)}</details>}{!org && r.org && <div className="lpsecond">{r.org}</div>}{r.doNotContact && <div className="flag f-block">Do not contact</div>}</td>
            <td><b className="mono">{r.score ?? '—'}</b><small>{r.score === null ? 'Unscored' : r.scoreKind}</small>{r.scoreAt && <small>{fmt(r.scoreAt)}</small>}<a className="xref" href={`/${r.vehicleSlug}/fit/${r.entityId}`}>Fit</a> · <a className="xref" href={lpHref(r)}>Strategy</a></td>
            <td title="Existing strategy priority: capacity × likelihood × route weight × observed progress factor ÷ decision days. An ordering estimate, not committed capital."><span className="mono">{r.priority === null ? '—' : Math.round(r.priority).toLocaleString('en-US')}</span><small>{r.priority === null ? 'Held / missing inputs' : 'Estimate / day'}</small></td>
            {byVehicle && <td>{r.vehicle}</td>}<td>{statuses.find(s => s.id === r.status)?.label}</td><td>{r.owner}</td><td>{r.capacity ?? 'Unknown'}</td>
            <td><a href={`/${r.vehicleSlug}/routes?target=${r.entityId}`}><Glyph name="link" title="Recorded routes" />{r.route ?? '—'}</a></td>
            <td className="where">{r.next && <div>{r.next}{r.nextKind && <small>{r.nextKind}</small>}</div>}{r.nextOn && <small>Due {fmt(r.nextOn)}</small>}{r.money && <div>{r.money.state} {usdM(r.money.amount)}{r.money.hard && <small>{usdM(r.money.wired)} wired</small>}</div>}{r.ended && <small>{r.ended}</small>}{r.said && <small>Affinity: {r.said}</small>}{r.risks.length > 0 && <details><summary><Glyph name="question" title="Needs attention" />{r.risks.length} flags</summary>{r.risks.map((risk,i) => <small key={i}>{risk}</small>)}</details>}</td>
            <td><Glyph name="calendar" title="Meetings" />{r.meetings}<small>{fmt(r.lastMeeting)}</small></td><td>{fmt(r.lastTouch) || '—'}{r.waitingSince && <small>Waiting on them</small>}</td>
            <td>{r.readSuperseded ? <s title={r.readSuperseded}>{r.read}</s> : r.read ?? '—'}<small>{r.readSuggested ? 'Suggested · ' : ''}{fmt(r.readOn)}{r.readOld ? ' · old' : ''}</small></td>
            <td><Ladder r={r} names={rungNames} /></td>
          </tr>)}
        </Fragment>;
      })}
      </tbody></table></div>
      {!groups.length && <div className="empty"><h3>No LPs match this view</h3><p>{!enabled.length ? 'Turn on a status to show its LPs.' : rows.length ? 'Clear the search or filters, or include other statuses.' : 'No pursuits are recorded in this vehicle yet.'}</p></div>}
      {groups.length > shown && <div className="cbody"><button className="btn" onClick={() => setShown(n => n + PAGE)}>Show more LP groups ({groups.length - shown} remaining)</button></div>}
    </div>
    <p className="cover">Search covers all {rows.length.toLocaleString('en-US')} recorded pursuits in this vehicle scope, loaded {fmt(asOf)}. Dates in each row describe recorded activity; an empty result means no match in these records.</p>
    <details className="scope"><summary>How to read the scores and groups</summary><p>Score uses the existing fit assessment (0–100), or the existing provisional strategy score from capacity, affinity, propensity and decision time. Missing readings are not invented. Priority separately uses the existing strategy action score, including route evidence; held or incomplete actions have no priority. These are estimates, not approvals or forecasts.</p><p>Organisations group their recorded people within one vehicle. Groups sort by their leading matching pursuit in the chosen order; every person keeps their own score, status, evidence and actions. Status changes never advance the consent ladder.</p></details>
  </section>;
}
