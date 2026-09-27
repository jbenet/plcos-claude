'use client';

import { Pager, usePage } from '@/components/floor/Paging';
import Link from '@/components/ui/AppLink';
import { useMemo, useState } from 'react';
import { Glyph } from '@/components/ui/Glyph';
import { LANE_LOOK, orderDatedRows, type DatedRow, type LaneLook } from '@/lib/lanes';

/**
 * Every dated thing, filtered as you type (issue 0020, real): a search over what, who and vehicle,
 * a chip per lane with its count, and a standing. Rows are tight, and each carries its lane's icon
 * and colour — the ones the chart above uses, and the timeline's where the thing is the same (a
 * meeting is the calendar mark everywhere). A detail that only repeats the standing ("Held.") is
 * not printed.
 */
const STANDING: Record<DatedRow['standing'], { label: string; flag: string }> = {
  pressing: { label: 'Pressing', flag: 'f-block' },
  ahead: { label: 'Ahead', flag: 'f-ev' },
  done: { label: 'Done', flag: 'f-mute' },
};

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function DatedList({ rows, vehicles }: { rows: DatedRow[]; vehicles: string[] }) {
  const [q, setQ] = useState('');
  const [lanes, setLanes] = useState<Set<string>>(new Set());
  const [standing, setStanding] = useState<'all' | DatedRow['standing']>('all');
  const [vehicle, setVehicle] = useState('all');

  const [team, setTeam] = useState('all');
  const [lp, setLp] = useState('all');
  const [sort, setSort] = useState('date');
  const [ascending, setAscending] = useState(false);
  const teams = [...new Set(rows.flatMap(r => r.team ?? []))].sort();
  const lps = [...new Set(rows.flatMap(r => r.lp ? [r.lp] : []))].sort();

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
  const toggle = (lane: string) => { paging.setPage(0); setLanes((prev) => {
    const next = new Set(prev);
    if (next.has(lane)) next.delete(lane); else next.add(lane);
    return next;
  }); };
  const present = (Object.entries(LANE_LOOK) as Array<[string, LaneLook]>).filter(([lane]) => counts.get(lane));

  return (
    <>
      <Pager {...paging} label="dated records" />
      <div className="dfilters">
        <input
          type="search"
          value={q}
          onChange={(e) => { setQ(e.target.value); paging.setPage(0); }}
          placeholder="Search what, who, vehicle…"
          aria-label="Search the dated things"
        />
        <select value={standing} onChange={(e) => { setStanding(e.target.value as typeof standing); paging.setPage(0); }} aria-label="Standing">
          <option value="all">Any standing</option>
          <option value="ahead">Ahead</option>
          <option value="pressing">Pressing</option>
          <option value="done">Done</option>
        </select>
        {vehicles.length > 1 && (
          <select value={vehicle} onChange={(e) => { setVehicle(e.target.value); paging.setPage(0); }} aria-label="Vehicle">
            <option value="all">Every vehicle</option>
            {vehicles.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
        <select aria-label="Our team" value={team} onChange={e => { setTeam(e.target.value); paging.setPage(0); }}>
          <option value="all">All team members</option>{teams.map(t => <option key={t}>{t}</option>)}
        </select>
        <select aria-label="LP" value={lp} onChange={e => { setLp(e.target.value); paging.setPage(0); }}>
          <option value="all">All LPs</option>{lps.map(t => <option key={t}>{t}</option>)}
        </select>
        <select aria-label="Sort calendar" value={sort} onChange={e => { setSort(e.target.value); setAscending(e.target.value !== 'date'); paging.setPage(0); }}>
          <option value="date">Date</option><option value="team">Our team</option><option value="lp">LP</option>
        </select>
        <button className="btn" onClick={() => { setAscending(!ascending); paging.setPage(0); }} aria-label="Toggle sort direction">
          {sort === 'date' ? ascending ? 'Oldest first ↑' : 'Newest first ↓' : ascending ? 'A–Z ↑' : 'Z–A ↓'}
        </button>
        <span className="dcount">{shown.length === rows.length ? `${rows.length} rows` : `${shown.length} of ${rows.length}`}</span>
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
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="muted" style={{ padding: '10px 18px' }}>Nothing matches the search and filters; the other rows are still there.</p>
      ) : (
        <table className="list dated">
          <thead>
            <tr>
              <th style={{ width: 118 }}>When</th>
              <th>What</th><th>LP</th><th>Our team / owner</th>
              {vehicles.length > 1 && <th style={{ width: 150 }}>Vehicle</th>}
              <th style={{ width: 92 }}>Standing</th>
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
                      {r.href ? <Link href={r.href}>{r.label}</Link> : <span>{r.label}</span>}
                    </span>
                    {r.detail && <div className="ddetail">{r.detail}</div>}
                  </td>
                  <td>{r.lp ?? 'Not recorded'}</td><td>{r.team?.join(', ') || 'Not recorded'}</td>
                  {vehicles.length > 1 && <td className="muted">{r.vehicle ?? '—'}</td>}
                  <td><span className={`flag ${STANDING[r.standing].flag}`}>{STANDING[r.standing].label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
