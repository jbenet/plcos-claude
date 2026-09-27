'use client';

import type { FloorState } from '@/lib/floor-client';
import { useFloor } from './FloorContext';
import { Pager, usePage } from './Paging';
import { compactUsd, stateOf } from './shared';

export function LoadView({ state }: { state: FloorState }) {
  const { filter, setFilter } = useFloor();
  const open = state.items.filter(i => !i.cashReceived && i.status !== 'passed');
  // Each monetary row belongs to exactly one vehicle; there is no cross-vehicle AUM sum.
  const groups = new Map<string, typeof open>();
  for (const item of open) {
    const key = JSON.stringify([item.ownerName, item.vehicleSlug]);
    const group = groups.get(key) ?? []; group.push(item); groups.set(key, group);
  }
  const rows = [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  const paging = usePage(rows, 10);
  const max = Math.max(1, ...rows.map(([, items]) => items.length));
  return <div className="vizsummary"><p>Open pursuits by owner and vehicle, largest load first. Wired and passed pursuits are excluded. Counts measure work, not capacity. Hard and soft amounts stay separate within each vehicle.</p>
    <Pager {...paging} label="owner / vehicle groups" />
    <div className="scroller"><table className="list"><thead><tr><th>Owner / vehicle</th><th>In flight</th><th>Stalled</th><th>Blocked</th><th>No number</th><th>Hard</th><th>Soft</th></tr></thead><tbody>
      {paging.rows.map(([key, items]) => { const first = items[0]!; return <tr key={key}>
        <th><button className="covname" onClick={() => setFilter({ ...filter, owner: first.ownerName, vehicle: first.vehicleSlug })}>{first.ownerName} · {first.vehicleName}</button></th>
        <td>{items.length}<span className="vizbar" aria-hidden><i style={{ width: `${items.length / max * 100}%` }} /></span></td>
        <td>{items.filter(i => i.stalled).length}</td><td>{items.filter(i => stateOf(i) === 'blocked').length}</td><td>{items.filter(i => i.amount === null).length}</td>
        {(['hard', 'soft'] as const).map(track => <td key={track}>{compactUsd(items.filter(i => i.track === track).reduce((sum, i) => sum + (i.amount ?? 0), 0))}</td>)}
      </tr>; })}
    </tbody></table></div>{!open.length && <p>No open pursuits match these filters.</p>}
  </div>;
}
