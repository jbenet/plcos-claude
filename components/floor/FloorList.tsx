'use client';

import Link from '@/components/ui/AppLink';
import { useState } from 'react';
import type { FloorState } from '@/lib/floor-client';
import { TEMP_LABEL } from '@/lib/floor-client';
import { RUNG_LABEL, rungIndex, STATUS_LABEL } from '@/modules/strategy/client';
import { aheadOnRecord, claimWords, compactUsd, itemHref, shownRung, stateOf, STATE_LABEL, statusOrder } from './shared';

type Key = 'amount' | 'name' | 'status' | 'rung' | 'owner' | 'moved';

/**
 * The list the canvases are drawn from.
 *
 * It is not a fallback. Every dimension any of the views encodes — size, fill, hue, glyph,
 * lane, and the status column a mark sits in — is a column here in words, and the basis for
 * each one is in the row rather than in a legend you have to hold in your head. The status
 * comes first and the ladder under it, as everywhere else (N62), with "Needs evidence" where
 * the status claims more than the ladder shows. It is keyboard-navigable, it sorts, and it is
 * the version you can copy into an email.
 */
export function FloorList({ state }: { state: FloorState }) {
  const [sort, setSort] = useState<Key>('amount');
  const [asc, setAsc] = useState(false);

  const rows = [...state.items].sort((a, b) => {
    const d = asc ? 1 : -1;
    switch (sort) {
      case 'name': return a.entityName.localeCompare(b.entityName) * -d;
      case 'owner': return a.ownerName.localeCompare(b.ownerName) * -d;
      // The first click reads in the pipeline's order, New to Passed, as the line does and as
      // the name reads A to Z; within a status, the rung breaks the tie.
      case 'status': return ((statusOrder(a.status) - statusOrder(b.status)) || (a.rungIndex - b.rungIndex)) * -d;
      // By what the column shows, the confirmed rung; the close track breaks the tie.
      case 'rung': return ((rungIndex(shownRung(a)) - rungIndex(shownRung(b))) || (a.rungIndex - b.rungIndex)) * d;
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
              <th style={{ width: 112 }}>Vehicle</th>
              {head('owner', 'Owner', 'w90')}
              {head('status', 'Status', 'w150')}
              {head('rung', 'On the ladder', 'w136')}
              {head('amount', 'At stake', 'w96 right')}
              {head('moved', 'Last record', 'w94 right')}
              <th style={{ width: 112 }}>State</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => {
              const st = stateOf(i);
              const claim = claimWords(i);
              return (
                <tr key={i.key}>
                  <td>
                    <Link href={itemHref(i)}><b>{i.entityName}</b></Link>
                    {i.headline && <div className="muted fllh">{i.headline}</div>}
                  </td>
                  <td className="muted">{i.vehicleName}</td>
                  <td className="muted">{i.ownerName}</td>
                  <td>
                    {STATUS_LABEL[i.status]}
                    {claim && <span className="stat evidence" title={claim}><i />Needs evidence</span>}
                    <div className="muted fllh">
                      {i.needsEvidence ? `No ${RUNG_LABEL[i.needsEvidence]} on the ladder yet. ` : ''}{i.statusBasis}
                    </div>
                  </td>
                  <td>
                    {(() => {
                      const shown = shownRung(i);
                      const ahead = aheadOnRecord(i);
                      return (
                        <>
                          {shown ? RUNG_LABEL[shown] : <span className="muted">Nothing yet</span>}
                          <div className="muted fllh">
                            {!i.pursuitId && i.rung ? 'From the close track: no pursuit. ' : ''}
                            {ahead ? `${RUNG_LABEL[ahead]} on the close track, not confirmed yet. ` : ''}
                            {i.nextRung ? `Next: ${RUNG_LABEL[i.nextRung]}` : 'The top rung'}
                          </div>
                        </>
                      );
                    })()}
                  </td>
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
        {state.coverage.notInspected.join(' ')} The status is our plan; the ladder is what the
        records show, and neither moves the other.
      </p>
    </div>
  );
}
