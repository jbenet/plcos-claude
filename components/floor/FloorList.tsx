'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { FloorState } from '@/lib/floor-client';
import { TEMP_LABEL } from '@/lib/floor-client';
import { RUNG_LABEL } from '@/modules/strategy/client';
import { compactUsd, stateOf, STATE_LABEL } from './shared';

type Key = 'amount' | 'name' | 'rung' | 'owner' | 'moved';

/**
 * The list the canvases are drawn from.
 *
 * It is not a fallback. Every dimension any of the five views encodes — size, fill, hue,
 * glyph, lane — is a column here in words, and the basis for each one is in the row rather
 * than in a legend you have to hold in your head. It is keyboard-navigable, it sorts, and
 * it is the version you can copy into an email.
 */
export function FloorList({ state }: { state: FloorState }) {
  const [sort, setSort] = useState<Key>('amount');
  const [asc, setAsc] = useState(false);

  const rows = [...state.items].sort((a, b) => {
    const d = asc ? 1 : -1;
    switch (sort) {
      case 'name': return a.entityName.localeCompare(b.entityName) * -d;
      case 'owner': return a.ownerName.localeCompare(b.ownerName) * -d;
      case 'rung': return (a.rungIndex - b.rungIndex) * d;
      case 'moved': return ((a.daysSinceMove ?? 9999) - (b.daysSinceMove ?? 9999)) * -d;
      default: return ((a.amount ?? -1) - (b.amount ?? -1)) * d;
    }
  });

  const head = (key: Key, label: string, cls = '') => (
    <th className={`sortable ${cls}${sort === key ? ' on' : ''}`}
        onClick={() => { if (sort === key) setAsc(!asc); else { setSort(key); setAsc(false); } }}
        aria-sort={sort === key ? (asc ? 'ascending' : 'descending') : 'none'}>
      {label}<span className="caret" aria-hidden>{sort === key ? (asc ? '▲' : '▼') : ''}</span>
    </th>
  );

  return (
    <div className="card">
      <div className="chead">
        <h2>The same floor, as a list</h2>
        <span className="lbl">{rows.length} items · every encoded dimension in words</span>
      </div>
      <div className="scroller">
        <table className="list floorlist">
          <thead>
            <tr>
              {head('name', 'Who')}
              <th style={{ width: 118 }}>Vehicle</th>
              {head('owner', 'Owner', 'w90')}
              {head('rung', 'Rung with evidence', 'w150')}
              <th style={{ width: 128 }}>Next rung needs</th>
              {head('amount', 'At stake', 'w96 right')}
              {head('moved', 'Last record', 'w94 right')}
              <th style={{ width: 118 }}>State</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => {
              const st = stateOf(i);
              return (
                <tr key={i.key}>
                  <td>
                    <Link href={`/targets/${i.entityId}`}><b>{i.entityName}</b></Link>
                    {i.headline && <div className="muted fllh">{i.headline}</div>}
                  </td>
                  <td className="muted">{i.vehicleName}</td>
                  <td className="muted">{i.ownerName}</td>
                  <td>
                    {i.rung ? RUNG_LABEL[i.rung] : <span className="muted">Sourced, nothing evidenced</span>}
                  </td>
                  <td className="muted">{i.nextRung ? RUNG_LABEL[i.nextRung] : '—'}</td>
                  <td className="right">
                    <b className="mono">{compactUsd(i.amount)}</b>
                    <div className="muted fllh">{i.track ?? 'no track'} · {i.sizeBasis}</div>
                  </td>
                  <td className="right">
                    <span className="mono">{i.daysSinceMove === null ? '—' : `${i.daysSinceMove}d`}</span>
                    <div className="muted fllh">{TEMP_LABEL[i.temp]} · {i.tempBasis}</div>
                  </td>
                  <td>
                    <span className={`flag ${st === 'blocked' ? 'f-block' : st === 'urgent' ? 'f-ev' : st === 'cash' ? 'f-ok' : 'f-mute'}`}>
                      {STATE_LABEL[st]}
                    </span>
                    {(i.blocked || i.urgent) && (
                      <div className="muted fllh">{i.blocked ?? i.urgent}</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="cover">
        <b>Coverage.</b> {state.coverage.corpus}. Not inspected:{' '}
        {state.coverage.notInspected.join(' ')}
      </p>
    </div>
  );
}
