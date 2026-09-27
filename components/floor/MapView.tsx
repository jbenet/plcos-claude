'use client';

import { useState } from 'react';
import type { BoardState, Territory } from '@/lib/board-client';
import { EXPLORED_LABEL, HOLDING_LABEL } from '@/lib/board-client';
import { useFloor } from './FloorContext';
import { PagedRows } from './Paging';
import { compactUsd } from './shared';

// Five equal rubric intervals are a display choice, not a new score or inferred assessment.
const bin = (n: number) => Math.min(4, Math.max(0, Math.floor(n * 5)));
const cellOf = (t: Territory) => t.capacity === null || t.affinity === null ? 'unknown' : `${bin(t.capacity)}:${bin(t.affinity)}`;
const interval = (n: number) => `${(n / 5).toFixed(1)}–${((n + 1) / 5).toFixed(1)}${n === 4 ? ' inclusive' : ' (upper exclusive)'}`;
export function MapView({ board }: { board: BoardState }) {
  const { select } = useFloor();
  const [cell, setCell] = useState<string | null>(null);
  const counts = new Map<string, number>();
  for (const t of board.territories) counts.set(cellOf(t), (counts.get(cellOf(t)) ?? 0) + 1);
  const max = Math.max(1, ...counts.values());
  const rows = board.territories.filter(t => cell === null || cellOf(t) === cell).sort((a, b) => a.name.localeCompare(b.name));
  return <div className="vizsummary"><p>Capacity × mandate fit, binned into five rubric intervals on each axis. Counts include every name in this preview, with unscored names held separately. Select a bin to expand it.</p>
    <p className="cover">{board.fog.note} This is a bounded discovery preview, not the entire network. Use <a href="/orgs/g/all">Everyone</a> to search the full directory.</p>
    <div className="scroller"><table className="list vizmatrix"><caption>Rows: capacity · columns: affinity</caption><thead><tr><th>Capacity / affinity</th>{[0, 1, 2, 3, 4].map(a => <th key={a}>{interval(a)}</th>)}</tr></thead><tbody>{[4, 3, 2, 1, 0].map(c => <tr key={c}><th>{interval(c)}</th>{[0, 1, 2, 3, 4].map(a => {
      const key = `${c}:${a}`, n = counts.get(key) ?? 0;
      return <td key={key}><button className="vizcell" disabled={!n} aria-pressed={cell === key} onClick={() => setCell(cell === key ? null : key)}><b>{n}</b><span className="vizbar" aria-hidden><i style={{ width: `${n / max * 100}%` }} /></span></button></td>;
    })}</tr>)}</tbody></table></div>
    <div className="vizpager"><button className="btn" aria-pressed={cell === 'unknown'} onClick={() => setCell('unknown')}>Cannot be placed: {counts.get('unknown') ?? 0}</button><button className="btn" onClick={() => setCell(null)} disabled={cell === null}>All preview names: {board.territories.length}</button></div>
    <PagedRows key={cell} rows={rows} label="preview names, alphabetical">{page => <div className="scroller"><table className="list"><thead><tr><th>Name / segment</th><th>Rubric dimensions</th><th>Band / basis</th><th>Cheque / basis</th><th>Holding / records</th></tr></thead><tbody>{page.map(t => <tr key={t.entityId}>
      <td><button className="covname" onClick={() => select({ kind: 'entity', entityId: t.entityId, name: t.name })}>{t.name}</button>{t.segment}</td>
      <td>Capacity {t.capacity ?? 'unknown'} · affinity {t.affinity ?? 'unknown'} · propensity {t.propensity ?? 'unknown'} · decision time {t.timeToDecision ?? 'unknown'}</td>
      <td>{t.band} · {t.scoreBasis}</td><td>{compactUsd(t.cheque)} · {t.chequeBasis}</td><td>{HOLDING_LABEL[t.holding]} · {t.ownerName ?? 'Unassigned'} · {EXPLORED_LABEL[t.explored]} · {t.edges} recorded edges</td>
    </tr>)}</tbody></table></div>}</PagedRows>
  </div>;
}
