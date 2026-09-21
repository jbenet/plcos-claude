'use client';

import type { FloorState } from '@/lib/floor-client';
import { RUNG_LABEL, RUNGS } from '@/modules/strategy/client';
import { compactUsd, stateOf } from './shared';

/**
 * View 5 — the room.
 *
 * The least artistic of the five and the one most likely to survive: a card per vehicle,
 * the same eight numbers on each, read left to right like instruments. No drawing here
 * encodes anything a number could not, which is the point — it is the version you can read
 * at a glance from across a room and the version that is hardest to misread.
 *
 * Hard and soft sit on two separate lines with two separate counts. There is no line on
 * this page that adds them, and there is no total across vehicles anywhere on it.
 */

export function RoomView({ state }: { state: FloorState }) {
  const a = state.agents;
  return (
    <div className="roomview">
      <div className="rgrid">
        {state.money.map((v) => {
          const mine = state.items.filter((i) => i.vehicleSlug === v.slug);
          const stalled = mine.filter((i) => i.stalled);
          const blocked = mine.filter((i) => stateOf(i) === 'blocked');
          const urgent = mine.filter((i) => stateOf(i) === 'urgent');
          const cash = mine.filter((i) => i.cashReceived);
          const alarms = state.alarms.filter((x) => x.vehicleName === v.name).slice(0, 3);
          const max = Math.max(1, ...RUNGS.map((r) => mine.filter((i) => i.rung === r).length));
          return (
            <div className="rcard" key={v.slug}>
              <div className="rhead">
                <b>{v.name}</b>
                <span className="lbl">{mine.length} in flight</span>
              </div>

              <div className="rbars">
                {RUNGS.map((r, i) => {
                  const n = mine.filter((x) => x.rung === r).length;
                  return (
                    <div className="rbar" key={r} title={`${RUNG_LABEL[r]}: ${n}`}>
                      <div className="rbwrap">
                        <div className="rbfill" style={{ height: `${(n / max) * 100}%` }} />
                      </div>
                      <span className="rbn">{n}</span>
                      <span className="rbl">{String(i + 1).padStart(2, '0')}</span>
                    </div>
                  );
                })}
              </div>

              <dl className="rmoney">
                <div>
                  <dt>Hard</dt>
                  <dd>
                    {compactUsd(mine.filter((i) => i.track === 'hard').reduce((n, i) => n + (i.amount ?? 0), 0))}
                    <span> · {mine.filter((i) => i.track === 'hard').length} signed</span>
                  </dd>
                </div>
                <div>
                  <dt>Soft</dt>
                  <dd>
                    {compactUsd(mine.filter((i) => i.track === 'soft').reduce((n, i) => n + (i.amount ?? 0), 0))}
                    <span> · {mine.filter((i) => i.track === 'soft').length} indications, never added to hard</span>
                  </dd>
                </div>
              </dl>

              <div className="rlights">
                <span className={`rl${blocked.length ? ' on stop' : ''}`}>✕ {blocked.length} blocked</span>
                <span className={`rl${urgent.length ? ' on soon' : ''}`}>! {urgent.length} dated soon</span>
                <span className={`rl${stalled.length ? ' on warn' : ''}`}>◷ {stalled.length} stalled</span>
                <span className={`rl${cash.length ? ' on ok' : ''}`}>✓ {cash.length} wired</span>
              </div>

              {alarms.length > 0 && (
                <ul className="ralarms">
                  {alarms.map((x) => (
                    <li key={x.key} className={`sv-${x.severity}`}>
                      <b>{x.label}.</b> {x.detail}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div className="rstrip">
        <div className="rs">
          <span className="lbl">Agent floor</span>
          <b>{a.running} running · {a.awaitingAcceptance} waiting on a human</b>
          <span className="muted">
            {a.refused} tool calls refused by an envelope. No run has sent anything — every one
            of them ends in a proposal a person accepts.
          </span>
        </div>
        <div className="rs">
          <span className="lbl">Enrichment queue</span>
          <b>{a.humanQueued}/{a.humanWip} human · {a.agentQueued}/{a.agentWip} agent</b>
          <span className="muted">Person-time is the scarce one, which is why the two limits differ.</span>
        </div>
        <div className={`rs${a.breaker.frozen ? ' frozen' : ''}`}>
          <span className="lbl">Circuit breaker</span>
          <b>{a.breaker.frozen ? 'Autonomy frozen' : 'Within budget'}</b>
          <span className="muted">{a.breaker.statement}</span>
        </div>
      </div>

      <div className="ralarmboard">
        <div className="lbl">Everything asking for a person, newest first</div>
        {state.alarms.length === 0 ? (
          <p className="muted">Nothing is asking for a person right now.</p>
        ) : (
          <table className="list">
            <thead>
              <tr>
                <th style={{ width: 92 }}>Severity</th>
                <th style={{ width: 190 }}>What</th>
                <th>Detail</th>
                <th style={{ width: 150 }}>Who or what</th>
              </tr>
            </thead>
            <tbody>
              {state.alarms.map((x) => (
                <tr key={x.key}>
                  <td>
                    <span className={`flag ${x.severity === 'stop' ? 'f-block' : x.severity === 'soon' ? 'f-ev' : 'f-mute'}`}>
                      {x.severity === 'stop' ? 'Stop' : x.severity === 'soon' ? 'Soon' : 'Note'}
                    </span>
                  </td>
                  <td><b>{x.label}</b></td>
                  <td className="muted">{x.detail}</td>
                  <td className="muted">{x.entityName ?? x.vehicleName ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
