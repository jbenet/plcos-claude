'use client';

import { useState } from 'react';
import type { Radar } from '@/lib/lenses-client';
import { useFloor } from './FloorContext';
import { PagedRows } from './Paging';
import { compactUsd } from './shared';

const bands = ['0–2 days', '3–7 days', '8–14 days', '15+ days', 'No dated exchange'];
const bandOf = (days: number | null) => days === null ? 4 : days <= 2 ? 0 : days <= 7 ? 1 : days <= 14 ? 2 : 3;
export function RadarView({ radar }: { radar: Radar }) {
  const { select } = useFloor();
  const [band, setBand] = useState<number | null>(null);
  const all = [...radar.dots, ...radar.offRadar];
  const counts = bands.map((_, b) => all.filter(d => bandOf(d.days) === b).length);
  const max = Math.max(1, ...counts);
  const rows = all.filter(d => band === null || bandOf(d.days) === band).sort((a, b) => (b.days ?? Infinity) - (a.days ?? Infinity) || a.name.localeCompare(b.name));
  return <div className="vizsummary"><p>Time since a dated exchange. Unknown dates stay separate; silence is not disinterest. Select a band to inspect its records.</p>
    <div className="vizbins">{bands.map((label, b) => <button key={label} className="vizcell" aria-pressed={band === b} onClick={() => setBand(band === b ? null : b)}><span>{label}</span><b>{counts[b]}</b><span className="vizbar" aria-hidden><i style={{ width: `${counts[b]! / max * 100}%` }} /></span></button>)}</div>
    <button className="btn" onClick={() => setBand(null)} disabled={band === null}>All recency bands</button>
    <PagedRows key={String(band)} rows={rows} label="pursuits, unknown dates then oldest first">{page => <table className="list"><thead><tr><th>Pursuit</th><th>Vehicle / owner</th><th>Last exchange</th><th>At stake</th><th>Signals</th></tr></thead><tbody>{page.map(d => <tr key={d.key}><td><button className="covname" onClick={() => select({ kind: 'item', key: d.key })}>{d.name}</button></td><td>{d.vehicleName} · {d.ownerName}</td><td>{d.days === null ? 'No dated exchange' : `${d.days} days ago`}</td><td>{compactUsd(d.amount)}</td><td>{d.blocked ? 'Blocked · ' : ''}{d.urgent ? 'Dated soon · ' : ''}{d.temp}</td></tr>)}</tbody></table>}</PagedRows>
    <p className="cover">{radar.note}</p>
  </div>;
}
