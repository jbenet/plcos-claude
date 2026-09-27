'use client';

import { STATUSES } from '@/modules/strategy/client';
import type { FloorState } from '@/lib/floor-client';
import { useFloor } from './FloorContext';
import { Pager, usePage } from './Paging';

/** Counts stay legible at any LP volume; a cell opens the identical filtered list. */
export function LineView({ state }: { state: FloorState }) {
  const { filter, setFilter } = useFloor();
  const byVehicle = state.scopeSlug === null;
  const laneOf = (i: FloorState['items'][number]) => byVehicle ? i.vehicleSlug : i.ownerName;
  const lanes = [...new Set(state.items.map(laneOf))].map(key => ({
    key, items: state.items.filter(i => laneOf(i) === key),
  })).sort((a, b) => b.items.length - a.items.length || a.key.localeCompare(b.key));
  const paging = usePage(lanes, 10);
  const max = Math.max(1, ...lanes.flatMap(l => STATUSES.map(s => l.items.filter(i => i.status === s.id).length)));
  return <div className="vizsummary">
    <p>Counts by {byVehicle ? 'vehicle' : 'owner'} and status. Each cell shows pursuits and evidence gaps. Select a cell to inspect its members in the list below.</p>
    <Pager {...paging} label="lanes, largest first" />
    <div className="scroller"><table className="list vizmatrix"><thead><tr><th>{byVehicle ? 'Vehicle' : 'Owner'}</th>{STATUSES.map(s => <th key={s.id}>{s.label}<br />{state.items.filter(i => i.status === s.id).length}</th>)}</tr></thead>
      <tbody>{paging.rows.map(l => <tr key={l.key}><th>{byVehicle ? l.items[0]?.vehicleName : l.key}<br /><span className="muted">{l.items.length} pursuits</span></th>{STATUSES.map(s => {
        const items = l.items.filter(i => i.status === s.id);
        const gaps = items.filter(i => i.needsEvidence).length;
        return <td key={s.id}><button className="vizcell" disabled={!items.length} onClick={() => setFilter({ ...filter, status: s.id, ...(byVehicle ? { vehicle: l.key } : { owner: l.key }) })}>
          <b>{items.length}</b><span className="vizbar" aria-hidden><i style={{ width: `${items.length / max * 100}%` }} /></span><small>{gaps} need evidence</small>
        </button></td>;
      })}</tr>)}</tbody></table></div>
    {!lanes.length && <p>No pursuits match these filters. Reset a filter to broaden the view.</p>}
  </div>;
}
