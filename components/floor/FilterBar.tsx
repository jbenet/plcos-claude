'use client';

import { STATUSES, type PursuitStatus } from '@/modules/strategy/client';
import type { FloorState } from '@/lib/floor-client';
import { EMPTY_FILTER, SIGNAL_LABEL, type FloorFilter } from './FloorContext';

/**
 * One filter, every view.
 *
 * It narrows the projection before any drawing sees it, so a search for "Roos" reshapes the
 * line, the load, the map and the list at once rather than being reimplemented five times
 * with five sets of bugs. The count says what is hidden — a filtered picture that looks like
 * an unfiltered one is the most expensive kind of mistake this page could make.
 */
export function FilterBar({
  state, filter, onChange, shown,
}: {
  state: FloorState;
  filter: FloorFilter;
  onChange: (next: FloorFilter) => void;
  shown: number;
}) {
  const owners = [...new Set(state.items.map((i) => i.ownerName))].sort();
  const dirty = filter.find !== '' || filter.owner !== 'everyone'
    || filter.signal !== 'all' || filter.status !== 'all';

  return (
    <div className="filterbar">
      <label className="fb">
        <span className="lbl">Find</span>
        <input
          type="search"
          value={filter.find}
          placeholder="LP, owner, blocker, status, rung…"
          onChange={(e) => onChange({ ...filter, find: e.target.value })}
        />
      </label>
      <label className="fb">
        <span className="lbl">Owner</span>
        <select value={filter.owner} onChange={(e) => onChange({ ...filter, owner: e.target.value })}>
          <option value="everyone">Everyone</option>
          {owners.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </label>
      <label className="fb">
        <span className="lbl">Signal</span>
        <select
          value={filter.signal}
          onChange={(e) => onChange({ ...filter, signal: e.target.value as FloorFilter['signal'] })}
        >
          {(Object.keys(SIGNAL_LABEL) as Array<FloorFilter['signal']>).map((s) => (
            <option key={s} value={s}>{SIGNAL_LABEL[s]}</option>
          ))}
        </select>
      </label>
      {/* The status (N62), not the rung. The ladder is not a filter here: it is the evidence
          under the status, and "Needs evidence" under Signal finds where the two part. */}
      <label className="fb">
        <span className="lbl">Status</span>
        <select
          value={filter.status}
          onChange={(e) => onChange({ ...filter, status: e.target.value as PursuitStatus | 'all' })}
        >
          <option value="all">All statuses</option>
          {STATUSES.map((s) => <option key={s.id} value={s.id} title={s.means}>{s.label}</option>)}
        </select>
      </label>
      <button className="btn" disabled={!dirty} onClick={() => onChange(EMPTY_FILTER)}>Reset</button>
      <div className={`fbcount${shown < state.items.length ? ' on' : ''}`}>
        <b>{shown}</b> of {state.items.length} pursuits
        {shown < state.items.length && <span>{state.items.length - shown} hidden by this filter</span>}
      </div>
    </div>
  );
}
