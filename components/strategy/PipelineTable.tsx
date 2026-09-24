'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useVehicleSlug } from '@/components/shell/Here';
import { canonicalPath } from '@/lib/paths';
import { moveMetToDiscussing } from '@/app/targets/actions';

/**
 * The pipeline, as one interactive list (N54). Every pursuit in scope arrives once; the status
 * columns, the search, the filters and the sort all run here, so narrowing is instant and the
 * column counts change with it — "12 of 58" — instead of each click asking the server again.
 */

export type Status = 'new' | 'sourcing' | 'selected' | 'connecting' | 'discussing' | 'committed' | 'passed';

export interface PipelineRow {
  id: string;
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

interface Props {
  rows: PipelineRow[];
  statuses: Array<{ id: Status; label: string; means: string }>;
  rungNames: string[];
  initialStatus: Status | null;
  /** Filters from the address, read by the server (N62), so a link opens the view it names. */
  initialFilters?: Record<string, string>;
  showVehicle: boolean;
  /**
   * Columns whose rows weren't sent, with the server's count (issue 0023, real): Sourcing holds
   * thousands of LPs, and sending them made this page 1.5 MB. Opening one asks the server for it.
   */
  heldBack?: Partial<Record<Status, number>>;
}

const CHOICES: Partial<Record<keyof Filters, readonly string[]>> = {
  meetings: ['any', 'some', 'none'], touch: ['any', 'waiting', 'recent', 'stale', 'none'],
  read: ['any', 'very', 'interested', 'not', 'none'], money: ['any', 'soft', 'signed', 'hard', 'none'], flag: ['any', 'ahead', 'dnc'],
};
/** Only values the filters have: an address someone edited by hand can't put the table in a state it can't show. */
function fromAddress(given: Record<string, string> | undefined): Filters {
  const f: Filters = { ...EMPTY };
  for (const [k, v] of Object.entries(given ?? {})) {
    if (!(k in EMPTY)) continue;
    const ok = CHOICES[k as keyof Filters];
    if (ok && !ok.includes(v)) continue;
    (f as unknown as Record<string, string>)[k] = v;
  }
  return f;
}

type SortKey = 'rank' | 'name' | 'vehicle' | 'owner' | 'where' | 'meetings' | 'touch' | 'read' | 'ladder';
const SORT_KEYS: readonly SortKey[] = ['rank', 'name', 'vehicle', 'owner', 'where', 'meetings', 'touch', 'read', 'ladder'];
type Sort = { key: SortKey; dir: 1 | -1 };
/** The order in the address (issue 0009): `sort=<key>`, `dir=desc` — rank, ascending, when neither is there. */
function sortFrom(given: Record<string, string | null> | undefined): Sort {
  const key = SORT_KEYS.find((k) => k === given?.sort) ?? 'rank';
  return { key, dir: given?.dir === 'desc' ? -1 : 1 };
}
const READ_ORDER: Record<string, number> = { 'Very interested': 3, Interested: 2, 'Not very interested': 1 };
const MONEY_ORDER: Record<string, number> = { Closed: 4, Hard: 3, Signed: 2, Soft: 1, Withdrawn: 0 };
const PAGE = 200;

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

/** The name that leads an LP's row (issue 0013). */
const lead = (r: PipelineRow) => (r.orgFirst && r.org ? r.org : r.name);

function matches(r: PipelineRow, f: Filters, words: string[], now: number): boolean {
  if (words.length) {
    const hay = `${r.name} ${r.org ?? ''} ${r.headline ?? ''} ${r.owner} ${r.vehicle} ${r.said ?? ''} ${r.next ?? ''} ${r.ended ?? ''}`.toLowerCase();
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

export function PipelineTable({ rows, statuses, rungNames, initialStatus, initialFilters, showVehicle, heldBack = {} }: Props) {
  const router = useRouter();
  // The LP page at its own address, not the old one the proxy redirects (issues 0027–0028).
  const vehicle = useVehicleSlug();
  const lpHref = (id: string) => canonicalPath(`/targets/${id}`, vehicle);
  const search = useRef<HTMLInputElement>(null);
  const [f, setF] = useState<Filters>(() => fromAddress(initialFilters));
  const [sort, setSort] = useState<Sort>(() => sortFrom(initialFilters));
  const [shown, setShown] = useState(PAGE);
  const now = useMemo(() => Date.now(), []);

  const words = useMemo(() => f.q.toLowerCase().split(/\s+/).filter(Boolean), [f.q]);
  const filtered = useMemo(() => rows.filter((r) => matches(r, f, words, now)), [rows, f, words, now]);
  const active = JSON.stringify(f) !== JSON.stringify(EMPTY);
  const count = (s: Status, list: PipelineRow[]) => list.reduce((a, r) => a + (r.status === s ? 1 : 0), 0);

  // Open on the asked-for column, or the first with somebody in it, most advanced first.
  const firstFull = (['discussing', 'committed', 'connecting', 'selected', 'sourcing', 'new', 'passed'] as Status[]).find((s) => count(s, rows) > 0) ?? 'discussing';
  const [status, setStatus] = useState<Status>(initialStatus ?? firstFull);

  // The column, the search and every filter live in the address (N62), so a link — from the
  // overview's counts, or sent to someone — opens this exact view, and back returns to it.
  // A new column or a new order is a new view, with its own history entry (N65): back returns to
  // the last one. Typing in the search or setting a filter replaces the entry instead of piling
  // them up.
  const lastView = useRef(`${status} ${sort.key} ${sort.dir}`);
  useEffect(() => {
    const u = new URL(window.location.href);
    u.searchParams.set('status', status);
    for (const k of Object.keys(EMPTY) as (keyof Filters)[]) {
      if (f[k] !== EMPTY[k]) u.searchParams.set(k, f[k]); else u.searchParams.delete(k);
    }
    if (sort.key !== 'rank') u.searchParams.set('sort', sort.key); else u.searchParams.delete('sort');
    if (sort.dir === -1) u.searchParams.set('dir', 'desc'); else u.searchParams.delete('dir');
    if (u.toString() === window.location.href) return;
    const view = `${status} ${sort.key} ${sort.dir}`;
    const moved = lastView.current !== view;
    lastView.current = view;
    window.history[moved ? 'pushState' : 'replaceState'](null, '', u.toString());
  }, [status, f, sort]);
  // Back or forward to another column or order: follow the address.
  useEffect(() => {
    const onPop = () => {
      const q = new URL(window.location.href).searchParams;
      const s = q.get('status') as Status | null;
      const next = sortFrom({ sort: q.get('sort'), dir: q.get('dir') });
      const st = s && statuses.some((x) => x.id === s) ? s : null;
      lastView.current = `${st ?? status} ${next.key} ${next.dir}`;
      if (st) setStatus(st);
      setSort(next);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [statuses, status]);
  useEffect(() => {
    // "/" searches, unless it is being typed: into any field — a textarea or an editable box as well
    // as an input — or anywhere inside an open dialog. The feedback box's text took its slashes to
    // the search box behind it, and the words after them too (issue 0014, real).
    const typing = (e: KeyboardEvent) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (!el) return false;
      return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || Boolean(el.closest('dialog, [role="dialog"]'));
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || typing(e)) return;
      e.preventDefault();
      search.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => setShown(PAGE), [status, f, sort]);

  const inColumn = useMemo(() => {
    const list = filtered.filter((r) => r.status === status);
    const k = sort.key;
    const by = (a: PipelineRow, b: PipelineRow): number => {
      switch (k) {
        // By the name that leads the row: the organisation's when it is the LP we're targeting.
        case 'name': return lead(a).localeCompare(lead(b));
        case 'vehicle': return a.vehicle.localeCompare(b.vehicle) || a.name.localeCompare(b.name);
        case 'owner': return a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name);
        case 'where': return (MONEY_ORDER[b.money?.state ?? ''] ?? -1) - (MONEY_ORDER[a.money?.state ?? ''] ?? -1)
          || (b.money?.amount ?? 0) - (a.money?.amount ?? 0) || (t(a.nextOn) || Infinity) - (t(b.nextOn) || Infinity);
        case 'meetings': return b.meetings - a.meetings || t(b.lastMeeting) - t(a.lastMeeting);
        case 'touch': return t(b.lastTouch) - t(a.lastTouch);
        case 'read': return (READ_ORDER[(b.readSuperseded ? null : b.read) ?? ''] ?? 0) - (READ_ORDER[(a.readSuperseded ? null : a.read) ?? ''] ?? 0) || t(b.readOn) - t(a.readOn);
        case 'ladder': return b.rung - a.rung;
        default: return 0; // 'rank': the server's order — evidence, meetings, the source's word, recency
      }
    };
    return k === 'rank' ? (sort.dir === 1 ? list : [...list].reverse()) : [...list].sort((a, b) => by(a, b) * sort.dir);
  }, [filtered, status, sort]);

  const owners = useMemo(() => [...new Set(rows.map((r) => r.owner))].sort(), [rows]);
  const vehicles = useMemo(() => [...new Set(rows.map((r) => r.vehicle))].sort(), [rows]);
  // A vehicle column that says the same thing on every row is noise.
  const byVehicle = showVehicle && vehicles.length > 1;
  const info = statuses.find((s) => s.id === status)!;

  const Th = ({ k, children, width }: { k: SortKey; children: string; width?: number }) => {
    const on = sort.key === k;
    return (
      <th style={width ? { width } : undefined} aria-sort={on ? (sort.dir === 1 ? 'descending' : 'ascending') : 'none'}>
        <button className={`thsort${on ? ' on' : ''}`} onClick={() => setSort(on ? { key: k, dir: sort.dir === 1 ? -1 : 1 } : { key: k, dir: 1 })}>
          {children}{on ? (sort.dir === 1 ? ' ↓' : ' ↑') : ''}
        </button>
      </th>
    );
  };
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((x) => ({ ...x, [k]: v }));

  return (
    <>
      <div className="statusboard" role="tablist" aria-label="Status">
        {statuses.map((s) => {
          const held = heldBack[s.id];
          const n = held ?? count(s.id, filtered);
          const m = held ?? count(s.id, rows);
          return (
            <button
              key={s.id}
              className={`sb${s.id === status ? ' on' : ''}${s.id === 'passed' ? ' ended' : ''}`}
              role="tab"
              aria-selected={s.id === status}
              title={held !== undefined ? `${s.means} Opening it asks the server for its ${held.toLocaleString('en-US')} rows; the filters apply once it's open.` : s.means}
              onClick={() => {
                if (held === undefined) { setStatus(s.id); return; }
                const u = new URL(window.location.href);
                u.searchParams.set('status', s.id);
                router.push(`${u.pathname}${u.search}`);
              }}
            >
              <span className="lbl">{s.label}</span>
              <span className="n">
                {n.toLocaleString('en-US')}
                {active && held === undefined && <span className="of"> of {m.toLocaleString('en-US')}</span>}
              </span>
            </button>
          );
        })}
      </div>

      <div className="pfilters">
        <input
          ref={search}
          type="search"
          value={f.q}
          onChange={(e) => set('q', e.target.value)}
          placeholder="Search names, owners, Affinity words, next steps…  ( / )"
          aria-label="Search the pipeline"
        />
        <select value={f.owner} onChange={(e) => set('owner', e.target.value)} aria-label="Owner">
          <option value="">Any owner</option>
          {owners.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        {byVehicle && (
          <select value={f.vehicle} onChange={(e) => set('vehicle', e.target.value)} aria-label="Vehicle">
            <option value="">Any vehicle</option>
            {vehicles.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
        <select value={f.meetings} onChange={(e) => set('meetings', e.target.value as Filters['meetings'])} aria-label="Meetings">
          <option value="any">Meetings: any</option>
          <option value="some">Has met</option>
          <option value="none">Never met</option>
        </select>
        <select value={f.touch} onChange={(e) => set('touch', e.target.value as Filters['touch'])} aria-label="Last touch">
          <option value="any">Last touch: any</option>
          <option value="recent">In the last 30 days</option>
          <option value="stale">Over 90 days ago</option>
          <option value="waiting">Waiting on them</option>
          <option value="none">Never touched</option>
        </select>
        <select value={f.read} onChange={(e) => set('read', e.target.value as Filters['read'])} aria-label="Their read">
          <option value="any">Their read: any</option>
          <option value="very">Very interested</option>
          <option value="interested">Interested</option>
          <option value="not">Not very interested</option>
          <option value="none">No read</option>
        </select>
        <select value={f.money} onChange={(e) => set('money', e.target.value as Filters['money'])} aria-label="Money">
          <option value="any">Money: any</option>
          <option value="soft">Soft</option>
          <option value="signed">Signed</option>
          <option value="hard">Hard or closed</option>
          <option value="none">No amount</option>
        </select>
        <select value={f.flag} onChange={(e) => set('flag', e.target.value as Filters['flag'])} aria-label="Flags">
          <option value="any">Flags: any</option>
          <option value="ahead">Met, status behind</option>
          <option value="dnc">Do not contact</option>
        </select>
        {active && <button className="btn" onClick={() => setF(EMPTY)}>Clear</button>}
      </div>

      <div className="card">
        <div className="chead">
          <h2>{info.label}</h2>
          <span className="lbl">
            {inColumn.length.toLocaleString('en-US')}
            {active ? ` of ${count(status, rows).toLocaleString('en-US')}` : ''} · {info.means}
          </span>
        </div>
        {f.flag === 'ahead' && inColumn.length > 0 && (status === 'new' || status === 'sourcing' || status === 'selected' || status === 'connecting') && (
          // The log got ahead of the status (N57): move them, as one person's decision per LP.
          <form action={moveMetToDiscussing} className="bulkbar">
            {inColumn.map((r) => <input type="hidden" name="pursuitId" value={r.id} key={r.id} />)}
            <span>{inColumn.length === 1 ? 'This LP has met us and is' : `These ${inColumn.length} LPs have met us and are`} still at {info.label}.</span>
            <input name="note" type="text" aria-label="A note on each change" placeholder="A note on each change · optional" style={{ width: 260 }} />
            <button className="btn p" type="submit">Move {inColumn.length === 1 ? 'it' : `all ${inColumn.length}`} to Discussing</button>
            <span className="muted">One status change each, in the audit log, keeping each next step. No rung moves and no ticket is needed: a status claims nothing.</span>
          </form>
        )}
        {inColumn.length === 0 ? (
          <div className="cbody">
            <div className="empty">
              <span className="stat unavailable"><i />Nobody here</span>
              <h3>{active ? `No LP at ${info.label} matches.` : `No LP is at ${info.label}.`}</h3>
              <p>{active ? 'The filters or the search leave this column empty; the other columns show what they do match.' : 'An empty column, not a failed read.'}</p>
            </div>
          </div>
        ) : (
          // A narrow window scrolls the table inside its card rather than painting the evidence
          // column past the card's edge (issue 0012, real).
          <div className="tscroll">
          <table className="list pipeline">
            <thead>
              <tr>
                <Th k="name">LP</Th>
                {byVehicle && <Th k="vehicle" width={120}>Vehicle</Th>}
                <Th k="owner" width={96}>Owner</Th>
                <Th k="where">Where</Th>
                <Th k="meetings" width={78}>Meetings</Th>
                <Th k="touch" width={96}>Last touch</Th>
                <Th k="read" width={104}>Their read</Th>
                <Th k="ladder" width={128}>Evidence</Th>
              </tr>
            </thead>
            <tbody>
              {inColumn.slice(0, shown).map((r) => (
                <tr
                  key={r.id}
                  className="clickable"
                  tabIndex={0}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('a')) return;
                    if (e.metaKey || e.ctrlKey) window.open(lpHref(r.id), '_blank');
                    else router.push(lpHref(r.id));
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') router.push(lpHref(r.id)); }}
                >
                  <td>
                    <a href={lpHref(r.id)}><b>{lead(r)}</b></a>
                    {r.doNotContact && <span className="flag f-block" style={{ marginLeft: 6 }}>do not contact</span>}
                    {r.org && <div className="lpsecond">{r.orgFirst ? r.name : r.org}</div>}
                    {r.headline && <div className="muted" style={{ fontSize: 11.5 }}>{r.headline}</div>}
                  </td>
                  {byVehicle && <td className="muted">{r.vehicle}</td>}
                  <td className="muted">{r.owner}</td>
                  <td className="where" style={{ fontSize: 12 }}>
                    {r.money && (
                      <div>
                        {r.money.state} {usdM(r.money.amount)}
                        {r.money.signedPer && <span className="muted"> · signed {r.money.signedPer}</span>}
                        {r.money.hard && <span className="muted"> · {usdM(r.money.wired)} wired</span>}
                      </div>
                    )}
                    {r.ended && <div>{r.ended}</div>}
                    {r.next && <div>Next: {r.next}{r.nextOn ? `, ${fmt(r.nextOn)}` : ''}</div>}
                    {r.ahead && <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>A meeting is on record — Discussing?</div>}
                    {r.said && (
                      <div className="muted" style={{ fontSize: 11.5 }}>
                        Affinity: &ldquo;{r.said}&rdquo;{r.implied.length ? ` — ${r.implied.join(', ')}` : ''}
                      </div>
                    )}
                    {r.setHere && <div className="muted" style={{ fontSize: 11.5 }}>{r.setHere}</div>}
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>
                    {r.meetings || <span className="muted">—</span>}
                    {r.lastMeeting && <div className="muted" style={{ fontSize: 10.5 }}>{fmt(r.lastMeeting)}</div>}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {r.lastTouch ? fmt(r.lastTouch) : <span className="muted">—</span>}
                    {r.waitingSince && <div className="muted" style={{ fontSize: 10.5 }}>waiting on them</div>}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {r.read && r.readSuperseded ? (
                      <s className="muted" title={`Superseded: since then, ${r.readSuperseded}`}>{r.read}</s>
                    ) : r.read ? (
                      <span className={r.readSuggested ? 'suggested' : undefined} title={r.readSuggested ? 'Suggested from a note; nobody has confirmed it' : undefined}>{r.read}</span>
                    ) : <span className="muted">—</span>}
                    {r.readOn && <div className="muted" style={{ fontSize: 10.5 }}>{fmt(r.readOn)}{r.readSuperseded ? ' · superseded' : r.readSuggested ? ' · suggested' : ''}{r.readOld && !r.readSuperseded ? ' · old' : ''}</div>}
                  </td>
                  <td><Ladder r={r} names={rungNames} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
        {inColumn.length > shown && (
          <div className="cbody" style={{ borderTop: '1px solid var(--hair)' }}>
            <button className="btn" onClick={() => setShown((n) => n + PAGE)}>
              Show {Math.min(PAGE, inColumn.length - shown)} more of {(inColumn.length - shown).toLocaleString('en-US')}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
