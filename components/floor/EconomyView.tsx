'use client';

import type { BoardState } from '@/lib/board-client';

/**
 * View 10 — the economy.
 *
 * What runs out. A raise is usually described as short of money, and it is almost never the
 * thing that is short: person-time, a connector's willingness to ask twice, an approver's
 * attention, an allocator's own budget across four of our vehicles at once.
 *
 * Every cap here says where it came from, and the ones that are guesses say so in the same
 * sentence. A capacity line nobody can source is a line people plan around anyway.
 */

const TONE_WORD: Record<string, string> = {
  ok: 'Room left', tight: 'Getting tight', over: 'Over', unknown: 'Unverified',
};

export function EconomyView({ board }: { board: BoardState }) {
  return (
    <div className="econview">
      <div className="ecogrid">
        {board.resources.map((r) => {
          const pct = r.cap === null || r.cap === 0
            ? null
            : Math.min(100, Math.round((r.used / r.cap) * 100));
          return (
            <div className={`eco t-${r.tone}`} key={r.key}>
              <div className="ecohead">
                <b>{r.label}</b>
                <span className={`flag ${r.tone === 'over' ? 'f-block' : r.tone === 'tight' ? 'f-ev' : r.tone === 'unknown' ? 'f-mute' : 'f-ok'}`}>
                  {TONE_WORD[r.tone]}
                </span>
              </div>
              <div className="econum">
                <b>{r.used}</b>
                <span>{r.cap === null ? `${r.unit}` : `of ${r.cap} ${r.unit}`}</span>
              </div>
              {pct !== null && (
                <div className="ecobar"><i style={{ width: `${pct}%` }} /></div>
              )}
              <p className="ecodetail">{r.detail}</p>
              <p className="ecobasis">{r.basis}</p>
            </div>
          );
        })}
      </div>

      <div className="card goodwillcard">
        <div className="chead">
          <h2>Goodwill, per connector</h2>
          <span className="lbl">the resource people forget is finite</span>
        </div>
        <div className="cbody">
          {board.goodwill.length === 0 ? (
            <p className="muted">
              No ask has been carried through a connector in the last three months. That is a
              statement about the record, not about the relationships.
            </p>
          ) : (
            <table className="list">
              <thead>
                <tr>
                  <th>Connector</th>
                  <th style={{ width: 190 }}>Used this quarter</th>
                  <th style={{ width: 92 }}>Left</th>
                  <th>Where the cap comes from</th>
                </tr>
              </thead>
              <tbody>
                {board.goodwill.map((g) => (
                  <tr key={g.name}>
                    <td><b>{g.name}</b></td>
                    <td>
                      <div className="gwbar">
                        {Array.from({ length: g.cap }, (_, i) => (
                          <i key={i} className={i < g.used ? 'on' : ''} />
                        ))}
                      </div>
                      <span className="mono gwn">{g.used} of {g.cap}</span>
                    </td>
                    <td className={`mono${g.cap - g.used <= 0 ? ' gwout' : ''}`}>
                      {Math.max(0, g.cap - g.used)}
                    </td>
                    <td className="muted">{g.basis}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="cover">
          A connector at their cap is not a route, whatever the graph says. Asking twice in a
          quarter spends a relationship that took years to build on an introduction worth
          weeks — which is why the allowance is a guard and not a warning.
        </p>
      </div>
    </div>
  );
}
