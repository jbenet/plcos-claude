'use client';

import { Pager, usePage } from '@/components/floor/Paging';
import Link from '@/components/ui/AppLink';
import { useMemo, useState } from 'react';
import { Glyph } from '@/components/ui/Glyph';
import { LANE_LOOK, orderDatedRows, type DatedRow, type LaneLook } from '@/lib/lanes';
import s from './DatedList.module.css';
import { formatDate } from '@/lib/time';

/**
 * Every dated thing, filtered as you type (issues 0020, 0072): a search over what, who, LP and
 * vehicle; a chip per lane; standing, LP and our-team filters; newest first by default, with the
 * direction one tap away, and the When, LP and Our team headers sort the list. Tight rows carry
 * their lane's icon and colour. A detail that only repeats the standing ("Held.") is not printed.
 */
const STANDING: Record<DatedRow['standing'], { label: string; flag: string }> = {
  pressing: { label: 'Pressing', flag: 'f-block' },
  ahead: { label: 'Ahead', flag: 'f-ev' },
  done: { label: 'Done', flag: 'f-mute' },
};

type Sort = 'date' | 'lp' | 'team';
const day = (iso: string) => formatDate(new Date(iso), { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** The label without the LP's name, which has its own column: "Fernhollow Umberfield Trust — meeting" reads "Meeting". */
function what(r: DatedRow): string {
  if (!r.lp) return r.label;
  const esc = r.lp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const out = r.label.replace(new RegExp(`^${esc}\\s+[—-]\\s+`), '').replace(new RegExp(`\\s+[—-]\\s+${esc}$`), '');
  return out === r.label || !out ? r.label : out.charAt(0).toUpperCase() + out.slice(1);
}

export function DatedList({ rows, vehicles }: { rows: DatedRow[]; vehicles: string[] }) {
  const [q, setQ] = useState('');
  const [lanes, setLanes] = useState<Set<string>>(new Set());
  const [standing, setStanding] = useState<'all' | DatedRow['standing']>('all');
  const [vehicle, setVehicle] = useState('all');
  const [team, setTeam] = useState('all');
  const [lp, setLp] = useState('all');
  const [sort, setSort] = useState<Sort>('date');
  const [ascending, setAscending] = useState(false);
  const teams = useMemo(() => [...new Set(rows.flatMap((r) => r.team ?? []))].sort(), [rows]);
  const lps = useMemo(() => [...new Set(rows.flatMap((r) => (r.lp ? [r.lp] : [])))].sort(), [rows]);

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = useMemo(() => orderDatedRows(rows.filter((r) => {
    if (lanes.size && !lanes.has(r.lane)) return false;
    if (standing !== 'all' && r.standing !== standing) return false;
    if (vehicle !== 'all' && r.vehicle !== vehicle) return false;
    if (team !== 'all' && !(r.team ?? []).includes(team)) return false;
    if (lp !== 'all' && r.lp !== lp) return false;
    if (!words.length) return true;
    const hay = `${r.label} ${(r.team ?? []).join(' ')} ${r.lp ?? ''} ${r.detail ?? ''} ${r.vehicle ?? ''} ${LANE_LOOK[r.lane].label}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  }), sort, ascending), [rows, lanes, standing, vehicle, team, lp, sort, ascending, words.join(' ')]); // eslint-disable-line react-hooks/exhaustive-deps

  const paging = usePage(shown);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const r of rows) c.set(r.lane, (c.get(r.lane) ?? 0) + 1);
    return c;
  }, [rows]);
  const reset = () => paging.setPage(0);
  const toggle = (lane: string) => { reset(); setLanes((prev) => {
    const next = new Set(prev);
    if (next.has(lane)) next.delete(lane); else next.add(lane);
    return next;
  }); };
  const present = (Object.entries(LANE_LOOK) as Array<[string, LaneLook]>).filter(([lane]) => counts.get(lane));
  /** A header sorts by its column; tapping the active one reverses it. Dates start newest first, names A–Z. */
  const sortBy = (next: Sort) => {
    reset();
    if (next === sort) setAscending(!ascending);
    else { setSort(next); setAscending(next !== 'date'); }
  };
  const dir = (col: Sort) => (sort === col ? (ascending ? 'ascending' : 'descending') : 'none');
  const arrow = (col: Sort) => (sort === col ? (ascending ? ' ↑' : ' ↓') : '');
  const filtered = standing !== 'all' || vehicle !== 'all' || team !== 'all' || lp !== 'all' || lanes.size > 0 || words.length > 0;

  return (
    <>
      <div className={s.box}>
      <div className={`dfilters ${s.filters}`}>
        <input
          type="search"
          value={q}
          onChange={(e) => { setQ(e.target.value); reset(); }}
          placeholder="Search what, who, LP, vehicle…"
          aria-label="Search the dated things"
        />
        <select value={lp} onChange={(e) => { setLp(e.target.value); reset(); }} aria-label="LP">
          <option value="all">Every LP</option>
          {lps.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select value={team} onChange={(e) => { setTeam(e.target.value); reset(); }} aria-label="Our team">
          <option value="all">Anyone on our team</option>
          {teams.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <select value={standing} onChange={(e) => { setStanding(e.target.value as typeof standing); reset(); }} aria-label="Standing">
          <option value="all">Any standing</option>
          <option value="ahead">Ahead</option>
          <option value="pressing">Pressing</option>
          <option value="done">Done</option>
        </select>
        {vehicles.length > 1 && (
          <select value={vehicle} onChange={(e) => { setVehicle(e.target.value); reset(); }} aria-label="Vehicle">
            <option value="all">Every vehicle</option>
            {vehicles.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
        <div className="dchips" role="group" aria-label="Lanes">
          {present.map(([lane, look]) => (
            <button
              key={lane}
              type="button"
              className={`dchip lane-${lane}${lanes.has(lane) ? ' on' : ''}`}
              aria-pressed={lanes.has(lane)}
              onClick={() => toggle(lane)}
              title={look.means}
            >
              <Glyph name={look.glyph} title={look.label} /> {look.label} <span className="n">{counts.get(lane)}</span>
            </button>
          ))}
          <span className={s.right}>
            {/* Where the LP and team columns fold under the label, their sort is here instead. */}
            <select className={s.sortSelect} value={sort} aria-label="Sort by"
              onChange={(e) => { reset(); const next = e.target.value as Sort; setSort(next); setAscending(next !== 'date'); }}>
              <option value="date">By date</option>
              <option value="lp">By LP, A–Z</option>
              <option value="team">By our team, A–Z</option>
            </select>
            <span className={s.count}>{filtered ? `${shown.length} of ${rows.length}` : `${rows.length} rows`}</span>
            <span className={s.seg} role="group" aria-label="Order by date">
              <button type="button" aria-pressed={sort === 'date' && !ascending} onClick={() => { reset(); setSort('date'); setAscending(false); }}>Newest first</button>
              <button type="button" aria-pressed={sort === 'date' && ascending} onClick={() => { reset(); setSort('date'); setAscending(true); }}>Oldest first</button>
            </span>
          </span>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="muted" style={{ padding: '10px 18px' }}>Nothing matches the search and filters; the other rows are still there.</p>
      ) : (
        <>
          <div className={s.scroll}>
            <table className={`list dated ${s.table}`}>
              <thead>
                <tr>
                  <th className={s.when} aria-sort={dir('date')}><button type="button" onClick={() => sortBy('date')}>When{arrow('date')}</button></th>
                  <th>What</th>
                  <th className={s.lp} aria-sort={dir('lp')}><button type="button" onClick={() => sortBy('lp')}>LP{arrow('lp')}</button></th>
                  <th className={s.team} aria-sort={dir('team')}><button type="button" onClick={() => sortBy('team')}>Our team{arrow('team')}</button></th>
                  {vehicles.length > 1 && <th className={s.veh}>Vehicle</th>}
                  <th className={s.standing}>Standing</th>
                </tr>
              </thead>
              <tbody>
                {paging.rows.map((r) => {
                  const look = LANE_LOOK[r.lane];
                  return (
                    <tr key={r.id} className={`lane-${r.lane}`}>
                      <td className="mono dwhen">
                        {day(r.from)}
                        {r.to && <span className="muted"> → {day(r.to)}</span>}
                      </td>
                      <td>
                        <span className="dwhat">
                          <Glyph name={look.glyph} title={look.label} tone={r.standing === 'pressing' ? 'stop' : undefined} />
                          {r.href ? <Link href={r.href}>{what(r)}</Link> : <span>{what(r)}</span>}
                        </span>
                        {r.detail && <div className="ddetail">{r.detail}</div>}
                        {(r.lp || r.team?.length) && (
                          <div className={s.inlineMeta}>{[r.lp, r.team?.length ? `with ${r.team.join(', ')}` : null].filter(Boolean).join(' · ')}</div>
                        )}
                      </td>
                      <td className={s.lpCell}>{r.lp ?? <span className={s.none}>—</span>}</td>
                      <td className={s.teamCell}>{r.team?.length ? r.team.join(', ') : <span className={s.none}>—</span>}</td>
                      {vehicles.length > 1 && <td className="muted">{r.vehicle ?? '—'}</td>}
                      <td><span className={`flag ${STANDING[r.standing].flag}`}>{STANDING[r.standing].label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className={s.pager}><Pager {...paging} label="dated records" /></div>
        </>
      )}
      </div>
    </>
  );
}
